import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';

export function CommentPanel({ documentId, me, onJumpToThread }) {
  const [threads, setThreads] = useState([]);
  const [reply, setReply] = useState({});
  const [showResolved, setShowResolved] = useState(false);
  const [err, setErr] = useState('');

  async function load() {
    try { const r = await api.listComments(documentId); setThreads(r.threads || []); }
    catch (e) { setErr(e.message); }
  }
  useEffect(() => { load(); }, [documentId]);

  async function postReply(tid) {
    const body = (reply[tid] || '').trim();
    if (!body) return;
    await api.addComment(documentId, { thread_id: tid, body });
    setReply({ ...reply, [tid]: '' });
    await load();
  }

  async function resolve(tid) {
    await api.resolveThread(documentId, tid);
    await load();
  }

  const { open, resolved } = useMemo(() => {
    const open = [], resolved = [];
    for (const t of threads) (t.resolved ? resolved : open).push(t);
    return { open, resolved };
  }, [threads]);

  const visible = showResolved ? [...open, ...resolved] : open;

  return (
    <div className="comment-panel">
      <div className="panel-header">
        <h3>Comments</h3>
        {resolved.length > 0 && (
          <button className="link-btn" onClick={() => setShowResolved(v => !v)}>
            {showResolved ? `Hide ${resolved.length} resolved` : `Show ${resolved.length} resolved`}
          </button>
        )}
      </div>
      {err && <div className="error-inline">{err}</div>}
      {open.length === 0 && !showResolved && <div className="empty">No open comments.</div>}
      {visible.map(t => (
        <div key={t.id} className={`thread ${t.resolved ? 'resolved' : ''}`}>
          {(t.comments || []).map(c => (
            <div key={c.id}>
              <div className="author" style={{ color: c.color || 'inherit' }}>{c.display_name || c.author_email}</div>
              <div className="body">{c.body}</div>
              <div className="timestamp">{new Date(c.created_at).toLocaleString()}</div>
            </div>
          ))}
          {t.resolved && <div className="resolved-tag">Resolved</div>}
          {!t.resolved && (
            <>
              <textarea
                placeholder="Reply…"
                value={reply[t.id] || ''}
                onChange={e => setReply({ ...reply, [t.id]: e.target.value })}
              />
              <div className="actions">
                <button className="primary" onClick={() => postReply(t.id)}>Reply</button>
                <button onClick={() => resolve(t.id)}>Resolve</button>
                <button onClick={() => onJumpToThread?.(t.id)}>Jump to</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
