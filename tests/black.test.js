// Unit tests for the outbound black.js client. We stub global fetch so the
// tests assert the exact URL + headers the client sends, and the graceful-
// degradation contract (4xx/5xx/network → { results: [] }).

import test from 'node:test';
import assert from 'node:assert/strict';

let originalFetch;
let calls;

function installMockFetch(resp) {
  calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    if (resp instanceof Error) throw resp;
    return {
      ok:     resp.ok ?? true,
      status: resp.status ?? 200,
      text:   async () => resp.text ?? '',
      json:   async () => resp.json ?? {},
    };
  };
}

test.beforeEach(() => {
  originalFetch = globalThis.fetch;
  process.env.BLACK_URL = 'https://black-test.example.com';
  process.env.BLACK_API_KEY = 'black-test-key-xyz';
});

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  delete process.env.BLACK_URL;
  delete process.env.BLACK_API_KEY;
});

// We dynamically import inside tests so env vars set in beforeEach are
// observed by the module. black.js reads env at import time for BLACK_URL,
// so we bust the module cache via a query-string cachebuster.
async function freshImport() {
  const stamp = `?t=${Date.now()}-${Math.random()}`;
  return await import(`../black.js${stamp}`);
}

test('GETs /api/search with Bearer auth, query, and k', async () => {
  installMockFetch({
    ok: true,
    json: { results: [{ file_id: 'f1', name: 'Notes.md', distance: 0.1 }] },
  });
  const { search } = await freshImport();
  const r = await search({ q: 'nehemiah wall', k: 7 });
  assert.equal(calls.length, 1);
  const call = calls[0];
  assert.equal(call.url, 'https://black-test.example.com/api/search?q=nehemiah%20wall&k=7');
  assert.equal(call.init.headers['Authorization'], 'Bearer black-test-key-xyz');
  assert.equal(r.results.length, 1);
  assert.equal(r.results[0].file_id, 'f1');
});

test('defaults k to 20', async () => {
  installMockFetch({ ok: true, json: { results: [] } });
  const { search } = await freshImport();
  await search({ q: 'x' });
  assert.match(calls[0].url, /k=20$/);
});

test('empty query short-circuits without calling fetch', async () => {
  installMockFetch({ ok: true, json: { results: [{ file_id: 'no' }] } });
  const { search } = await freshImport();
  const r = await search({ q: '   ' });
  assert.equal(calls.length, 0);
  assert.deepEqual(r, { results: [] });
});

test('4xx response resolves to { results: [] } (graceful)', async () => {
  installMockFetch({ ok: false, status: 401 });
  const { search } = await freshImport();
  const r = await search({ q: 'anything' });
  assert.deepEqual(r, { results: [] });
});

test('5xx response resolves to { results: [] } (graceful)', async () => {
  installMockFetch({ ok: false, status: 503 });
  const { search } = await freshImport();
  const r = await search({ q: 'anything' });
  assert.deepEqual(r, { results: [] });
});

test('network error resolves to { results: [] } (graceful)', async () => {
  installMockFetch(new Error('socket hang up'));
  const { search } = await freshImport();
  const r = await search({ q: 'anything' });
  assert.deepEqual(r, { results: [] });
});

test('response with missing results array resolves to { results: [] }', async () => {
  installMockFetch({ ok: true, json: { not_results: 'weird' } });
  const { search } = await freshImport();
  const r = await search({ q: 'anything' });
  assert.deepEqual(r, { results: [] });
});

test('buildSearchQuery joins description + main_point + title', async () => {
  const { buildSearchQuery } = await freshImport();
  const q = buildSearchQuery({
    description: 'A piece about Nehemiah',
    main_point: 'Perseverance wins',
    title: 'The Wall',
  });
  assert.equal(q, 'A piece about Nehemiah Perseverance wins The Wall');
});

test('buildSearchQuery tolerates missing fields', async () => {
  const { buildSearchQuery } = await freshImport();
  assert.equal(buildSearchQuery({ title: '  Only title ' }), 'Only title');
  assert.equal(buildSearchQuery({}), '');
  assert.equal(buildSearchQuery(null), '');
});
