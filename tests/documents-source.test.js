// Route tests for POST /api/documents accepting optional `source` + `seed_body`.
//
// Spawns a real server (same pattern as status.test.js) with auth disabled
// via the dev fallback — AUTH_PASSWORD unset → the server treats the
// request as the owner, so POST /api/documents is allowed without cookies.

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_PATH = path.join(__dirname, '..', 'server.js');

function freePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on('error', reject);
    srv.listen(0, () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

async function waitForHealth(port, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/api/health`);
      if (r.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error('server did not come up in time');
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-docsrc-'));
let port;
let child;

test.before(async () => {
  port = await freePort();
  child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',
      AUTH_PASSWORD: '',         // AUTH_ENABLED=false → owner identity is implicit
      SCRIBE_DATA_DIR: tmp,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stderr.on('data', (d) => process.stderr.write(`[server] ${d}`));
  await waitForHealth(port);
});

test.after(async () => {
  if (child && !child.killed) {
    child.kill('SIGTERM');
    await new Promise((r) => child.once('exit', r));
  }
  fs.rmSync(tmp, { recursive: true, force: true });
});

test('POST /api/documents persists source + echoes seed_body; GET returns source', async () => {
  const source = {
    kind: 'black',
    file_id: 'drive-file-123',
    drive_path: '/Personal/Archive/Notes.md',
    web_view_link: 'https://drive.google.com/file/d/xyz/view',
  };
  const seed_body = 'First paragraph.\n\nSecond paragraph.';

  const createRes = await fetch(`http://127.0.0.1:${port}/api/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Seeded from Black',
      description: 'archive hand-off',
      source,
      seed_body,
    }),
  });
  assert.equal(createRes.status, 200);
  const createBody = await createRes.json();
  assert.ok(createBody.document, 'document returned');
  assert.equal(createBody.document.title, 'Seeded from Black');
  // Server must echo the source back so the client has it immediately
  // (saves a round-trip to GET).
  assert.deepEqual(createBody.document.source, source);
  // seed_body is echoed so the client can stash it in sessionStorage for
  // the DocumentView draft-seeding hand-off.
  assert.equal(createBody.seed_body, seed_body);

  const id = createBody.document.id;
  const getRes = await fetch(`http://127.0.0.1:${port}/api/documents/${id}`);
  assert.equal(getRes.status, 200);
  const getBody = await getRes.json();
  assert.deepEqual(getBody.document.source, source);
});

test('POST /api/documents without source leaves source = null on GET', async () => {
  const createRes = await fetch(`http://127.0.0.1:${port}/api/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'No source doc' }),
  });
  assert.equal(createRes.status, 200);
  const createBody = await createRes.json();
  assert.equal(createBody.document.source, null);
  assert.equal(createBody.seed_body, undefined);

  const id = createBody.document.id;
  const getRes = await fetch(`http://127.0.0.1:${port}/api/documents/${id}`);
  const getBody = await getRes.json();
  assert.equal(getBody.document.source, null);
});

test('GET /api/documents/:id/pending-seed is read-once', async () => {
  const source = { kind: 'black', file_id: 'f-1' };
  const seed_body = 'Seeded line.';
  const r = await fetch(`http://127.0.0.1:${port}/api/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: 'ps', source, seed_body }),
  });
  const { document } = await r.json();
  const first = await fetch(`http://127.0.0.1:${port}/api/documents/${document.id}/pending-seed`);
  assert.equal(first.status, 200);
  const firstBody = await first.json();
  assert.equal(firstBody.seed_body, seed_body);
  const second = await fetch(`http://127.0.0.1:${port}/api/documents/${document.id}/pending-seed`);
  const secondBody = await second.json();
  assert.equal(secondBody.seed_body, null, 'seed is consumed on first read');
});

test('POST /api/documents ignores malformed source (no kind)', async () => {
  const createRes = await fetch(`http://127.0.0.1:${port}/api/documents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      title: 'Bad source',
      source: { not_a_kind: 'oops' },
    }),
  });
  assert.equal(createRes.status, 200);
  const body = await createRes.json();
  assert.equal(body.document.source, null, 'malformed source dropped');
});
