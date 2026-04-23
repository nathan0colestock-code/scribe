// Integration tests for /api/status.
//
// server.js is a top-level script that binds to PORT on import, so we run
// it as a child process against a random port with an isolated SCRIBE_DATA_DIR.
// Each test spins the server up once and tears it down in test.after().

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

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'scribe-status-'));
let port;
let child;

test.before(async () => {
  port = await freePort();
  child = spawn(process.execPath, [SERVER_PATH], {
    env: {
      ...process.env,
      PORT: String(port),
      NODE_ENV: 'development',       // skip the prod AUTH_PASSWORD/SESSION_SECRET hard-fail
      SCRIBE_DATA_DIR: tmp,          // isolate SQLite to a throwaway dir
      API_KEY: 'test-api-key',
      SUITE_API_KEY: 'test-suite-key',
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

test('GET /api/status without Bearer → 401', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/status`);
  assert.equal(r.status, 401);
});

test('GET /api/status with bad Bearer → 401', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/status`, {
    headers: { Authorization: 'Bearer nope' },
  });
  assert.equal(r.status, 401);
});

test('GET /api/status with API_KEY Bearer → 200 with expected shape', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/status`, {
    headers: { Authorization: 'Bearer test-api-key' },
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.app, 'scribe');
  assert.equal(body.ok, true);
  assert.equal(typeof body.version, 'string');
  assert.ok(body.version.length > 0, 'version is non-empty');
  assert.equal(typeof body.uptime_seconds, 'number');
  assert.ok(body.uptime_seconds >= 0);
  assert.ok(body.metrics && typeof body.metrics === 'object', 'metrics present');
  assert.equal(typeof body.metrics.total_documents, 'number');
  assert.equal(typeof body.metrics.gloss_linked_collections, 'number');
  // active_collaborators may be null (nothing active yet) or a number — both are valid.
  const ac = body.metrics.active_collaborators;
  assert.ok(ac === null || typeof ac === 'number', 'active_collaborators is number|null');
});

test('GET /api/status with SUITE_API_KEY Bearer → 200', async () => {
  const r = await fetch(`http://127.0.0.1:${port}/api/status`, {
    headers: { Authorization: 'Bearer test-suite-key' },
  });
  assert.equal(r.status, 200);
  const body = await r.json();
  assert.equal(body.app, 'scribe');
});
