// Unit tests for the Readwise integration — parser + search route.
// Live API calls are intentionally excluded (no network in CI).

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-rw-'));
process.env.SCRIBE_DATA_DIR = tmp;

const db = await import('../db.js');
const readwise = await import('../readwise.js');
const routes = await import('../routes/readwise.js');

test.after(() => {
  try { db.db.close(); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

// A sample page from the Readwise v2 /highlights/ response (trimmed, real shape).
// Copied from Readwise's public API docs + observed field set.
const READWISE_HIGHLIGHTS_PAGE = {
  count: 2,
  next: null,
  previous: null,
  results: [
    {
      id: 101,
      text: 'The unexamined life is not worth living.',
      note: 'Socrates, Apology',
      location: 38,
      location_type: 'page',
      color: 'yellow',
      book_id: 7,
      highlighted_at: '2026-03-01T14:22:31Z',
      updated: '2026-03-01T14:22:31Z',
      url: null,
    },
    {
      id: 102,
      text: 'Begin with the end in mind.',
      note: null,
      location: 0,
      location_type: 'none',
      color: '',
      book_id: 8,
      highlighted_at: null,
      updated: '2026-04-01T09:00:00Z',
      url: 'https://example.com/habit',
    },
  ],
};

const READWISE_BOOKS_PAGE = {
  count: 2,
  next: null,
  previous: null,
  results: [
    {
      id: 7,
      title: 'Apology',
      author: 'Plato',
      category: 'books',
      source_url: null,
      cover_image_url: 'https://rw.example/plato.jpg',
      num_highlights: 42,
    },
    {
      id: 8,
      title: '7 Habits',
      author: 'Stephen Covey',
      category: 'books',
      source_url: 'https://example.com/7habits',
      cover_image_url: null,
      num_highlights: 17,
    },
  ],
};

test('normalizeHighlight flattens location_type+location and fills updated fallback', () => {
  const h = readwise.normalizeHighlight(READWISE_HIGHLIGHTS_PAGE.results[0]);
  assert.equal(h.id, 101);
  assert.equal(h.book_id, 7);
  assert.equal(h.text, 'The unexamined life is not worth living.');
  assert.equal(h.note, 'Socrates, Apology');
  assert.equal(h.location, 'page 38');
  assert.equal(h.highlighted_at, '2026-03-01T14:22:31Z');
  assert.equal(h.updated, '2026-03-01T14:22:31Z');

  const none = readwise.normalizeHighlight(READWISE_HIGHLIGHTS_PAGE.results[1]);
  assert.equal(none.location, '0', "location_type='none' collapses to just the number");
  assert.equal(none.highlighted_at, null);
  assert.equal(none.updated, '2026-04-01T09:00:00Z');
  assert.equal(none.url, 'https://example.com/habit');
});

test('normalizeBook picks cover_image_url and defaults category', () => {
  const b = readwise.normalizeBook(READWISE_BOOKS_PAGE.results[0]);
  assert.equal(b.id, 7);
  assert.equal(b.title, 'Apology');
  assert.equal(b.author, 'Plato');
  assert.equal(b.category, 'books');
  assert.equal(b.cover_url, 'https://rw.example/plato.jpg');
  assert.equal(b.num_highlights, 42);

  const untitled = readwise.normalizeBook({ id: 99, title: '', author: null });
  assert.equal(untitled.title, 'Untitled');
  assert.equal(untitled.category, 'books');
  assert.equal(untitled.num_highlights, 0);
});

test('listHighlights paginates via fake fetch and passes updated__gt when since given', async () => {
  const seen = [];
  const fakeFetch = async (url) => {
    seen.push(url);
    return {
      ok: true,
      status: 200,
      async json() { return READWISE_HIGHLIGHTS_PAGE; },
      async text() { return ''; },
      headers: { get() { return null; } },
    };
  };
  const out = await readwise.listHighlights({
    token: 't',
    since: '2026-01-01T00:00:00Z',
    fetchImpl: fakeFetch,
    pageSize: 100,
  });
  assert.equal(out.length, 2);
  assert.ok(seen[0].includes('updated__gt=2026-01-01'), 'since is passed through as updated__gt');
  assert.ok(seen[0].includes('page_size=100'), 'page_size is passed through');
});

test('runSync synthesizes placeholder books when highlight arrives ahead of book', async () => {
  // Simulate Readwise returning NO books but a highlight referencing book 404.
  const fakeClients = {
    listBooks: async () => [],
    listHighlights: async () => [{
      id: 999,
      book_id: 404,
      text: 'Orphan highlight.',
      note: null,
      location: null,
      url: null,
      highlighted_at: null,
      updated: '2026-04-23T00:00:00Z',
    }],
  };
  const result = await routes.runSync({ token: 't', since: null, clients: fakeClients });
  assert.equal(result.highlights_upserted, 1);
  assert.equal(result.books_upserted, 0);
  // The placeholder book should have been created.
  const placeholder = db.getReadwiseBook(404);
  assert.ok(placeholder, 'placeholder book was inserted');
  assert.equal(placeholder.title, 'Unknown source');
});

test('searchReadwiseHighlights finds hits on text, note, and book title', () => {
  // Seed rows directly.
  db.upsertReadwiseBook({ id: 200, title: 'Meditations', author: 'Marcus Aurelius', category: 'books' });
  db.upsertReadwiseBook({ id: 201, title: 'Essentialism', author: 'Greg McKeown', category: 'books' });
  db.upsertReadwiseHighlight({
    id: 300, book_id: 200,
    text: 'Waste no more time arguing about what a good man should be. Be one.',
    note: null, location: null, url: null, highlighted_at: null,
    updated: '2026-04-01T00:00:00Z',
  });
  db.upsertReadwiseHighlight({
    id: 301, book_id: 201,
    text: 'The disciplined pursuit of less.',
    note: 'Touchstone for the quarterly planning doc',
    location: null, url: null, highlighted_at: null,
    updated: '2026-04-02T00:00:00Z',
  });

  const byText = db.searchReadwiseHighlights('arguing', 20);
  assert.equal(byText.length, 1);
  assert.equal(byText[0].highlight_id, 300);

  const byNote = db.searchReadwiseHighlights('quarterly', 20);
  assert.equal(byNote.length, 1);
  assert.equal(byNote[0].highlight_id, 301);

  const byBookTitle = db.searchReadwiseHighlights('Meditations', 20);
  assert.ok(byBookTitle.some(r => r.highlight_id === 300), 'search matches book title');

  const none = db.searchReadwiseHighlights('', 20);
  assert.equal(none.length, 0, 'empty query returns no rows');

  // LIKE escaping: a % should be treated literally, not as wildcard.
  const literalPct = db.searchReadwiseHighlights('%arguing%', 20);
  assert.equal(literalPct.length, 0, 'LIKE metachars are escaped');
});
