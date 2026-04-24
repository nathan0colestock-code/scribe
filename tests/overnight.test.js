// Overnight suite additions for scribe:
//   - PDF export (byte length + %PDF magic)
//   - Markdown export (YAML frontmatter + block round-trip)
//   - Auto-archive to Black (happy path, 503 swallowed, network error swallowed)
//   - Trace-id propagation (echo + generate)
//   - Structured logging (ring buffer, /api/logs/recent, level filter)
//
// All tests run an in-process Express app with the relevant routers mounted.
// We never spawn the full server so we can deterministically inject a fake
// fetch for the Black client.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';

// Isolated DB before we import anything that touches it.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-overnight-'));
process.env.SCRIBE_DATA_DIR = tmp;
process.env.AUTH_PASSWORD = '';          // disable login gate for tests
process.env.API_KEY = 'test-api-key-scribe-on';
process.env.SUITE_API_KEY = 'test-suite-key-scribe-on';

const db = await import('../db.js');
const { router: exportsRouter, autoArchive, prosemirrorToPlain } = await import('../routes/exports.js');
const black = await import('../black.js');
const logger = await import('../log.js');
const exportsMod = await import('../exports.js');

// Minimal express app with just the routers we need. We skip the full
// auth/helmet stack so the tests focus on the new behaviour.
async function makeApp() {
  const express = (await import('express')).default;
  const app = express();
  app.use(express.json());
  // Simulate the global log middleware + owner user.
  app.use(logger.httpMiddleware);
  app.use((req, _res, next) => { req.user = { email: 'owner@local', role: 'editor', is_owner: true }; next(); });
  app.use('/api/documents', exportsRouter);
  // Expose logs endpoint like server.js does.
  app.get('/api/logs/recent', (req, res) => {
    res.json({ entries: logger.recent({ since: req.query.since, level: req.query.level, limit: req.query.limit }) });
  });
  return app;
}

function listen(app) {
  return new Promise((resolve) => {
    const server = app.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ server, port });
    });
  });
}

function req(port, urlPath, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body != null ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const hdrs = { ...headers };
    if (payload && !hdrs['Content-Type']) hdrs['Content-Type'] = 'application/json';
    if (payload) hdrs['Content-Length'] = Buffer.byteLength(payload);
    const r = http.request({ hostname: '127.0.0.1', port, path: urlPath, method, headers: hdrs }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        const text = buf.toString('utf8');
        let body;
        try { body = JSON.parse(text); } catch { body = text; }
        resolve({ status: res.statusCode, headers: res.headers, body, buffer: buf });
      });
    });
    r.on('error', reject);
    if (payload) r.write(payload);
    r.end();
  });
}

// ── Seed a doc with a real yjs state we can decode back ─────────────────────
async function seedDocWithDraft() {
  const Y = await import('yjs');
  const { prosemirrorJSONToYDoc } = await import('y-prosemirror');
  const Prosemirror = await import('prosemirror-model');
  const Schema = Prosemirror.Schema;
  // Minimal schema that covers paragraph/heading/text — enough to round trip
  // our test document. y-prosemirror needs a schema to hydrate the doc; we
  // stub a basic one rather than pulling in the full Tiptap starter-kit.
  const schema = new Schema({
    nodes: {
      doc: { content: 'block+' },
      paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0] },
      heading: {
        group: 'block', content: 'inline*',
        attrs: { level: { default: 1 } },
        toDOM: (n) => [`h${n.attrs.level}`, 0],
      },
      text: { group: 'inline' },
    },
    marks: {
      bold: { toDOM: () => ['strong', 0] },
      italic: { toDOM: () => ['em', 0] },
    },
  });
  const json = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Overnight Essay' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'The quick brown ' }, { type: 'text', marks: [{ type: 'bold' }], text: 'fox' }, { type: 'text', text: ' jumps.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'A second paragraph.' }] },
    ],
  };
  const ydoc = prosemirrorJSONToYDoc(schema, json, 'default');
  const update = Y.encodeStateAsUpdate(ydoc);

  const doc = db.createDocument({
    title: 'Overnight Essay',
    owner_email: 'owner@local',
    description: '',
    main_point: '',
  });
  db.setYjsState(doc.id, Buffer.from(update), 'draft');
  return db.getDocument(doc.id);
}

