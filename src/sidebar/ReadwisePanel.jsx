// Readwise reference panel — lives alongside CandidateCards in the right
// side-panel. When a `documentId` is provided, the default view shows
// highlights matched to the document's topic signal via
// GET /api/documents/:id/readwise-suggestions. Without a documentId, it
// falls back to globally recent highlights (original behaviour).
//
// The manual search box always does a full LIKE search regardless of
// whether a documentId is present, so it works the same way in both modes.

import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

function useDebounce(value, delay) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

function insertHighlightAsBlockquote(editor, h) {
  if (!editor) return;
  const author = h.book?.author ? h.book.author : '';
  const title = h.book?.title || '';
  const citation = [author, title].filter(Boolean).join(', ');
  const blockquote = {
    type: 'blockquote',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: h.text }] },
    ],
  };
  const cite = citation
    ? { type: 'paragraph', content: [{ type: 'text', text: `— ${citation}` }] }
    : null;
  const content = cite ? [blockquote, cite] : [blockquote];
  editor.chain().focus().insertContent(content).run();
}

export function ReadwisePanel({ editor, documentId }) {
  const [query, setQuery] = useState('');
  const [recent, setRecent] = useState([]);
  const [suggestions, setSuggestions] = useState([]);
  const [results, setResults] = useState([]);
  const [state, setState] = useState({ last_sync: null, token_present: false });
  const [status, setStatus] = useState('');
  const [syncing, setSyncing] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded] = useState(false);
  const debounced = useDebounce(query, 350);

  async function loadRecent() {
    try { const r = await api.readwiseRecent(20); setRecent(r.results || []); } catch {}
  }
  async function loadState() {
    try { const s = await api.readwiseState(); setState(s); } catch {}
  }
  async function loadSuggestions(fresh = false) {
    if (!documentId) return;
    try {
      const r = await api.readwiseSuggestions(documentId, { k: 20, fresh });
      setSuggestions(r.results || []);
      setSuggestionsLoaded(true);
    } catch {}
  }

  useEffect(() => {
    loadState();
    if (documentId) {
      loadSuggestions(false);
    } else {
      loadRecent();
    }
  }, [documentId]);

  useEffect(() => {
    if (!debounced.trim()) { setResults([]); return; }
    let cancelled = false;
    api.readwiseSearch(debounced, 30)
      .then(r => { if (!cancelled) setResults(r.results || []); })
      .catch(e => { if (!cancelled) setStatus(`Search error: ${e.message}`); });
    return () => { cancelled = true; };
  }, [debounced]);

  async function syncNow() {
    setSyncing(true);
    setStatus('Syncing Readwise…');
    try {
      const r = await api.readwiseSync();
      setStatus(`Synced: ${r.books_upserted} books, ${r.highlights_upserted} highlights (${r.elapsed_ms} ms)`);
      await Promise.all([
        documentId ? loadSuggestions(true) : loadRecent(),
        loadState(),
      ]);
    } catch (e) {
      setStatus(`Sync failed: ${e.message}`);
    } finally {
      setSyncing(false);
    }
  }

  // Priority: manual search > doc-contextual suggestions > recent
  const showing = debounced.trim()
    ? results
    : documentId
      ? suggestions
      : recent;

  const grouped = useMemo(() => groupByBook(showing), [showing]);

  const emptyMessage = debounced.trim()
    ? 'No matching highlights.'
    : state.token_present
      ? documentId && suggestionsLoaded && suggestions.length === 0
        ? 'No highlights match this document\'s topic yet — try "Sync now" or search manually.'
        : 'No highlights yet — click "Sync now" to pull from Readwise.'
      : 'Set READWISE_TOKEN in prod to enable this panel.';

  return (
    <div className="cards readwise-panel">
      <div className="readwise-header">
        <h3>Readwise</h3>
        {documentId && suggestionsLoaded && !debounced.trim() && (
          <button
            className="archive-refresh"
            onClick={() => loadSuggestions(true)}
            title="Re-fetch suggestions for this document"
          >
            ↻
          </button>
        )}
      </div>
      <div className="stats">
        {state.last_sync
          ? <>Last sync {new Date(state.last_sync).toLocaleString()}</>
          : <>Never synced</>}
        {!state.token_present && <> · <span className="warn">no token</span></>}
      </div>
      <button
        className="refresh-btn"
        onClick={syncNow}
        disabled={syncing || !state.token_present}
        title={state.token_present ? 'Pull latest highlights from Readwise' : 'Set READWISE_TOKEN to enable'}
      >
        {syncing ? 'Syncing…' : 'Sync now'}
      </button>
      <input
        className="readwise-search"
        placeholder="Search highlights…"
        value={query}
        onChange={e => setQuery(e.target.value)}
      />
      {status && <div className="stats">{status}</div>}

      {showing.length === 0 ? (
        <div className="empty">{emptyMessage}</div>
      ) : (
        Object.entries(grouped).map(([bookKey, group]) => (
          <div key={bookKey} className="readwise-group">
            <div className="readwise-book">
              {group.book.title}
              {group.book.author && <span className="readwise-author"> · {group.book.author}</span>}
            </div>
            {group.items.map(h => (
              <HighlightCard key={h.highlight_id} highlight={h} editor={editor} />
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function groupByBook(highlights) {
  const out = {};
  for (const h of highlights) {
    const key = String(h.book?.id ?? 'x');
    if (!out[key]) out[key] = { book: h.book || { title: 'Unknown' }, items: [] };
    out[key].items.push(h);
  }
  return out;
}

function HighlightCard({ highlight: h, editor }) {
  function onClick() {
    insertHighlightAsBlockquote(editor, h);
  }
  return (
    <div
      className="card readwise-card"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      title="Click to insert as blockquote"
    >
      <div className="card-snippet">{h.text}</div>
      {h.note && <div className="readwise-note">{h.note}</div>}
    </div>
  );
}
