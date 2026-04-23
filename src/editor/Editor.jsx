import React, { useEffect, useMemo, useRef } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Placeholder from '@tiptap/extension-placeholder';
import Link from '@tiptap/extension-link';
import Collaboration from '@tiptap/extension-collaboration';
import CollaborationCursor from '@tiptap/extension-collaboration-cursor';
import * as Y from 'yjs';
import { HocuspocusProvider } from '@hocuspocus/provider';

import { CommentMark, SuggestInsert, SuggestDelete, GlossAttribution } from './extensions.js';
import { ProofreadPlugin, setProofreadSuggestions, clearProofread, getProofreadState, docToPlainText } from './proofread.js';
import { Notecard } from './extensions/notecard.jsx';

const ProofreadExtension = Extension.create({
  name: 'proofread',
  addProseMirrorPlugins() { return [ProofreadPlugin()]; },
});

function wsUrl(docName) {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/ws/${encodeURIComponent(docName)}`;
}

// Build a Tiptap JSON node for a dropped Gloss card.
export function cardToNotecardNode(h) {
  const text = h.verbatim || h.snippet || '';
  const plain = text.replace(/<[^>]+>/g, '');
  return {
    type: 'notecard',
    attrs: {
      pageId:      String(h.page_id),
      sourceLabel: h.source_label || h.collection_title || `Gloss page ${h.page_id}`,
      collection:  h.collection_title || '',
      volume:      h.volume || null,
      pageNumber:  h.page_number || null,
      reference:   h.reference || '',
      deepLink:    h.deep_link || null,
    },
    content: [{ type: 'paragraph', content: plain ? [{ type: 'text', text: plain }] : [] }],
  };
}

// kind: 'draft' (default) | 'outline'
export function useCollabEditor({ docId, me, role, collabToken, kind = 'draft', placeholder }) {
  const providerRef = useRef(null);
  const ydocRef = useRef(null);
  const docName = kind === 'outline' ? `${docId}:outline` : docId;

  const { provider, ydoc } = useMemo(() => {
    if (!collabToken) return { provider: null, ydoc: null };
    const ydoc = new Y.Doc();
    const provider = new HocuspocusProvider({
      url: wsUrl(docName),
      name: docName,
      document: ydoc,
      token: collabToken,
    });
    ydocRef.current = ydoc;
    providerRef.current = provider;
    return { provider, ydoc };
  }, [docName, collabToken]);

  useEffect(() => () => {
    providerRef.current?.destroy();
    ydocRef.current?.destroy();
  }, []);

  const extensions = useMemo(() => {
    if (!provider || !ydoc) return null;
    const base = [
      StarterKit.configure({ history: false }),
      Placeholder.configure({ placeholder: placeholder || (kind === 'outline'
        ? 'Start your outline. Use # for headings, - for bullets, or drag notecards from the right.'
        : 'Write your draft here. Drag from the outline on the left.') }),
      Link.configure({ openOnClick: true }),
      Notecard,
      Collaboration.configure({ document: ydoc }),
      CollaborationCursor.configure({
        provider,
        user: { name: me?.display_name || 'You', color: me?.color || '#7a4a2f' },
      }),
    ];
    if (kind === 'draft') {
      base.push(CommentMark, SuggestInsert, SuggestDelete, GlossAttribution, ProofreadExtension);
    }
    return base;
  }, [provider, ydoc, me?.display_name, me?.color, kind, placeholder]);

  const editable = role === 'editor' || role === 'suggester';

  const editor = useEditor({
    extensions: extensions || [StarterKit, Notecard],
    editable: extensions ? editable : false,
  }, [extensions, editable]);

  return { editor, provider, ydoc };
}

export function EditorPane({ editor, onDrop, onDragOver, className }) {
  return (
    <div onDrop={onDrop} onDragOver={onDragOver} className={className}>
      <EditorContent editor={editor} />
    </div>
  );
}

export { setProofreadSuggestions, clearProofread, getProofreadState, docToPlainText };
