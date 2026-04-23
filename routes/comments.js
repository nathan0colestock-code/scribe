import express from 'express';
import * as db from '../db.js';

export const router = express.Router();

function access(req, res) {
  const doc = db.getDocument(req.params.id);
  if (!doc) { res.status(404).json({ error: 'not found' }); return null; }
  const isOwner = req.user?.is_owner && doc.owner_email === req.user.email;
  const role = isOwner ? 'editor'
    : (req.user?.email ? db.getCollaboratorRole(doc.id, req.user.email) : null)
    || (req.user?.documentId === doc.id ? req.user.role : null);
  if (!role || role === 'viewer') { res.status(403).json({ error: 'forbidden' }); return null; }
  return { doc, role, isOwner };
}

router.get('/:id/comments', (req, res) => {
  const a = access(req, res); if (!a) return;
  res.json({ threads: db.listThreadsWithComments(a.doc.id) });
});

router.post('/:id/comments', (req, res) => {
  const a = access(req, res); if (!a) return;
  const { thread_id, body } = req.body || {};
  if (!body) return res.status(400).json({ error: 'body required' });
  // Use client-provided thread_id if given (so the editor mark and row match).
  let tid = thread_id;
  if (tid) {
    const existing = db.db.prepare(`SELECT id FROM comment_threads WHERE id = ?`).get(tid);
    if (!existing) {
      db.db.prepare(`INSERT INTO comment_threads (id, document_id, created_by_email, created_at) VALUES (?, ?, ?, ?)`)
        .run(tid, a.doc.id, req.user.email, new Date().toISOString());
    }
  } else {
    const t = db.createCommentThread({ document_id: a.doc.id, created_by_email: req.user.email });
    tid = t.id;
  }
  const c = db.addComment({ thread_id: tid, author_email: req.user.email, body });
  res.json({ thread_id: tid, comment: c });
});

router.post('/:id/comments/:thread_id/resolve', (req, res) => {
  const a = access(req, res); if (!a) return;
  db.resolveThread(req.params.thread_id);
  res.json({ ok: true });
});
