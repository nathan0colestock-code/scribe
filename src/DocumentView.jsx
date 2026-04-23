import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from './api.js';
import { useCollabEditor, EditorPane, cardToNotecardNode, setProofreadSuggestions, docToPlainText, getProofreadState } from './editor/Editor.jsx';
import { ProofreadPopover } from './editor/ProofreadPopover.jsx';
import { CandidateCards } from './sidebar/CandidateCards.jsx';
import { ReadwisePanel } from './sidebar/ReadwisePanel.jsx';
import { CommentPanel } from './comments/CommentPanel.jsx';
import { SuggestionPanel } from './suggestions/SuggestionPanel.jsx';
import { LinkerDialog } from './gloss/LinkerDialog.jsx';
import { ShareDialog } from './share/ShareDialog.jsx';
import { PromptDialog } from './dialogs/PromptDialog.jsx';
import { nanoid } from './editor/nanoid-browser.js';

const STAGES = [
  { id: 'outline', label: 'Outline' },
  { id: 'draft',   label: 'Draft' },
  { id: 'review',  label: 'Review' },
];

export function DocumentView({ me, document: initialDoc, role, isOwner }) {
  const [doc, setDoc] = useState(initialDoc);
  const [stage, setStage] = useState(() => localStorage.getItem(`scribe.stage.${initialDoc.id}`) || 'outline');
  const [showOutline, setShowOutline] = useState(true);
  const [showCards, setShowCards] = useState(true);
  const [focus, setFocus] = useState(false);
  const [showLinker, setShowLinker] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [aiStatus, setAiStatus] = useState('');
  const [collabToken, setCollabToken] = useState(null);
  const [promptDialog, setPromptDialog] = useState(null); // { message, placeholder, resolve }

  useEffect(() => { localStorage.setItem(`scribe.stage.${doc.id}`, stage); }, [stage, doc.id]);

  useEffect(() => {
    let cancelled = false;
    api.collabToken(doc.id).then(r => { if (!cancelled) setCollabToken(r.token || ''); })
      .catch(e => setAiStatus(`Collab auth failed: ${e.message}`));
    return () => { cancelled = true; };
  }, [doc.id]);

  const outlineEditor = useCollabEditor({ docId: doc.id, me, role, collabToken, kind: 'outline' });
  const draftEditor   = useCollabEditor({ docId: doc.id, me, role, collabToken, kind: 'draft' });

  // Paste-import seeding: App.jsx stashes pasted text in sessionStorage under
  // scribe-seed-<docId> before navigating here. On first readiness of the
  // draft editor, flush it in, clear the stash, and hop to the Draft stage.
  //
  // Cross-app hand-off (e.g. black → scribe "Open in Scribe"): the server
  // stashes the seed on documents.pending_seed, and GET /pending-seed is a
  // read-once consumer. If there's no sessionStorage seed but the doc has a
  // `source` field, we fetch and apply the pending seed.
  const seededRef = useRef(false);
  useEffect(() => {
    if (seededRef.current) return;
    if (!draftEditor.editor || role !== 'editor') return;

    const key = `scribe-seed-${doc.id}`;
    const local = sessionStorage.getItem(key);

    const applySeed = (text) => {
      if (!text) return;
      const blocks = text.split(/\n{2,}/).filter(s => s.trim().length);
      draftEditor.editor.chain().focus('end').insertContent(
        blocks.map(b => ({ type: 'paragraph', content: [{ type: 'text', text: b }] })),
      ).run();
      seededRef.current = true;
      setStage('draft');
    };

    if (local) {
      applySeed(local);
      sessionStorage.removeItem(key);
      return;
    }
    // Only hit the server for a pending seed when the doc was created with a
    // cross-app source — this is the only path that queues one. Avoids an
    // extra network call on every ordinary document open.
    if (doc.source) {
      // Mark early so StrictMode double-fires don't double-seed.
      seededRef.current = true;
      api.pendingSeed(doc.id).then(r => {
        if (r?.seed_body) applySeed(r.seed_body);
      }).catch(() => {});
    }
  }, [draftEditor.editor, role, doc.id, doc.source]);

  function showPrompt(message, placeholder = '') {
    return new Promise(resolve => {
      setPromptDialog({ message, placeholder, resolve });
    });
  }

  const saveTimer = useRef(null);
  function saveMeta(patch) {
    setDoc(d => ({ ...d, ...patch }));
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => api.updateDocument(doc.id, patch).catch(() => {}), 400);
  }

  // Build a drop handler for an editor that inserts a notecard on card drop.
  function makeDropHandler(editor) {
    return function onDrop(e) {
      if (!editor || role !== 'editor') return;
      const cardData = e.dataTransfer.getData('application/x-scribe-card');
      if (!cardData) return;
      e.preventDefault();
      const h = JSON.parse(cardData);
      const coords = { left: e.clientX, top: e.clientY };
      const viewPos = editor.view.posAtCoords(coords);
      const pos = viewPos?.pos ?? editor.state.doc.content.size;
      editor.chain().insertContentAt(pos, cardToNotecardNode(h)).run();
    };
  }

  function onEditorDragOver(e) {
    if (e.dataTransfer.types.includes('application/x-scribe-card')) e.preventDefault();
  }

  async function runProofread() {
    const editor = draftEditor.editor;
    if (!editor) return;
    setAiStatus('Proofreading…');
    const text = docToPlainText(editor.state.doc);
    try {
      const r = await api.proofread(doc.id, text);
      setProofreadSuggestions(editor, r.suggestions || []);
      setAiStatus(`${(r.suggestions || []).length} issue(s) flagged`);
    } catch (e) { setAiStatus(`Error: ${e.message}`); }
  }

  async function runStyleCheck() {
    const editor = draftEditor.editor;
    if (!editor) return;
    if (!doc.style_guide_id) { setAiStatus('Set a style guide first'); return; }
    setAiStatus('Checking style…');
    const text = docToPlainText(editor.state.doc);
    try {
      const r = await api.styleCheck(doc.id, text);
      setProofreadSuggestions(editor, r.suggestions || []);
      setAiStatus(`${(r.suggestions || []).length} style suggestion(s)`);
    } catch (e) { setAiStatus(`Error: ${e.message}`); }
  }

  // Outline → Draft: hit /materialize, insert the returned Tiptap fragment
  // into the draft editor (replacing its current content), then swap stages.
  async function materializeOutline() {
    const editor = draftEditor.editor;
    if (!editor) return;
    setAiStatus('Materializing outline…');
    try {
      const r = await api.materializeOutline(doc.id);
      const frag = r.fragment;
      if (!frag || !Array.isArray(frag.content)) throw new Error('no fragment returned');
      editor.chain().focus().setContent(frag, true).run();
      setStage('draft');
      setAiStatus('Materialized — review & continue in Draft');
    } catch (e) { setAiStatus(`Materialize failed: ${e.message}`); }
  }

  // Review → Comms handoff. Prompts for a recipient name, then POSTs
  // to /send-to-comms with the current draft plaintext.
  async function sendToComms() {
    const editor = draftEditor.editor;
    if (!editor) return;
    const name = await showPrompt('Send to whom?', 'Comms contact display name');
    if (!name) return;
    const text = docToPlainText(editor.state.doc).trim();
    if (!text) { setAiStatus('Document is empty — nothing to send.'); return; }
    setAiStatus(`Sending to ${name} via comms…`);
    try {
      const r = await api.sendToComms(doc.id, {
        contactName: name,
        bodyText: text,
        medium: 'email', style: 'warm',
      });
      if (r.draft_id) setAiStatus(`Draft saved to Gmail (${r.draft_id.slice(0, 8)}…) for ${name}`);
      else setAiStatus(`Draft body returned for ${name} — check comms logs`);
    } catch (e) { setAiStatus(`Send failed: ${e.message}`); }
  }

  async function addCommentOnSelection() {
    const editor = draftEditor.editor;
    if (!editor) return;
    const { from, to, empty } = editor.state.selection;
    if (empty) { setAiStatus('Select some text first.'); return; }
    const threadId = nanoid(10);
    editor.chain().focus().setMark('comment', { threadId }).run();
    const body = await showPrompt('Leave a comment:');
    if (!body) {
      editor.chain().focus().setTextSelection({ from, to }).unsetMark('comment').run();
      return;
    }
    api.addComment(doc.id, { thread_id: threadId, body })
      .catch(e => setAiStatus(`Comment error: ${e.message}`));
  }

  const canEdit = role === 'editor';
  const canComment = ['editor', 'commenter', 'suggester'].includes(role);
  const queryParts = [doc.description, doc.main_point, doc.title];

  if (!outlineEditor.editor || !draftEditor.editor) {
    return <div className="loading">Loading editors…</div>;
  }

  return (
    <div className={`shell stage-${stage} ${focus ? 'focus-mode' : ''}`}>
      <div className="topbar">
        <Link to="/" className="home-link">Scribe</Link>
        <span className="crumb">› {doc.title || 'Untitled'}</span>

        <div className="stage-switch">
          {STAGES.map(s => (
            <button key={s.id} className={`stage-btn ${stage === s.id ? 'active' : ''}`} onClick={() => setStage(s.id)}>
              {s.label}
            </button>
          ))}
        </div>

        <span className="spacer" />

        {stage === 'draft' && (
          <>
            <button className={`toggle ${showOutline ? 'on' : ''}`} onClick={() => setShowOutline(v => !v)}>Outline</button>
            <button className={`toggle ${showCards ? 'on' : ''}`} onClick={() => setShowCards(v => !v)}>Notecards</button>
          </>
        )}
        <button className={`toggle ${focus ? 'on' : ''}`} onClick={() => setFocus(v => !v)}>Focus</button>

        <span className="chip">{role}</span>
        {canEdit && <button onClick={() => setShowLinker(true)}>Link Gloss</button>}
        {isOwner && <button onClick={() => setShowShare(true)}>Share</button>}
        {canEdit && stage === 'outline' && <button onClick={materializeOutline} className="primary" title="Turn outline + notecards into a draft">Materialize → Draft</button>}
        {canEdit && stage === 'draft' && <button onClick={runProofread} className="primary">Proofread</button>}
        {canEdit && stage === 'draft' && <button onClick={runStyleCheck}>Check style</button>}
        {canComment && stage === 'review' && <button onClick={addCommentOnSelection}>Comment</button>}
        {canEdit && stage === 'review' && <button onClick={sendToComms} title="Save this doc to Gmail Drafts via comms">Send to Comms as draft</button>}
        {aiStatus && <span className="chip">{aiStatus}</span>}
      </div>

      {stage === 'outline' && (
        <OutlineStage
          doc={doc} canEdit={canEdit} saveMeta={saveMeta}
          outlineEditor={outlineEditor.editor}
          queryParts={queryParts}
          onDrop={makeDropHandler(outlineEditor.editor)}
          onDragOver={onEditorDragOver}
        />
      )}

      {stage === 'draft' && (
        <DraftStage
          doc={doc} canEdit={canEdit} saveMeta={saveMeta}
          outlineEditor={outlineEditor.editor}
          draftEditor={draftEditor.editor}
          showOutline={showOutline} showCards={showCards}
          queryParts={queryParts}
          onOutlineDrop={makeDropHandler(outlineEditor.editor)}
          onDraftDrop={makeDropHandler(draftEditor.editor)}
          onDragOver={onEditorDragOver}
        />
      )}

      {stage === 'review' && (
        <ReviewStage
          doc={doc} me={me} isOwner={isOwner}
          draftEditor={draftEditor.editor}
          onDrop={makeDropHandler(draftEditor.editor)}
          onDragOver={onEditorDragOver}
        />
      )}

      {showLinker && <LinkerDialog documentId={doc.id} onClose={() => setShowLinker(false)} />}
      {showShare && <ShareDialog documentId={doc.id} onClose={() => setShowShare(false)} />}
      {promptDialog && (
        <PromptDialog
          message={promptDialog.message}
          placeholder={promptDialog.placeholder}
          onConfirm={v => { const r = promptDialog.resolve; setPromptDialog(null); r(v); }}
          onCancel={() => { const r = promptDialog.resolve; setPromptDialog(null); r(null); }}
        />
      )}
      <ProofreadPopover editor={draftEditor.editor} getSuggestions={() => getProofreadState(draftEditor.editor)?.suggestions || []} />
    </div>
  );
}

