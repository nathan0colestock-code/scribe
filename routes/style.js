import express from 'express';
import * as db from '../db.js';

export const router = express.Router();

router.get('/', (req, res) => {
  if (!req.user.is_owner) return res.status(403).json({ error: 'owner only' });
  res.json({ guides: db.listStyleGuides(req.user.email) });
});

router.post('/', (req, res) => {
  if (!req.user.is_owner) return res.status(403).json({ error: 'owner only' });
  const { id, title, body_md } = req.body || {};
  if (!title) return res.status(400).json({ error: 'title required' });
  const guide = db.upsertStyleGuide({
    id: id || null,
    owner_email: req.user.email,
    title,
    body_md: body_md || '',
  });
  res.json({ guide });
});

router.delete('/:id', (req, res) => {
  if (!req.user.is_owner) return res.status(403).json({ error: 'owner only' });
  db.deleteStyleGuide(req.params.id, req.user.email);
  res.json({ ok: true });
});
