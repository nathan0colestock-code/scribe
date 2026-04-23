import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

export function ShareDialog({ documentId, onClose }) {
  const [tokens, setTokens] = useState([]);
  const [role, setRole] = useState('commenter');
  const [err, setErr] = useState('');

  async function load() {
    try { const r = await api.listShares(documentId); setTokens(r.tokens); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [documentId]);

  async function create() {
    try { await api.createShareToken(documentId, role); await load(); }
    catch (e) { setErr(e.message); }
  }
  async function revoke(t) {
    await api.revokeShare(documentId, t);
    await load();
  }

  return (
    <div className="share-dialog" onClick={onClose}>
      <div className="panel" onClick={e => e.stopPropagation()}>
        <h3>Share this document</h3>
        <p style={{ color: 'var(--fg-muted)', fontSize: 13 }}>Anyone with a share link can join using the role you set.</p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          <select value={role} onChange={e => setRole(e.target.value)}>
            <option value="viewer">Viewer — read only</option>
            <option value="commenter">Commenter — add comments</option>
            <option value="suggester">Suggester — track changes</option>
            <option value="editor">Editor — full access</option>
          </select>
          <button className="primary" onClick={create}>Create link</button>
        </div>
        {err && <div style={{ color: 'var(--danger)', fontSize: 13 }}>{err}</div>}
        <div>
          {tokens.length === 0 && <div style={{ color: 'var(--fg-muted)' }}>No share links yet.</div>}
          {tokens.map(t => {
            const url = `${location.origin}/d/${documentId}?t=${t.token}`;
            return (
              <div key={t.token} style={{ border: '1px solid var(--border)', padding: 10, borderRadius: 6, marginBottom: 8, fontSize: 13 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span className="pill">{t.role}</span>
                  <input readOnly value={url} style={{ flex: 1 }} onFocus={e => e.target.select()} />
                  <button onClick={() => navigator.clipboard.writeText(url)}>Copy</button>
                  {!t.revoked_at && <button className="danger" onClick={() => revoke(t.token)}>Revoke</button>}
                </div>
                {t.revoked_at && <div style={{ color: 'var(--fg-muted)', marginTop: 4 }}>Revoked {new Date(t.revoked_at).toLocaleString()}</div>}
              </div>
            );
          })}
        </div>
        <div style={{ textAlign: 'right', marginTop: 10 }}>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
