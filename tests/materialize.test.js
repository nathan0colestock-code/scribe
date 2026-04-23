// Materialize test — verifies outline + cards produce the expected Tiptap JSON
// shape (heading → heading, card_ref → blockquote + glossAttribution, bullet → paragraph).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-mat-'));
process.env.SCRIBE_DATA_DIR = tmp;
process.env.GLOSS_URL = 'http://gloss.local';

const db = await import('../db.js');

// Pure function mirroring the logic in routes/outline.js. Kept here so the
// test doesn't need the Express stack; any divergence is a signal to align.
function buildFragment(document_id, GLOSS_URL) {
  const outline = db.listOutline(document_id);
  const cards = new Map(db.listCards(document_id).map(c => [c.id, c]));
  const children = new Map();
  for (const n of outline) {
    const key = n.parent_id || '__root__';
    if (!children.has(key)) children.set(key, []);
    children.get(key).push(n);
  }
  for (const list of children.values()) list.sort((x, y) => x.position - y.position);

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
      for (const nested of walk(n.id)) blocks.push(nested);
    }
    return blocks;
  }
  return { type: 'doc', content: walk(null) };
}

test.after(() => {
  try { db.db.close(); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('materialize: heading + card_ref + bullet → expected Tiptap JSON', () => {
  const doc = db.createDocument({ owner_email: 'owner@scribe.local', title: 'Mat' });

  const card = db.upsertCard({
    document_id: doc.id,
    page_id: 'page-abc',
    snippet: 'Verbatim snippet from the notebook about Sanballat.',
    start_offset: 0,
    end_offset: 52,
    source_label: 'Nehemiah 6, p. 2',
  });

  db.createOutlineNode({
    document_id: doc.id, kind: 'heading', text: 'Facing Sanballat', position: 0,
  });
  db.createOutlineNode({
    document_id: doc.id, kind: 'card_ref', text: '', card_id: card.id, position: 1,
  });
  db.createOutlineNode({
    document_id: doc.id, kind: 'bullet', text: 'Close with the call to courage', position: 2,
  });

  const frag = buildFragment(doc.id, 'http://gloss.local');
  assert.equal(frag.type, 'doc');
  assert.equal(frag.content.length, 3);

  // Heading
  assert.deepEqual(frag.content[0], {
    type: 'heading',
    attrs: { level: 2 },
    content: [{ type: 'text', text: 'Facing Sanballat' }],
  });

  // Blockquote with verbatim snippet and gloss attribution
  const bq = frag.content[1];
  assert.equal(bq.type, 'blockquote');
  assert.equal(bq.content[0].content[0].text, card.snippet, 'blockquote contains verbatim snippet');
  const attrMark = bq.content[1].content[1].marks[0];
  assert.equal(attrMark.type, 'glossAttribution');
  assert.equal(attrMark.attrs.pageId, 'page-abc');
  assert.equal(attrMark.attrs.href, 'http://gloss.local/page/page-abc');

  // Bullet
  assert.deepEqual(frag.content[2], {
    type: 'paragraph',
    content: [{ type: 'text', text: 'Close with the call to courage' }],
  });
});

test('materialize: missing card falls back to empty paragraph (no crash)', () => {
  const doc = db.createDocument({ owner_email: 'owner@scribe.local', title: 'Orphan' });
  db.createOutlineNode({
    document_id: doc.id, kind: 'card_ref', text: '', card_id: 'does-not-exist', position: 0,
  });
  const frag = buildFragment(doc.id, 'http://gloss.local');
  assert.equal(frag.content.length, 1);
  assert.equal(frag.content[0].type, 'paragraph');
});