// ---------------------------------------------------------------------------
// SPEC 5 — PDF export
// ---------------------------------------------------------------------------

test('GET /api/documents/:id/export.pdf returns a real PDF', async () => {
  const doc = await seedDocWithDraft();
  const app = await makeApp();
  const { server, port } = await listen(app);
  try {
    const r = await req(port, `/api/documents/${doc.id}/export.pdf`);
    assert.equal(r.status, 200);
    assert.ok(r.buffer.length > 500, `PDF should be >500 bytes, got ${r.buffer.length}`);
    const magic = r.buffer.slice(0, 4).toString('utf8');
    assert.equal(magic, '%PDF', 'PDF must start with %PDF magic');
    assert.match(r.headers['content-type'], /application\/pdf/);
    assert.match(r.headers['content-disposition'] || '', /attachment/);
  } finally {
    await new Promise(r => server.close(r));
  }
});

// ---------------------------------------------------------------------------
// SPEC 5 — Markdown export
// ---------------------------------------------------------------------------

test('GET /api/documents/:id/export.md serializes blocks + frontmatter', async () => {
  const doc = await seedDocWithDraft();
  const app = await makeApp();
  const { server, port } = await listen(app);
  try {
    const r = await req(port, `/api/documents/${doc.id}/export.md`);
    assert.equal(r.status, 200);
    assert.match(r.headers['content-type'], /text\/markdown/);
    const md = r.body; // string, not JSON
    assert.ok(md.startsWith('---\n'), 'must begin with YAML frontmatter');
    assert.ok(md.includes('title: "Overnight Essay"'));
    assert.ok(md.includes(`id: "${doc.id}"`));
    assert.ok(md.includes('# Overnight Essay'), 'heading should serialize as H1');
    assert.ok(/The quick brown \*\*fox\*\* jumps\./.test(md), 'bold mark should round-trip to **fox**');
    assert.ok(md.includes('A second paragraph.'));
  } finally {
    await new Promise(r => server.close(r));
  }
});

// ---------------------------------------------------------------------------
// Auto-archive: happy path, 503 swallowed, network error swallowed, retry.
// ---------------------------------------------------------------------------

test('archiveIngest posts the expected payload on happy path', async () => {
  process.env.BLACK_URL = 'http://fake-black.local';
  process.env.BLACK_API_KEY = 'fake-key';
  let captured = null;
  const fakeFetch = async (url, opts) => {
    captured = { url, opts };
    return { ok: true, status: 200 };
  };
  const r = await black.archiveIngest({
    doc_id: 'd1', title: 'T', date: '2026-04-23T00:00:00Z',
    collection: 'essays', body_text: 'hello', url: 'https://s/d/d1',
    traceId: 'trace-xyz', fetchImpl: fakeFetch,
  });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
  const payload = JSON.parse(captured.opts.body);
  assert.equal(payload.kind, 'scribe');
  assert.equal(payload.doc_id, 'd1');
  assert.equal(payload.title, 'T');
  assert.equal(payload.collection, 'essays');
  assert.equal(payload.body_text, 'hello');
  assert.equal(captured.opts.headers['Authorization'], 'Bearer fake-key');
  assert.equal(captured.opts.headers['X-Trace-Id'], 'trace-xyz');
  assert.ok(captured.url.endsWith('/api/archive/ingest'));
});

test('archiveIngest retries once on 503 and swallows final failure', async () => {
  process.env.BLACK_URL = 'http://fake-black.local';
  process.env.BLACK_API_KEY = 'fake-key';
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    return { ok: false, status: 503 };
  };
  let logged = null;
  const r = await black.archiveIngest({
    doc_id: 'd2', body_text: 'x', fetchImpl: fakeFetch,
    log: (lvl, event, ctx) => { logged = { lvl, event, ctx }; },
  });
  assert.equal(calls, 2, 'should retry once on 503');
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
  assert.ok(logged, 'failure should be logged');
  assert.equal(logged.event, 'archive_ingest_failed');
});

