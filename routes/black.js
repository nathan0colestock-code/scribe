// GET /api/documents/:id/black-suggestions
//
// Surfaces black-hole archive hits relevant to the document's topic. Extracts
// a topic/people signal from (description + main_point + title), calls
// black.search, returns the raw results array so the client can render
// titles, paths, snippets, and relevance.
//
// Access: any collaborator (viewer+) can read. Black is called server-side so
// BLACK_API_KEY stays out of the browser.
//
// Per-document in-memory cache (5 minute TTL) so rapid re-opens and debounced
// re-fetches don't hammer black. The cache key is (document_id, k) — the
// topic signal is derived from the doc row fetched inside the handler, so
// if the doc's description/main_point/title change, the caller can bust the
// cache by passing ?fresh=1 (or waiting 5 minutes).

import express from 'express';
import * as db from '../db.js';
import { search, buildSearchQuery } from '../black.js';
import { ensureAccess as ensureAccessImpl } from './_access.js';

export const router = express.Router();

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map(); // key = `${document_id}:${k}` → { at, payload }

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.payload;
}
function cacheSet(key, payload) { cache.set(key, { at: Date.now(), payload }); }

router.get('/:id/black-suggestions', async (req, res) => {
  const access = ensureAccessImpl(req, res, { docId: req.params.id });
  if (!access) return;
  const { doc } = access;

  const k = Math.max(1, Math.min(parseInt(req.query.k, 10) || 20, 50));
  const fresh = req.query.fresh === '1' || req.query.fresh === 'true';
  const cacheKey = `${doc.id}:${k}`;
  if (!fresh) {
    const cached = cacheGet(cacheKey);
    if (cached) return res.json(cached);
  }

  const q = buildSearchQuery(doc);
  if (!q) {
    const payload = { results: [], query: '' };
    cacheSet(cacheKey, payload);
    return res.json(payload);
  }

  // S-I-03: forward the inbound trace id so Black's logs can be stitched
  // together with Scribe's for a single request.
  const r = await search({ q, k, traceId: req.trace_id });
  const payload = { results: r.results || [], query: q };
  cacheSet(cacheKey, payload);
  res.json(payload);
});

// Exposed for tests that want to clear state between cases.
export function _clearCache() { cache.clear(); }
