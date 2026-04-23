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
  if (!role) { res.status(403).json({ error: 'forbidden' }); return null; }
  return { doc, role, isOwner };
}

router.get('/:id/suggestions', (req, res) => {
  const a = access(req, res); if (!a) return;
  res.json({ suggestions: db.listSuggestions(a.doc.id) });
});

router.post('/:id/suggestions', (req, res) => {
  const a = access(req, res); if (!a) return;
  if (!['suggester', 'editor'].includes(a.role)) return res.status(403).json({ error: 'forbidden' });
  const { kind, anchor_mark_id, before, after } = req.body || {};
  if (!['insert', 'delete', 'replace'].includes(kind)) return res.status(400).json({ error: 'bad kind' });
  if (!anchor_mark_id) return res.status(400).json({ error: 'anchor_mark_id required' });
  const s = db.createSuggestion({
    document_id: a.doc.id,
    author_email: req.user.email,
    kind,
    anchor_mark_id,
    before,
    after,
  });
  res.json({ suggestion: s });
});

router.post('/:id/suggestions/:sid/resolve', (req, res) => {
  const a = access(req, res); if (!a) return;
  if (!a.isOwner) return res.status(403).json({ error: 'owner only' });
  const { state } = req.body || {};
  if (!['accepted', 'rejected'].includes(state)) return res.status(400).json({ error: 'bad state' });
  const s = db.resolveSuggestion(req.params.sid, state, req.user.email);
  res.json({ suggestion: s });
});
