import express from 'express';
import * as db from '../db.js';

export const router = express.Router();

function access(req, res) {
  const doc = db.getDocument(req.params.id);
  if (!doc) { res.status(404).json({ error: 'not found' }); return null; }
  const isOwner = req.user?.is_owner && doc.owner_email === req.user.email;
  const role = isOwner ? 'editor'
    : (req.user?.email ? db.getCollaboratorRole(doc.id, req.user.email) : null)
    || (req.user?.documentId === doc.id ? req.user.role : null);
  if (!role) { res.status(403).json({ error: 'forbidden' }); return null; }
  return { doc, role, isOwner };
}

router.get('/:id/outline', (req, res) => {
  const a = access(req, res); if (!a) return;
  res.json({
    outline: db.listOutline(a.doc.id),
    cards: db.listCards(a.doc.id),
  });
});

router.post('/:id/outline', (req, res) => {
  const a = access(req, res); if (!a) return;
  if (a.role !== 'editor') return res.status(403).json({ error: 'editor only' });
  const { parent_id, position, kind, text, card_id } = req.body || {};
  const node = db.createOutlineNode({
    document_id: a.doc.id,
    parent_id: parent_id || null,
    position: position ?? 0,
    kind: kind || 'bullet',
    text: text || '',
    card_id: card_id || null,
  });
  if (card_id) db.setCardState(card_id, 'in_outline');
  res.json({ node });
});

router.patch('/:id/outline/:nodeId', (req, res) => {
  const a = access(req, res); if (!a) return;
  if (a.role !== 'editor') return res.status(403).json({ error: 'editor only' });
  const node = db.updateOutlineNode(req.params.nodeId, req.body || {});
  res.json({ node });
});

router.delete('/:id/outline/:nodeId', (req, res) => {
  const a = access(req, res); if (!a) return;
  if (a.role !== 'editor') return res.status(403).json({ error: 'editor only' });
  db.deleteOutlineNode(req.params.nodeId);
  res.json({ ok: true });
});

// Create or fetch a candidate card for a FTS hit.
router.post('/:id/cards', (req, res) => {
  const a = access(req, res); if (!a) return;
  const { page_id, snippet, start_offset, end_offset, source_label } = req.body || {};
  if (!page_id || !snippet) return res.status(400).json({ error: 'page_id and snippet required' });
  const card = db.upsertCard({
    document_id: a.doc.id,
    page_id,
    snippet,
    start_offset: start_offset || 0,
    end_offset: end_offset || snippet.length,
    source_label: source_label || null,
  });
  res.json({ card });
});

// Build a Tiptap JSON fragment for the outline's materialization.
router.post('/:id/materialize', (req, res) => {
  const a = access(req, res); if (!a) return;
  if (a.role !== 'editor') return res.status(403).json({ error: 'editor only' });
  const outline = db.listOutline(a.doc.id);
  const cards = new Map(db.listCards(a.doc.id).map(c => [c.id, c]));
  const children = new Map();
  for (const n of outline) {
    const key = n.parent_id || '__root__';
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(n);
  }
  for (const list of children.values()) list.sort((x, y) => x.position - y.position);

  const GLOSS_URL = (process.env.GLOSS_URL || 'http://localhost:3747').replace(/\/$/, '');
  function nodeJson(n) {
    if (n.kind === 'heading') {
      return { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: n.text || 'Section' }] };
    }
    if (n.kind === 'card_ref' && n.card_id && cards.has(n.card_id)) {
      const c = cards.get(n.card_id);
      const attrUrl = `${GLOSS_URL}/page/${encodeURIComponent(c.page_id)}`;
      return {
        type: 'blockquote',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: c.snippet }] },
          { type: 'paragraph', content: [
            { type: 'text', text: '— ', marks: [] },
            { type: 'text', text: c.source_label || `Gloss page ${c.page_id}`,
              marks: [{ type: 'glossAttribution', attrs: { href: attrUrl, pageId: String(c.page_id) } }] },
          ] },
        ],
      };
    }
    return { type: 'paragraph', content: n.text ? [{ type: 'text', text: n.text }] : [] };
  }

  function walk(parent_id) {
    const list = children.get(parent_id || '__root__') || [];
    const blocks = [];
    for (const n of list) {
      blocks.push(nodeJson(n));
      // Headings/bullets may have children — flatten after parent.
      for (const nested of walk(n.id)) blocks.push(nested);
    }
    return blocks;
  }

  const fragment = { type: 'doc', content: walk(null) };
  // Flip all card_ref cards to materialized.
  for (const n of outline) {
    if (n.kind === 'card_ref' && n.card_id) db.setCardState(n.card_id, 'materialized');
  }
  res.json({ fragment });
});
