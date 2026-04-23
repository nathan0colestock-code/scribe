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

// POST /api/documents
//
// Optional body fields:
//   - source:    { kind: 'black'|'gloss'|..., ...origin-specific fields }
//                Persisted in documents.source_json and returned as-is on
//                GET /api/documents/:id. Only a plain object with a string
//                `kind` is stored — anything else is ignored.
//   - seed_body: plain text the caller wants injected into the initial
//                draft editor on first open. The server does not touch
//                Yjs here; instead we echo `seed_body` back to the client
//                which writes it to sessionStorage (scribe-seed-<id>) so
//                the existing PasteImportDialog hand-off in
//                src/App.jsx + DocumentView seeds the draft editor on
//                mount. Keeps the API surface Yjs-agnostic.
router.post('/', (req, res) => {
  if (!req.user.is_owner) return res.status(403).json({ error: 'owner only' });
  const { title, description, main_point, source, seed_body } = req.body || {};
  const safeSource = (source && typeof source === 'object' && typeof source.kind === 'string')
    ? source
    : null;
  const safeSeed = (typeof seed_body === 'string' && seed_body.length > 0) ? seed_body : null;
  const doc = db.createDocument({
    title: title || 'Untitled',
    owner_email: req.user.email,
    description: description || '',
    main_point: main_point || '',
    source: safeSource,
    // Persist seed_body on the row so a server-initiated create (e.g. black's
    // "Open in Scribe" endpoint → redirect) survives until the browser opens
    // the document. First call to GET /:id/pending-seed clears it.
    pending_seed: safeSeed,
  });
  const payload = { document: { ...doc, source: safeSource } };
  if (safeSeed) payload.seed_body = safeSeed;
  res.json(payload);
});

// Read-once: returns any pending_seed text queued when the doc was created,
// then clears it. Used by the DocumentView draft-seeding hand-off when the
// doc was seeded by a server-to-server create (e.g. Black's Open in Scribe).
router.get('/:id/pending-seed', (req, res) => {
  const access = ensureAccess(req, res, req.params.id);
  if (!access) return;
  if (access.role !== 'editor') return res.status(403).json({ error: 'editor only' });
  const seed = db.consumePendingSeed(req.params.id);
  res.json({ seed_body: seed });
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
      source: db.getDocumentSource(doc.id),
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
