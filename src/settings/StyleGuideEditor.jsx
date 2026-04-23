import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export function StyleGuideEditor({ onClose, onActiveChange, activeId }) {
  const [guides, setGuides] = useState([]);
  const [editing, setEditing] = useState(null);
  const [err, setErr] = useState('');

  async function load() {
    try { const r = await api.listStyleGuides(); setGuides(r.guides || []); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, []);

  async function save() {
    if (!editing) return;
    await api.saveStyleGuide(editing);
    setEditing(null);
    await load();
  }

  async function del(id) {
    if (!confirm('Delete this style guide?')) return;
    await api.deleteStyleGuide(id);
    await load();
  }

  return (
    <div className="linker-dialog" onClick={onClose}>
      <div className="panel" onClick={e => e.stopPropagation()}>
        <h3>Style guides</h3>
        <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
          Write what you believe good writing is. Scribe will use the active guide when you run "Check style."
        </p>
        {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}

        {!editing ? (
          <>
            {guides.map(g => (
              <div key={g.id} className="item" style={{ padding: 8 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{g.title}</div>
                  <div style={{ color: 'var(--fg-muted)', fontSize: 12 }}>{(g.body_md || '').slice(0, 120)}…</div>
                </div>
                <div>
                  <button onClick={() => setEditing(g)}>Edit</button>
                  <button className={activeId === g.id ? 'primary' : ''} onClick={() => onActiveChange?.(g.id)} style={{ marginLeft: 4 }}>
                    {activeId === g.id ? 'Active' : 'Use'}
                  </button>
                  <button className="danger" onClick={() => del(g.id)} style={{ marginLeft: 4 }}>×</button>
                </div>
              </div>
            ))}
            <div style={{ marginTop: 12 }}>
              <button className="primary" onClick={() => setEditing({ title: 'My style', body_md: '' })}>New guide</button>
              <button onClick={onClose} style={{ marginLeft: 8 }}>Close</button>
            </div>
          </>
        ) : (
          <>
            <input
              value={editing.title}
              onChange={e => setEditing({ ...editing, title: e.target.value })}
              placeholder="Title"
              style={{ width: '100%', marginBottom: 8 }}
            />
            <textarea
              value={editing.body_md}
              onChange={e => setEditing({ ...editing, body_md: e.target.value })}
              placeholder="# Voice&#10;- Prefer the active voice.&#10;- Cut hedging words."
              style={{ width: '100%', minHeight: 300, fontFamily: 'ui-monospace, monospace' }}
            />
            <div style={{ marginTop: 8 }}>
              <button className="primary" onClick={save}>Save</button>
              <button onClick={() => setEditing(null)} style={{ marginLeft: 8 }}>Cancel</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
