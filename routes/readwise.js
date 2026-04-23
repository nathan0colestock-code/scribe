// Readwise sync + read routes.
//
// Auth: requires the main /api/* auth middleware (cookie or Bearer) — mounted
// under /api/readwise in server.js. No per-document access checks; the local
// Readwise mirror is owner-scoped at the app level.
//
// Env:
//   READWISE_TOKEN — required for /sync. If missing, /sync returns 503.
//
// Routes:
//   POST /api/readwise/sync                   — pull incremental updates
//   GET  /api/readwise/books                  — list books with highlight counts
//   GET  /api/readwise/books/:id/highlights   — paginated highlights per book
//   GET  /api/readwise/search?q=...&limit=N   — LIKE search across text/note/title
//   GET  /api/readwise/recent?limit=N         — recent highlights (default 20)
//   GET  /api/readwise/state                  — { last_sync, token_present }

import express from 'express';
import * as db from '../db.js';
import * as readwise from '../readwise.js';

export const router = express.Router();

const SYNC_KEY = 'readwise_last_sync';

export async function runSync({ token, since, clients = readwise } = {}) {
  const started = Date.now();
  const books = await clients.listBooks({ token });
  const highlights = await clients.listHighlights({ token, since });

  let books_upserted = 0;
  let highlights_upserted = 0;
  const knownBookIds = new Set(db.listReadwiseBooks().map(b => b.id));

  for (const b of books) {
    db.upsertReadwiseBook(b);
    knownBookIds.add(b.id);
    books_upserted += 1;
  }

  for (const h of highlights) {
    // Highlights can arrive before /books/ catches up on a brand-new source.
    // If the book is missing, synthesize a minimal placeholder so the FK holds
    // and the next /books/ pull fills in the real metadata.
    if (!knownBookIds.has(h.book_id)) {
      db.upsertReadwiseBook({
        id: h.book_id,
        title: 'Unknown source',
        author: null,
        category: 'books',
        source_url: null,
        cover_url: null,
        num_highlights: 0,
      });
      knownBookIds.add(h.book_id);
    }
    db.upsertReadwiseHighlight(h);
    highlights_upserted += 1;
  }

  // Advance the cursor to "now" so the next run only pulls deltas.
  db.setSyncState(SYNC_KEY, new Date().toISOString());

  return {
    books_upserted,
    highlights_upserted,
    elapsed_ms: Date.now() - started,
  };
}

router.post('/sync', async (_req, res) => {
  const token = process.env.READWISE_TOKEN;
  if (!token) {
    return res.status(503).json({
      error: 'READWISE_TOKEN not set — configure Fly secret to enable Readwise sync',
    });
  }
  const since = db.getSyncState(SYNC_KEY) || null;
  try {
    const result = await runSync({ token, since });
    res.json(result);
  } catch (err) {
    console.warn('[readwise] sync failed:', err.message);
    res.status(502).json({ error: err.message });
  }
});

router.get('/state', (_req, res) => {
  res.json({
    last_sync: db.getSyncState(SYNC_KEY),
    token_present: !!process.env.READWISE_TOKEN,
  });
});

router.get('/books', (_req, res) => {
  const books = db.listReadwiseBooks();
  res.json({ books });
});

router.get('/books/:id/highlights', (req, res) => {
  const bookId = Number(req.params.id);
  if (!Number.isFinite(bookId)) return res.status(400).json({ error: 'bad id' });
  const book = db.getReadwiseBook(bookId);
  if (!book) return res.status(404).json({ error: 'book not found' });
  const limit = Math.min(Number(req.query.limit) || 100, 500);
  const offset = Math.max(Number(req.query.offset) || 0, 0);
  const highlights = db.listReadwiseHighlightsForBook(bookId, { limit, offset });
  res.json({ book, highlights });
});

router.get('/search', (req, res) => {
  const q = (req.query.q || '').toString();
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rows = db.searchReadwiseHighlights(q, limit);
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
  res.json({ results });
});

router.get('/recent', (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const rows = db.listRecentReadwiseHighlights(limit);
  const results = rows.map(r => ({
    highlight_id: r.id,
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
  res.json({ results });
});
