import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export function SuggestionPanel({ documentId, isOwner }) {
  const [items, setItems] = useState([]);
  async function load() {
    const r = await api.listSuggestions(documentId);
    setItems(r.suggestions || []);
  }
  useEffect(() => { load(); }, [documentId]);

  async function resolve(id, state) {
    await api.resolveSuggestion(documentId, id, state);
    await load();
  }

  const open = items.filter(s => s.state === 'open');

  return (
    <div className="suggestion-panel">
      <h3 style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--fg-muted)' }}>Suggestions</h3>
      {open.length === 0 && <div style={{ color: 'var(--fg-muted)', fontSize: 13 }}>No pending suggestions.</div>}
      {open.map(s => (
        <div key={s.id} className="sitem">
          <div className="author" style={{ color: s.color || 'inherit' }}>{s.display_name || s.author_email || 'Anonymous'}</div>
          <div style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{s.kind} · {new Date(s.created_at).toLocaleString()}</div>
          <div className="diff">
            {s.before && <del>{s.before}</del>}
            {s.before && s.after && ' → '}
            {s.after && <ins>{s.after}</ins>}
          </div>
          {isOwner && (
            <div className="actions">
              <button className="primary" onClick={() => resolve(s.id, 'accepted')}>Accept</button>
              <button onClick={() => resolve(s.id, 'rejected')}>Reject</button>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
