import express from 'express';
import * as db from '../db.js';
import { snapshotForStageTransition } from '../collab.js';
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
  const body = req.body || {};
  // Stage transitions are client-side state (localStorage), but when the
  // client tells us one is happening we snapshot the current yjs_state
  // so the "undo an entire outline→draft transition" affordance works.
  // body = { stage: 'draft', previous_stage: 'outline', stage_kind?: 'draft'|'outline' }
  const { stage, previous_stage, stage_kind } = body;
  if (stage && previous_stage && stage !== previous_stage) {
    try {
      snapshotForStageTransition(req.params.id, previous_stage, stage, stage_kind || 'draft');
    } catch (err) {
      console.warn(`[documents PATCH] stage snapshot failed: ${err.message}`);
    }
  }
  const doc = db.updateDocumentMeta(req.params.id, body);
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
