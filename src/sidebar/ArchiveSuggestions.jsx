// Archive section of the reference panel.
//
// Calls GET /api/documents/:id/black-suggestions (server-side proxy to the
// black-hole semantic search) using the current document's topic signal.
// Shows up to 5 hits initially with a "See more" button to reveal more.
// Clicking a hit inserts a citation-style blockquote into `insertEditor`
// at the current cursor position:
//
//   > [snippet text]
//   — [title] · [source_url or drive_path]
//
// If `insertEditor` is null (viewer / no active editor), the citation
// click is disabled and a subtle tooltip explains why.

import React, { useEffect, useState, useCallback } from 'react';
import { api } from '../api.js';

const INITIAL_LIMIT = 5;
const EXPANDED_LIMIT = 20;

export function ArchiveSuggestions({ documentId, insertEditor }) {
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [loaded, setLoaded] = useState(false);
  // S-U-02: Archive tab shows an informative empty-state card when BLACK_URL
  // is not configured on the server. `null` until the probe completes.
  const [configured, setConfigured] = useState(null);

  useEffect(() => {
    // Single lightweight probe; cached at the tab level via state.
    api.archiveConfig()
      .then(r => setConfigured(!!r?.configured))
      .catch(() => setConfigured(false));
  }, []);

  const load = useCallback(async (fresh = false) => {
    if (configured === false) return; // don't bother hitting the proxy
    setLoading(true);
    setErr('');
    try {
      const r = await api.blackSuggestions(documentId, { k: EXPANDED_LIMIT, fresh });
      setResults(r.results || []);
      setLoaded(true);
    } catch (e) {
      setErr(e.message || 'failed');
    } finally {
      setLoading(false);
    }
  }, [documentId, configured]);

  useEffect(() => { if (configured === true) load(false); }, [load, configured]);

  const shown = expanded ? results : results.slice(0, INITIAL_LIMIT);
  const hasMore = !expanded && results.length > INITIAL_LIMIT;

  // S-U-02: unconfigured empty state — explicit hint rather than a silent hide.
  if (configured === false) {
    return (
      <div className="archive-section">
        <div className="archive-header">
          <h4>Archive</h4>
        </div>
        <div className="empty-state-card" style={{
          padding: 14, border: '1px dashed #555', borderRadius: 8,
          color: '#bbb', lineHeight: 1.45,
        }}>
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Archive not configured</div>
          <div style={{ fontSize: 13 }}>
            Set <code>BLACK_URL</code> (and <code>BLACK_API_KEY</code> or
            <code> SUITE_API_KEY</code>) in your Fly secrets to enable archive
            search. Exports and auto-archive will become available automatically.
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="archive-section">
      <div className="archive-header">
        <h4>Archive</h4>
        <button
          className="archive-refresh"
          onClick={() => load(true)}
          disabled={loading}
          title="Re-fetch from black"
        >
          {loading ? '…' : '↻'}
        </button>
      </div>
      {err && <div className="error-inline">{err}</div>}
      {loaded && !loading && results.length === 0 && !err && (
        <div className="empty">No archived files match this topic yet.</div>
      )}
      {shown.map(hit => (
        <ArchiveHit
          key={hit.file_id || `${hit.name}-${hit.drive_path}`}
          hit={hit}
          insertEditor={insertEditor}
        />
      ))}
      {hasMore && (
        <button className="archive-more" onClick={() => setExpanded(true)}>
          See {results.length - INITIAL_LIMIT} more
        </button>
      )}
    </div>
  );
}

function ArchiveHit({ hit, insertEditor }) {
  const title = hit.name || 'Untitled';
  const sourceUrl = hit.web_view_link || hit.drive_path || '';
  const snippet = truncate(hit.content || '', 220);
  const score = typeof hit.distance === 'number'
    ? `${Math.round((1 - hit.distance) * 100)}%`
    : null;

  function insertCitation() {
    if (!insertEditor) return;
    // Blockquote with snippet + attribution line. We build Tiptap JSON so
    // the formatting is structural (not a string the editor has to parse).
    const nodes = [
      {
        type: 'blockquote',
        content: [{ type: 'paragraph', content: [{ type: 'text', text: snippet }] }],
      },
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '— ' },
          sourceUrl
            ? {
                type: 'text',
                text: title,
                marks: [{ type: 'link', attrs: { href: sourceUrl } }],
              }
            : { type: 'text', text: title },
          { type: 'text', text: hit.drive_path ? ` · ${hit.drive_path}` : '' },
        ].filter(n => n.text !== ''),
      },
    ];
    insertEditor.chain().focus().insertContent(nodes).run();
  }

  const canInsert = !!insertEditor;
  return (
    <div className="archive-hit">
      <div className="archive-hit-header">
        <span className="archive-hit-title" title={title}>{title}</span>
        {score && <span className="archive-hit-score">{score}</span>}
      </div>
      {hit.drive_path && (
        <div className="archive-hit-path" title={hit.drive_path}>{hit.drive_path}</div>
      )}
      {snippet && <div className="archive-hit-snippet">{snippet}</div>}
      <div className="archive-hit-actions">
        <button
          className="archive-insert"
          onClick={insertCitation}
          disabled={!canInsert}
          title={canInsert ? 'Insert as citation at cursor' : 'Open a draft/outline editor to insert'}
        >
          Insert citation
        </button>
        {sourceUrl && (
          <a href={sourceUrl} target="_blank" rel="noreferrer" className="archive-open-link">
            Open
          </a>
        )}
      </div>
    </div>
  );
}

function truncate(s, n) {
  const t = String(s || '').trim().replace(/\s+/g, ' ');
  if (t.length <= n) return t;
  return t.slice(0, n - 1).trimEnd() + '…';
}
