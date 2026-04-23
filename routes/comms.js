// POST /api/documents/:id/send-to-comms
//
// Hand off the current document's plaintext to comms as an outbound draft.
// Server-side call so the COMMS_API_KEY doesn't leak to the browser. The
// client supplies a recipient name (display name in comms) and an optional
// style; the doc body is passed as the `occasion` so comms's Gemini call
// has the full content as context.
//
// Today: we let comms regenerate the body from context + occasion (so the
// resulting draft is tone-matched to the recipient's history). Tomorrow: we
// may want a "send verbatim" mode — trivial additive change on comms's side.

import express from 'express';
import * as db from '../db.js';
import { draftMessage } from '../comms.js';

export const router = express.Router();

router.post('/:id/send-to-comms', async (req, res) => {
  const doc = db.getDocument(req.params.id);
  if (!doc) return res.status(404).json({ error: 'not found' });
  const isOwner = req.user?.is_owner && doc.owner_email === req.user.email;
  const role = isOwner ? 'editor'
    : (req.user?.email ? db.getCollaboratorRole(doc.id, req.user.email) : null);
  if (role !== 'editor') return res.status(403).json({ error: 'editor only' });

  const { contactName, bodyText, style, medium } = req.body || {};
  if (!contactName || typeof contactName !== 'string') {
    return res.status(400).json({ error: 'contactName required' });
  }
  const text = (typeof bodyText === 'string' ? bodyText : '').trim();
  if (!text) return res.status(400).json({ error: 'bodyText required (document is empty)' });

  // Pass the doc text as `occasion` so comms's prompt uses it as the full
  // reason / content for the outbound. Truncate to a reasonable size — the
  // route caps at 400 today but comms is tolerant of overflow (it slices).
  const occasion = `Send the following message, adapting only the tone to match the recipient — keep the substance intact:\n\n${text}`;

  try {
    const r = await draftMessage({
      contactName,
      occasion,
      style: ['warm', 'direct', 'formal'].includes(style) ? style : 'warm',
      medium: medium === 'imessage' ? 'imessage' : 'email',
    });
    res.json({ ok: true, ...r });
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
});
