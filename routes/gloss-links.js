import express from 'express';
import * as db from '../db.js';
import * as gloss from '../gloss.js';

export const router = express.Router();

function access(req, res) {
  const doc = db.getDocument(req.params.id);
  if (!doc) { res.status(404).json({ error: 'not found' }); return null; }
  const isOwner = req.user?.is_owner && doc.owner_email === req.user.email;
  const role = isOwner ? 'editor'
    : (req.user?.email ? db.getCollaboratorRole(doc.id, req.user.email) : null);
  if (!role) { res.status(403).json({ error: 'forbidden' }); return null; }
  return { doc, role, isOwner };
}

router.get('/:id/gloss/links', (req, res) => {
  const a = access(req, res); if (!a) return;
  const links = db.listGlossLinks(a.doc.id);
  const stats = db.transcriptStatsForDocument(a.doc.id);
  res.json({ links, stats });
});

router.post('/:id/gloss/links', async (req, res) => {
  const a = access(req, res); if (!a) return;
  if (a.role !== 'editor') return res.status(403).json({ error: 'editor only' });
  const { kind, gloss_id, label } = req.body || {};
  if (!['collection', 'topic', 'person', 'book', 'scripture'].includes(kind)) {
    return res.status(400).json({ error: 'bad kind' });
  }
  if (!gloss_id || !label) return res.status(400).json({ error: 'gloss_id and label required' });
  const link = db.addGlossLink(a.doc.id, { kind, gloss_id, label });

  // Fire-and-forget: hydrate transcripts and register back-link in Gloss.
  gloss.hydrateLink({ document_id: a.doc.id, kind, gloss_id, label })
    .catch(err => console.warn('[gloss] hydrate failed:', err.message));

  gloss.ensureGlossArtifact(a.doc, kind === 'collection' ? gloss_id : null)
    .catch(err => console.warn('[gloss] artifact sync failed:', err.message));

  res.json({ link });
});

router.delete('/:id/gloss/links/:linkId', (req, res) => {
  const a = access(req, res); if (!a) return;
  if (a.role !== 'editor') return res.status(403).json({ error: 'editor only' });
  db.removeGlossLink(Number(req.params.linkId), a.doc.id);
  res.json({ ok: true });
});

router.post('/:id/gloss/refresh', async (req, res) => {
  const a = access(req, res); if (!a) return;
  if (a.role !== 'editor') return res.status(403).json({ error: 'editor only' });
  try {
    const result = await gloss.hydrateAllLinksForDocument(a.doc.id);
    res.json({ ok: true, ...result });
  } catch (err) {
    res.status(502).json({ ok: false, error: err.message });
  }
});

router.get('/:id/gloss/picker', async (_req, res) => {
  // Aggregate options for the linker UI. Safe to share — these are labels, not prose.
  try {
    const [collections, topics, people, books, scripture] = await Promise.all([
      gloss.listCollections().catch(() => ({ groups: [] })),
      gloss.listTopics().catch(() => ({ entries: [] })),
      gloss.listPeople().catch(() => ({ entries: [] })),
      gloss.listBooks().catch(() => ({ entries: [] })),
      gloss.listScripture().catch(() => ({ entries: [] })),
    ]);
    res.json({ collections, topics, people, books, scripture });
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/:id/gloss/search', (req, res) => {
  const a = access(req, res); if (!a) return;
  const q = (req.query.q || '').toString();
  const hits = db.searchTranscriptsForDocument(a.doc.id, q, 30);
  const results = hits.map(h => ({
    page_id: h.page_id,
    snippet: h.snippet,
    source_kind: h.source_kind,
    captured_at: h.captured_at,
    volume: h.volume || null,
    page_number: h.page_number || null,
    collection_title: h.collection_title || null,
    // Widen to a 60-ish word window around the first match for the draggable card body.
    verbatim: extractWindow(h.transcript, q, 280),
    deep_link: gloss.pageDeepLink(h.page_id),
  }));
  res.json({ results });
});

function extractWindow(text, q, targetLen) {
  if (!text) return '';
  const first = (q.toLowerCase().match(/[a-z0-9]{3,}/g) || [])[0];
  if (!first) return text.slice(0, targetLen);
  const idx = text.toLowerCase().indexOf(first);
  if (idx < 0) return text.slice(0, targetLen);
  const start = Math.max(0, idx - Math.floor(targetLen / 3));
  const end = Math.min(text.length, start + targetLen);
  const out = text.slice(start, end);
  return (start > 0 ? '…' : '') + out + (end < text.length ? '…' : '');
}