// Reference panel: hosts the notebook cards (gloss) and Readwise highlights
// under a small tab switcher. Both feed the editor on the left. `insertEditor`
// is the editor Readwise should insert blockquotes into — typically the draft
// editor, falling back to whichever editor is visible for the stage.
function ReferencePanel({ documentId, queryParts, insertEditor }) {
  const [tab, setTab] = useState(() => localStorage.getItem('scribe.refPanel.tab') || 'notebook');
  useEffect(() => { localStorage.setItem('scribe.refPanel.tab', tab); }, [tab]);
  return (
    <div className="reference-panel">
      <div className="tabs reference-tabs">
        <button className={tab === 'notebook' ? 'active' : ''} onClick={() => setTab('notebook')}>Notebook</button>
        <button className={tab === 'readwise' ? 'active' : ''} onClick={() => setTab('readwise')}>Readwise</button>
      </div>
      {tab === 'notebook' && (
        <CandidateCards documentId={documentId} queryParts={queryParts} />
      )}
      {tab === 'readwise' && (
        <ReadwisePanel editor={insertEditor} />
      )}
    </div>
  );
}

// Outline stage: full-width Tiptap outline editor with notecards on the right.
function OutlineStage({ doc, canEdit, saveMeta, outlineEditor, queryParts, onDrop, onDragOver }) {
  return (
    <div className="stage outline-stage">
      <div className="meta-form">
        <input
          className="title-input"
          value={doc.title || ''}
          onChange={e => saveMeta({ title: e.target.value })}
          placeholder="Untitled"
          disabled={!canEdit}
        />
        <input
          className="desc-input"
          value={doc.description || ''}
          onChange={e => saveMeta({ description: e.target.value })}
          placeholder="Description — what is this piece about?"
          disabled={!canEdit}
        />
        <input
          className="desc-input"
          value={doc.main_point || ''}
          onChange={e => saveMeta({ main_point: e.target.value })}
          placeholder="Main point — what do you want the reader to take away?"
          disabled={!canEdit}
        />
      </div>
      <div className="outline-canvas">
        <div className="outline-column">
          <EditorPane
            editor={outlineEditor}
            onDrop={onDrop}
            onDragOver={onDragOver}
            className="paper outline-paper"
          />
        </div>
        <div className="cards-column">
          <ReferencePanel
            documentId={doc.id}
            queryParts={queryParts}
            insertEditor={canEdit ? outlineEditor : null}
          />
        </div>
      </div>
    </div>
  );
}