test('archiveIngest handles fetch-thrown network error and does not throw', async () => {
  process.env.BLACK_URL = 'http://fake-black.local';
  process.env.BLACK_API_KEY = 'fake-key';
  let calls = 0;
  const fakeFetch = async () => {
    calls += 1;
    throw new Error('ECONNREFUSED');
  };
  const r = await black.archiveIngest({
    doc_id: 'd3', body_text: 'x', fetchImpl: fakeFetch, log: () => {},
  });
  assert.equal(calls, 2, 'network failures retry once');
  assert.equal(r.ok, false);
  assert.equal(r.status, 0);
});

test('archiveIngest skips silently when BLACK_URL is unset', async () => {
  delete process.env.BLACK_URL;
  const r = await black.archiveIngest({ doc_id: 'd4', body_text: 'x', log: () => {} });
  assert.equal(r.ok, false);
  assert.equal(r.skipped, true);
});

// ---------------------------------------------------------------------------
// Trace-id propagation (S-I-03)
// ---------------------------------------------------------------------------

test('httpMiddleware echoes X-Trace-Id when present', async () => {
  const app = await makeApp();
  const { server, port } = await listen(app);
  try {
    const r = await req(port, '/api/logs/recent', { headers: { 'X-Trace-Id': 'trace-from-client-999' } });
    assert.equal(r.status, 200);
    assert.equal(r.headers['x-trace-id'], 'trace-from-client-999');
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('httpMiddleware generates a trace-id when none is provided', async () => {
  const app = await makeApp();
  const { server, port } = await listen(app);
  try {
    const r = await req(port, '/api/logs/recent');
    assert.equal(r.status, 200);
    assert.ok(r.headers['x-trace-id']);
    assert.ok(r.headers['x-trace-id'].length >= 8);
  } finally {
    await new Promise(r => server.close(r));
  }
});

// ---------------------------------------------------------------------------
// Structured logging
// ---------------------------------------------------------------------------

test('/api/logs/recent returns ring-buffer entries', async () => {
  logger._reset();
  logger.log('info', 'test_event', { x: 1 });
  logger.log('error', 'boom', { y: 2 });
  const app = await makeApp();
  const { server, port } = await listen(app);
  try {
    const r = await req(port, '/api/logs/recent');
    assert.equal(r.status, 200);
    const events = r.body.entries.map(e => e.event);
    assert.ok(events.includes('test_event'));
    assert.ok(events.includes('boom'));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('level filter drops lower-severity entries', async () => {
  logger._reset();
  logger.log('info', 'quiet', {});
  logger.log('warn', 'loud', {});
  const app = await makeApp();
  const { server, port } = await listen(app);
  try {
    const r = await req(port, '/api/logs/recent?level=warn');
    const events = r.body.entries.map(e => e.event);
    assert.ok(events.includes('loud'));
    assert.ok(!events.includes('quiet'));
  } finally {
    await new Promise(r => server.close(r));
  }
});

test('ring buffer is bounded at MAX_ENTRIES', () => {
  logger._reset();
  for (let i = 0; i < logger.MAX_ENTRIES + 50; i++) logger.log('info', 'burst', { i });
  const all = logger.recent({ limit: 10000 });
  assert.ok(all.length <= logger.MAX_ENTRIES, `kept ${all.length}, max ${logger.MAX_ENTRIES}`);
});

// ---------------------------------------------------------------------------
// prosemirrorToPlain helper (sanity — feeds archive body_text)
// ---------------------------------------------------------------------------

test('prosemirrorToPlain collapses blocks into readable plain text', () => {
  const json = {
    type: 'doc',
    content: [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Title' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'body one' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'body two' }] },
    ],
  };
  const plain = prosemirrorToPlain(json);
  assert.ok(plain.includes('Title'));
  assert.ok(plain.includes('body one'));
  assert.ok(plain.includes('body two'));
});

// ---------------------------------------------------------------------------
// Export still works when doc has no draft state (empty buffer).
// ---------------------------------------------------------------------------

test('export.md on a doc with no yjs_state returns empty-body frontmatter', async () => {
  const doc = db.createDocument({ title: 'Blank', owner_email: 'owner@local' });
  const app = await makeApp();
  const { server, port } = await listen(app);
  try {
    const r = await req(port, `/api/documents/${doc.id}/export.md`);
    assert.equal(r.status, 200);
    assert.ok(r.body.startsWith('---\n'));
    assert.ok(r.body.includes('title: "Blank"'));
  } finally {
    await new Promise(r => server.close(r));
  }
});
