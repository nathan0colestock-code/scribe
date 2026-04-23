import express from 'express';
import * as db from '../db.js';
import { ensureAccess } from './_access.js';

export const router = express.Router();

const access = (req, res) => ensureAccess(req, res);

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