// Draft stage: outline collapses to left side; draft editor is center; cards optional right.
function DraftStage({ doc, canEdit, saveMeta, outlineEditor, draftEditor, showOutline, showCards, queryParts, onOutlineDrop, onDraftDrop, onDragOver }) {
  return (
    <div className="stage draft-stage">
      <div className="meta-form slim">
        <input
          className="title-input"
          value={doc.title || ''}
          onChange={e => saveMeta({ title: e.target.value })}
          placeholder="Untitled"
          disabled={!canEdit}
        />
      </div>
      <div className={`draft-canvas${showOutline ? ' with-left' : ''}${showCards ? ' with-right' : ''}`}>
        {showOutline && (
          <div className="side-panel left">
            <div className="side-panel-label">Outline</div>
            <EditorPane
              editor={outlineEditor}
              onDrop={onOutlineDrop}
              onDragOver={onDragOver}
              className="outline-sidebar"
            />
          </div>
        )}
        <div className="draft-center">
          <EditorPane
            editor={draftEditor}
            onDrop={onDraftDrop}
            onDragOver={onDragOver}
            className="paper"
          />
        </div>
        {showCards && (
          <div className="side-panel right">
            <ReferencePanel
              documentId={doc.id}
              queryParts={queryParts}
              insertEditor={canEdit ? draftEditor : null}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// Review stage: draft editor + comments + suggestions.
function ReviewStage({ doc, me, isOwner, draftEditor, onDrop, onDragOver }) {
  const [tab, setTab] = useState('comments');
  return (
    <div className="stage review-stage">
      <div className="review-canvas">
        <div className="draft-center">
          <EditorPane
            editor={draftEditor}
            onDrop={onDrop}
            onDragOver={onDragOver}
            className="paper"
          />
        </div>
        <div className="side-panel right">
          <div className="tabs">
            <button className={tab === 'comments' ? 'active' : ''} onClick={() => setTab('comments')}>Comments</button>
            <button className={tab === 'suggestions' ? 'active' : ''} onClick={() => setTab('suggestions')}>Suggestions</button>
          </div>
          {tab === 'comments' && <CommentPanel documentId={doc.id} me={me} />}
          {tab === 'suggestions' && <SuggestionPanel documentId={doc.id} isOwner={isOwner} />}
        </div>
      </div>
    </div>
  );
}
