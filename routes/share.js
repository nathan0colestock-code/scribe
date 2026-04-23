import express from 'express';
import * as db from '../db.js';

export const router = express.Router();

router.post('/:id/share', (req, res) => {
  const doc = db.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'not found' });
  if (!req.user.is_owner || doc.owner_email !== req.user.email) {
    return res.status(403).json({ error: 'owner only' });
  }
  const { role } = req.body || {};
  const allowed = ['viewer', 'commenter', 'suggester', 'editor'];
  if (!allowed.includes(role)) return res.status(400).json({ error: 'bad role' });
  const token = db.createShareToken({ document_id: doc.id, role, created_by: req.user.email });
  res.json({ token });
});

router.get('/:id/shares', (req, res) => {
  const doc = db.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'not found' });
  if (!req.user.is_owner || doc.owner_email !== req.user.email) {
    return res.status(403).json({ error: 'owner only' });
  }
  res.json({ tokens: db.listShareTokens(doc.id) });
});

router.delete('/:id/shares/:token', (req, res) => {
  const doc = db.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'not found' });
  if (!req.user.is_owner || doc.owner_email !== req.user.email) {
    return res.status(403).json({ error: 'owner only' });
  }
  db.revokeShareToken(req.params.token);
  res.json({ ok: true });
});
