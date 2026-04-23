import express from 'express';
import * as db from '../db.js';

export const router = express.Router();

function ensureAccess(req, res, id) {
  const doc = db.getDocument(id);
  if (!doc) { res.status(404).json({ error: 'not found' }); return null; }
  const isOwner = req.user?.is_owner && doc.owner_email === req.user.email;
  const collabRole = req.user?.email ? db.getCollaboratorRole(id, req.user.email) : null;
  const shareRole = req.user?.documentId === id ? req.user.role : null;
  const role = isOwner ? 'editor' : (collabRole || shareRole);
  if (!role) { res.status(403).json({ error: 'forbidden' }); return null; }
  return { doc, role, isOwner };
}

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
