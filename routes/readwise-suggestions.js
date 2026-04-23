// GET /api/documents/:id/readwise-suggestions
//
// Returns Readwise highlights relevant to the document's topic, using the same
// topic-signal approach as /black-suggestions. Keywords are extracted from
// `description + main_point + title` via buildSearchQuery, then matched against
// highlight text, notes, and book titles in the local Readwise mirror.
//
// Access: any collaborator (viewer+), same as black-suggestions.
// Cache: 5-minute per (document_id, k), bust with ?fresh=1.

import express from 'express';
import * as db from '../db.js';
import { buildSearchQuery } from '../black.js';
import { ensureAccess as ensureAccessImpl } from './_access.js';

export const router = express.Router();

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

function cacheGet(key) {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > CACHE_TTL_MS) { cache.delete(key); return null; }
  return entry.payload;
}
function cacheSet(key, payload) { cache.set(key, { at: Date.now(), payload }); }

router.get('/:id/readwise-suggestions', (req, res) => {
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

  const rows = db.searchReadwiseHighlightsByTopics(q, k);
  const results = rows.map(r => ({
    highlight_id: r.highlight_id,
    text: r.text,
    note: r.note,
    location: r.location,
    url: r.url,
    highlighted_at: r.highlighted_at,
    book: {
      id: r.book_id,
      title: r.book_title,
      author: r.book_author,
      category: r.book_category,
    },
  }));

  const payload = { results, query: q };
  cacheSet(cacheKey, payload);
  res.json(payload);
});

export function _clearCache() { cache.clear(); }
