-- Readwise integration: local mirror of books + highlights and a tiny sync cursor.
-- Schema is read-only w.r.t. Readwise, we only ever pull from their API.

CREATE TABLE IF NOT EXISTS readwise_books (
  id             INTEGER PRIMARY KEY,            -- Readwise book id
  title          TEXT NOT NULL,
  author         TEXT,
  category       TEXT NOT NULL,                  -- books|articles|podcasts|tweets
  source_url     TEXT,
  cover_url      TEXT,
  num_highlights INTEGER DEFAULT 0,
  synced_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS readwise_highlights (
  id             INTEGER PRIMARY KEY,            -- Readwise highlight id
  book_id        INTEGER NOT NULL REFERENCES readwise_books(id),
  text           TEXT NOT NULL,
  note           TEXT,
  location       TEXT,
  url            TEXT,
  highlighted_at TEXT,
  updated        TEXT NOT NULL,
  synced_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rw_highlights_book    ON readwise_highlights(book_id);
CREATE INDEX IF NOT EXISTS idx_rw_highlights_updated ON readwise_highlights(updated DESC);

-- Generic key/value cursor table. Currently holds `readwise_last_sync` = ISO8601.
CREATE TABLE IF NOT EXISTS sync_state (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
