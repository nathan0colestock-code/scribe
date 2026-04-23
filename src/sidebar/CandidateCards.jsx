import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api.js';

function useDebounce(value, delay) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

export function CandidateCards({ documentId, queryParts, excludedPageIds }) {
  const [stats, setStats] = useState({ total: 0, with_text: 0, last_fetched: null });
  const [links, setLinks] = useState([]);
  const [hits, setHits] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  const query = queryParts.filter(Boolean).join(' ');
  const debounced = useDebounce(query, 500);

  const visibleHits = useMemo(() => {
    if (!excludedPageIds || excludedPageIds.size === 0) return hits;
    return hits.filter(h => !excludedPageIds.has(String(h.page_id)));
  }, [hits, excludedPageIds]);

  async function loadLinks() {
    const r = await api.glossLinks(documentId);
    setStats(r.stats || { total: 0, with_text: 0 });
    setLinks(r.links || []);
  }
  useEffect(() => { loadLinks(); }, [documentId]);

  useEffect(() => {
    if (!debounced || !debounced.trim()) { setHits([]); return; }
    setLoading(true);
    api.glossSearch(documentId, debounced)
      .then(r => { setHits(r.results || []); setErr(''); })
      .catch(e => setErr(e.message))
      .finally(() => setLoading(false));
  }, [debounced, documentId, stats.total]);

  async function refresh() {
    setLoading(true);
    try {
      await api.refreshGloss(documentId);
      await loadLinks();
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="cards">
      <h3>From your notebook</h3>
      <div className="stats">
        {stats.total} pages · {stats.with_text} with text
        {stats.last_fetched && <> · {new Date(stats.last_fetched).toLocaleTimeString()}</>}
      </div>
      <button onClick={refresh} disabled={loading} className="refresh-btn">
        {loading ? 'Syncing…' : 'Refresh'}
      </button>
      {err && <div className="error-inline">{err}</div>}

      {links.length === 0 && (
        <div className="empty">No Gloss sources linked. Click "Link Gloss" in the toolbar.</div>
      )}

      {links.length > 0 && !query.trim() ? (
        <div className="empty">Write a description, main point, or outline — matching notebook passages will appear here.</div>
      ) : visibleHits.length === 0 && query.trim() ? (
        <div className="empty">{loading ? 'Searching…' : 'No matching notebook passages yet.'}</div>
      ) : visibleHits.map(h => (
        <GlossCard key={`${h.page_id}-${(h.snippet || '').slice(0, 20)}`} hit={h} documentId={documentId} />
      ))}
    </div>
  );
}

function GlossCard({ hit: h, documentId }) {
  const parts = [];
  if (h.collection_title) parts.push(h.collection_title);
  if (h.volume)           parts.push(`v.${h.volume}`);
  if (h.page_number)      parts.push(`p.${h.page_number}`);
  const meta = parts.join(' · ') || h.source_kind || `page ${h.page_id}`;
  const verbatim = stripTags(h.verbatim || h.snippet || '');

  function onDragStart(e) {
    const payload = {
      page_id:          h.page_id,
      snippet:          verbatim,
      source_label:     meta,
      collection_title: h.collection_title || '',
      volume:           h.volume || null,
      page_number:      h.page_number || null,
      reference:        h.reference || '',
      deep_link:        h.deep_link || null,
      verbatim,
    };
    e.dataTransfer.setData('application/x-scribe-card', JSON.stringify(payload));
    e.dataTransfer.effectAllowed = 'copy';
  }

  return (
    <div className="card" draggable onDragStart={onDragStart}>
      <div className="card-meta">
        {h.deep_link
          ? <a href={h.deep_link} target="_blank" rel="noreferrer">{meta}</a>
          : <span>{meta}</span>
        }
      </div>
      <div dangerouslySetInnerHTML={{ __html: sanitizeMarks(h.snippet) }} className="card-snippet" />
    </div>
  );
}

function sanitizeMarks(html) {
  const escaped = (html || '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  return escaped.replace(/&lt;mark&gt;/g, '<mark>').replace(/&lt;\/mark&gt;/g, '</mark>');
}
function stripTags(s) { return (s || '').replace(/<[^>]+>/g, ''); }
