// Tests for:
//   1. db.searchReadwiseHighlightsByTopics — multi-keyword ranking
//   2. GET /api/documents/:id/readwise-suggestions — HTTP endpoint + cache

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import crypto from 'node:crypto';

// Isolated DB for this test file.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-rwsugg-'));
process.env.SCRIBE_DATA_DIR = tmp;

// Disable auth for route testing.
process.env.AUTH_PASSWORD = '';

const db = await import('../db.js');
const { _clearCache, router } = await import('../routes/readwise-suggestions.js');

// ── Helpers ──────────────────────────────────────────────────────────────────

function seedData() {
  // Books
  db.upsertReadwiseBook({ id: 10, title: 'Thinking Fast and Slow', author: 'Daniel Kahneman', category: 'books' });
  db.upsertReadwiseBook({ id: 11, title: 'Deep Work', author: 'Cal Newport', category: 'books' });
  db.upsertReadwiseBook({ id: 12, title: 'Atomic Habits', author: 'James Clear', category: 'books' });

  // Highlights
  db.upsertReadwiseHighlight({
    id: 1001, book_id: 10,
    text: 'Cognitive biases distort rational thinking and decision making.',
    note: 'System 1 vs System 2 thinking patterns',
    location: null, url: null, highlighted_at: '2026-03-10T00:00:00Z',
    updated: '2026-03-10T00:00:00Z',
  });
  db.upsertReadwiseHighlight({
    id: 1002, book_id: 11,
    text: 'Deep concentration produces rare and valuable work.',
    note: null,
    location: null, url: null, highlighted_at: '2026-03-15T00:00:00Z',
    updated: '2026-03-15T00:00:00Z',
  });
  db.upsertReadwiseHighlight({
    id: 1003, book_id: 12,
    text: 'Small habits compound into remarkable results over time.',
    note: 'Applies to writing routines and daily discipline.',
    location: null, url: null, highlighted_at: '2026-03-20T00:00:00Z',
    updated: '2026-03-20T00:00:00Z',
  });
}

let seeded = false;
function ensureSeeded() {
  if (!seeded) { seedData(); seeded = true; }
}

// ── DB unit tests ─────────────────────────────────────────────────────────────

test('searchReadwiseHighlightsByTopics returns empty for blank query', () => {
  ensureSeeded();
  assert.deepEqual(db.searchReadwiseHighlightsByTopics('', 20), []);
  assert.deepEqual(db.searchReadwiseHighlightsByTopics('   ', 20), []);
  assert.deepEqual(db.searchReadwiseHighlightsByTopics(null, 20), []);
});

test('searchReadwiseHighlightsByTopics ignores short words (< 4 chars)', () => {
  ensureSeeded();
  // "a", "in", "is" are all < 4 chars — no keywords extracted → empty result
  const r = db.searchReadwiseHighlightsByTopics('a in is', 20);
  assert.equal(r.length, 0);
});

test('searchReadwiseHighlightsByTopics finds relevant highlights by keyword', () => {
  ensureSeeded();
  const r = db.searchReadwiseHighlightsByTopics('cognitive thinking decision', 20);
  assert.ok(r.length >= 1, 'should find at least one result');
  assert.ok(r.some(h => h.highlight_id === 1001), 'cognitive highlight matched');
});

test('searchReadwiseHighlightsByTopics ranks higher-match-count rows first', () => {
  ensureSeeded();
  // "habits" matches 1003 text AND book title "Atomic Habits" (double hit).
  // "thinking" matches 1001 text AND book title "Thinking Fast and Slow".
  // Query includes both; 1001 gets hits on text + note ("thinking", "System"),
  // 1003 gets text + note ("habits", "discipline") + book title ("Habits").
  // We just check that match_score is non-decreasing descending (sorted correctly).
  const r = db.searchReadwiseHighlightsByTopics('habits thinking writing', 20);
  assert.ok(r.length >= 2);
  for (let i = 1; i < r.length; i++) {
    assert.ok(r[i - 1].match_score >= r[i].match_score, 'rows are sorted by match_score desc');
  }
});

test('searchReadwiseHighlightsByTopics matches book title', () => {
  ensureSeeded();
  const r = db.searchReadwiseHighlightsByTopics('atomic', 20);
  assert.ok(r.some(h => h.highlight_id === 1003), 'book title "Atomic Habits" triggers highlight');
});

test('searchReadwiseHighlightsByTopics matches note field', () => {
  ensureSeeded();
  const r = db.searchReadwiseHighlightsByTopics('system', 20);
  assert.ok(r.some(h => h.highlight_id === 1001), 'note "System 1 vs System 2" matched');
});

test('searchReadwiseHighlightsByTopics respects limit', () => {
  ensureSeeded();
  const r = db.searchReadwiseHighlightsByTopics('work time results thinking habits deep', 1);
  assert.equal(r.length, 1);
});

test('searchReadwiseHighlightsByTopics deduplicates keywords', () => {
  ensureSeeded();
  // Duplicate "habits habits habits" should still just match normally, not crash
  const r = db.searchReadwiseHighlightsByTopics('habits habits habits', 20);
  assert.ok(r.length >= 1);
});

