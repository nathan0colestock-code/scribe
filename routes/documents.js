import express from 'express';
import * as db from '../db.js';
import { ensureAccess as ensureAccessImpl } from './_access.js';

export const router = express.Router();

const ensureAccess = (req, res, id) => ensureAccessImpl(req, res, { docId: id });

router.get('/', (req, res) => {
  const email = req.user.email;
  res.json({ documents: db.listDocumentsForUser(email) });
});

router.post('/', (req, res) => {
  if (!req.user.is_owner) return res.status(403).json({ error: 'owner only' });
  const { title, description, main_point } = req.body || {};
  const doc = db.createDocument({
    title: title || 'Untitled',
    owner_email: req.user.email,
    description: description || '',
    main_point: main_point || '',
  });
  res.json({ document: doc });
});

router.get('/:id', (req, res) => {
  const access = ensureAccess(req, res, req.params.id);
  if (!access) return;
  const { doc, role, isOwner } = access;
  res.json({
    document: {
      id: doc.id,
      title: doc.title,
      description: doc.description,
      main_point: doc.main_point,
      style_guide_id: doc.style_guide_id,
      owner_email: doc.owner_email,
      created_at: doc.created_at,
      updated_at: doc.updated_at,
    },
    role,
    is_owner: isOwner,
  });
});

router.patch('/:id', (req, res) => {
  const access = ensureAccess(req, res, req.params.id);
  if (!access) return;
  if (access.role !== 'editor') return res.status(403).json({ error: 'editor only' });
  const doc = db.updateDocumentMeta(req.params.id, req.body || {});
  res.json({ document: doc });
});

router.delete('/:id', (req, res) => {
  const access = ensureAccess(req, res, req.params.id);
  if (!access) return;
  if (!access.isOwner) return res.status(403).json({ error: 'owner only' });
  db.deleteDocument(req.params.id);
  res.json({ ok: true });
});

router.get('/:id/collaborators', (req, res) => {
  const access = ensureAccess(req, res, req.params.id);
  if (!access) return;
  res.json({ collaborators: db.listCollaborators(req.params.id) });
});
