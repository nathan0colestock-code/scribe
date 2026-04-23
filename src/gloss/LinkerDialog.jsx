import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

export function LinkerDialog({ documentId, onClose, onChanged }) {
  const [picker, setPicker] = useState(null);
  const [links, setLinks] = useState([]);
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    try {
      const [p, l] = await Promise.all([api.glossPicker(documentId), api.glossLinks(documentId)]);
      setPicker(p); setLinks(l.links || []);
    } catch (e) { setErr(e.message); }
    finally { setLoading(false); }
  }
  useEffect(() => { load(); }, [documentId]);

  const linkedKey = useMemo(() => new Set(links.map(l => `${l.kind}:${l.gloss_id}`)), [links]);

  async function addLink(kind, gloss_id, label) {
    try {
      await api.addGlossLink(documentId, { kind, gloss_id: String(gloss_id), label });
      await load();
      onChanged?.();
    } catch (e) { setErr(e.message); }
  }
  async function removeLink(id) {
    await api.removeGlossLink(documentId, id);
    await load();
    onChanged?.();
  }

  if (loading) return <div className="linker-dialog"><div className="panel">Loading picker…</div></div>;

  const collections = picker?.collections?.groups?.flatMap(g => (g.items || []).map(i => ({ ...i, _kind_label: g.kind }))) || [];
  const topics = picker?.topics?.entries || [];
  const people = picker?.people?.entries || [];
  const books = picker?.books?.entries || [];

  return (
    <div className="linker-dialog" onClick={onClose}>
      <div className="panel" onClick={e => e.stopPropagation()}>
        <h3>Link Gloss sources</h3>
        <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>
          Scribe will pull the raw text from every page under what you link and keep it searchable.
        </p>

        {err && <div style={{ color: 'var(--danger)' }}>{err}</div>}

        {links.length > 0 && (
          <div className="section">
            <h4 style={{ margin: '8px 0 4px 0' }}>Linked</h4>
            {links.map(l => (
              <div key={l.id} className="item linked">
                <span><span className="pill">{l.kind}</span> {l.label}</span>
                <button className="danger" onClick={() => removeLink(l.id)} style={{ padding: '0 8px', fontSize: 11 }}>unlink</button>
              </div>
            ))}
          </div>
        )}

        <LinkerSection
          title="Collections" items={collections}
          idKey="id" labelKey="title" kind="collection"
          linkedKey={linkedKey} onAdd={addLink}
        />
        <LinkerSection
          title="Topics" items={topics}
          idKey="id" labelKey="label" kind="topic"
          linkedKey={linkedKey} onAdd={addLink}
        />
        <LinkerSection
          title="People" items={people}
          idKey="id" labelKey="label" kind="person"
          linkedKey={linkedKey} onAdd={addLink}
        />
        <LinkerSection
          title="Books" items={books}
          idKey="id" labelKey="title" kind="book"
          linkedKey={linkedKey} onAdd={addLink}
        />

        <div style={{ textAlign: 'right', marginTop: 10 }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

function LinkerSection({ title, items, idKey, labelKey, kind, linkedKey, onAdd }) {
  const [q, setQ] = useState('');
  const filtered = (items || []).filter(i => !q || (i[labelKey] || '').toLowerCase().includes(q.toLowerCase())).slice(0, 40);
  if (!items || items.length === 0) return null;
  return (
    <div className="section">
      <h4 style={{ margin: '8px 0 4px 0' }}>{title} <span style={{ color: 'var(--fg-muted)', fontSize: 12 }}>({items.length})</span></h4>
      <input placeholder="Filter…" value={q} onChange={e => setQ(e.target.value)} style={{ width: '100%', marginBottom: 6 }} />
      {filtered.map(i => {
        const id = i[idKey];
        const label = i[labelKey] || String(id);
        const linked = linkedKey.has(`${kind}:${id}`);
        return (
          <div
            key={id}
            className={`item ${linked ? 'linked' : ''}`}
            onClick={() => !linked && onAdd(kind, id, label)}
          >
            <span>{label}</span>
            <span style={{ color: 'var(--fg-muted)', fontSize: 11 }}>{linked ? 'linked' : 'link'}</span>
          </div>
        );
      })}
    </div>
  );
}