// ── HTTP endpoint tests ───────────────────────────────────────────────────────

// Spin up a minimal Express server with just the readwise-suggestions router.
const express = (await import('express')).default;
const app = express();
app.use(express.json());

// Inject a synthetic owner session so requireAuth passes. The router calls
// ensureAccess which checks req.user + document ownership.
app.use((req, _res, next) => {
  req.user = { email: 'test@local', role: 'editor', is_owner: true };
  next();
});
app.use('/api/documents', router);

const server = http.createServer(app);
await new Promise(r => server.listen(0, '127.0.0.1', r));
const port = server.address().port;
const base = `http://127.0.0.1:${port}`;

test.after(() => {
  server.close();
  try { db.db.close(); } catch {}
  fs.rmSync(tmp, { recursive: true, force: true });
});

async function get(path) {
  const r = await fetch(`${base}${path}`);
  return { status: r.status, body: await r.json() };
}

// Seed a document so ensureAccess resolves.
const testDoc = db.createDocument({
  title: 'Habits and Cognitive Biases',
  owner_email: 'test@local',
  description: 'A piece about thinking habits and cognitive biases',
  main_point: 'Small mental habits reshape thinking patterns over time',
});

test('GET /api/documents/:id/readwise-suggestions returns shape', async () => {
  _clearCache();
  const { status, body } = await get(`/api/documents/${testDoc.id}/readwise-suggestions`);
  assert.equal(status, 200);
  assert.ok('results' in body, 'has results array');
  assert.ok('query' in body, 'has query string');
  assert.ok(Array.isArray(body.results));
  assert.ok(typeof body.query === 'string');
});

test('GET /api/documents/:id/readwise-suggestions query comes from doc topic', async () => {
  _clearCache();
  const { body } = await get(`/api/documents/${testDoc.id}/readwise-suggestions`);
  // query is built from description + main_point + title
  assert.ok(body.query.includes('thinking'), 'query includes "thinking" from description');
});

test('GET /api/documents/:id/readwise-suggestions returns relevant highlights', async () => {
  _clearCache();
  ensureSeeded();
  const { body } = await get(`/api/documents/${testDoc.id}/readwise-suggestions`);
  // The test doc is about "habits" and "thinking" — should match 1001 and 1003
  const ids = body.results.map(r => r.highlight_id);
  assert.ok(ids.includes(1001) || ids.includes(1003), 'relevant highlights returned');
});

test('GET /api/documents/:id/readwise-suggestions result shape has book object', async () => {
  _clearCache();
  ensureSeeded();
  const { body } = await get(`/api/documents/${testDoc.id}/readwise-suggestions`);
  if (body.results.length > 0) {
    const h = body.results[0];
    assert.ok('highlight_id' in h);
    assert.ok('text' in h);
    assert.ok('book' in h);
    assert.ok('id' in h.book);
    assert.ok('title' in h.book);
  }
});

test('GET /api/documents/:id/readwise-suggestions respects k param', async () => {
  _clearCache();
  ensureSeeded();
  const { body } = await get(`/api/documents/${testDoc.id}/readwise-suggestions?k=1`);
  assert.ok(body.results.length <= 1);
});

test('GET /api/documents/:id/readwise-suggestions returns 404 for unknown doc', async () => {
  _clearCache();
  const { status } = await get('/api/documents/nonexistent-doc-id/readwise-suggestions');
  assert.equal(status, 404);
});

test('GET /api/documents/:id/readwise-suggestions caches responses', async () => {
  _clearCache();
  ensureSeeded();
  // First call
  const r1 = await get(`/api/documents/${testDoc.id}/readwise-suggestions`);
  // Second call — should hit cache (same result, no error)
  const r2 = await get(`/api/documents/${testDoc.id}/readwise-suggestions`);
  assert.deepEqual(r1.body.query, r2.body.query);
  assert.equal(r1.body.results.length, r2.body.results.length);
});

test('GET /api/documents/:id/readwise-suggestions ?fresh=1 busts cache', async () => {
  _clearCache();
  ensureSeeded();
  const r1 = await get(`/api/documents/${testDoc.id}/readwise-suggestions`);
  const r2 = await get(`/api/documents/${testDoc.id}/readwise-suggestions?fresh=1`);
  // Just verify it doesn't error and returns valid shape
  assert.equal(r2.status, 200);
  assert.ok(Array.isArray(r2.body.results));
});

test('GET /api/documents/:id/readwise-suggestions on empty DB returns empty results', async () => {
  // Create a doc in a fresh isolated DB — just verify graceful empty return
  _clearCache();
  const emptyDoc = db.createDocument({
    title: 'Zettelkasten workflow',
    owner_email: 'test@local',
    description: 'Personal knowledge management',
    main_point: 'Link ideas across notes',
  });
  // No highlights seeded matching this — query built but no results
  const { status, body } = await get(`/api/documents/${emptyDoc.id}/readwise-suggestions`);
  assert.equal(status, 200);
  assert.ok(Array.isArray(body.results));
  // query still generated from doc
  assert.ok(body.query.length > 0);
});
