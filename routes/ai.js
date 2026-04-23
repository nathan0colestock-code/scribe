import express from 'express';
import * as ai from '../ai.js';
import * as db from '../db.js';

export const router = express.Router();

function accessDoc(req, res, id) {
  const doc = db.getDocument(id);
  if (!doc) { res.status(404).json({ error: 'not found' }); return null; }
  const isOwner = req.user?.is_owner && doc.owner_email === req.user.email;
  const role = isOwner ? 'editor'
    : (req.user?.email ? db.getCollaboratorRole(doc.id, req.user.email) : null)
    || (req.user?.documentId === doc.id ? req.user.role : null);
  if (!role || role === 'viewer') { res.status(403).json({ error: 'forbidden' }); return null; }
  return { doc, role, isOwner };
}

router.post('/proofread', async (req, res) => {
  const { document_id, text } = req.body || {};
  if (!document_id) return res.status(400).json({ error: 'document_id required' });
  if (typeof text !== 'string') return res.status(400).json({ error: 'text required' });
  const a = accessDoc(req, res, document_id); if (!a) return;
  try {
    const result = await ai.proofread(text.slice(0, 20000));
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message, suggestions: [] });
  }
});

router.post('/style-check', async (req, res) => {
  const { document_id, text } = req.body || {};
  if (!document_id) return res.status(400).json({ error: 'document_id required' });
  if (typeof text !== 'string') return res.status(400).json({ error: 'text required' });
  const a = accessDoc(req, res, document_id); if (!a) return;
  const guideId = a.doc.style_guide_id;
  const guide = guideId ? db.getStyleGuide(guideId) : null;
  try {
    const result = await ai.styleCheck(text.slice(0, 20000), guide?.body_md || '');
    res.json({ ...result, guide_title: guide?.title || null });
  } catch (err) {
    res.status(502).json({ error: err.message, suggestions: [] });
  }
});
