PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS documents (
  id            TEXT PRIMARY KEY,
  title         TEXT NOT NULL DEFAULT 'Untitled',
  owner_email   TEXT NOT NULL,
  description   TEXT NOT NULL DEFAULT '',
  main_point    TEXT NOT NULL DEFAULT '',
  yjs_state     BLOB,
  style_guide_id TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_documents_owner ON documents(owner_email);

CREATE TABLE IF NOT EXISTS users (
  email         TEXT PRIMARY KEY,
  display_name  TEXT NOT NULL,
  color         TEXT NOT NULL,
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS share_tokens (
  token         TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL,
  role          TEXT NOT NULL CHECK(role IN ('viewer','commenter','suggester','editor')),
  created_by    TEXT,
  created_at    TEXT NOT NULL,
  revoked_at    TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_share_tokens_doc ON share_tokens(document_id);

CREATE TABLE IF NOT EXISTS document_collaborators (
  document_id   TEXT NOT NULL,
  user_email    TEXT NOT NULL,
  role          TEXT NOT NULL,
  last_seen_at  TEXT,
  PRIMARY KEY (document_id, user_email),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_email) REFERENCES users(email) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gloss_links (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  document_id   TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK(kind IN ('collection','topic','person','book','scripture')),
  gloss_id      TEXT NOT NULL,
  label         TEXT NOT NULL,
  added_at      TEXT NOT NULL,
  UNIQUE (document_id, kind, gloss_id),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_gloss_links_doc ON gloss_links(document_id);

CREATE TABLE IF NOT EXISTS transcript_cache (
  page_id       TEXT PRIMARY KEY,
  source_kind   TEXT,
  captured_at   TEXT,
  is_voice      INTEGER DEFAULT 0,
  is_markdown   INTEGER DEFAULT 0,
  transcript    TEXT NOT NULL DEFAULT '',
  summary       TEXT,
  fetched_at    TEXT NOT NULL,
  etag_hash     TEXT
);

-- Many-to-many: which linked sources include which pages. A page can be reached
-- from multiple collections/topics. Used to scope FTS queries per document.
CREATE TABLE IF NOT EXISTS transcript_sources (
  page_id       TEXT NOT NULL,
  link_kind     TEXT NOT NULL,
  gloss_id      TEXT NOT NULL,
  PRIMARY KEY (page_id, link_kind, gloss_id),
  FOREIGN KEY (page_id) REFERENCES transcript_cache(page_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_transcript_sources_src ON transcript_sources(link_kind, gloss_id);

CREATE VIRTUAL TABLE IF NOT EXISTS transcript_fts USING fts5(
  transcript,
  page_id UNINDEXED,
  tokenize = 'unicode61'
);

-- Manual FTS sync (safer than contentless external-content setup with WAL).
CREATE TRIGGER IF NOT EXISTS transcript_cache_ai AFTER INSERT ON transcript_cache BEGIN
  INSERT INTO transcript_fts(rowid, transcript, page_id) VALUES (new.rowid, new.transcript, new.page_id);
END;
CREATE TRIGGER IF NOT EXISTS transcript_cache_ad AFTER DELETE ON transcript_cache BEGIN
  DELETE FROM transcript_fts WHERE rowid = old.rowid;
END;
CREATE TRIGGER IF NOT EXISTS transcript_cache_au AFTER UPDATE ON transcript_cache BEGIN
  DELETE FROM transcript_fts WHERE rowid = old.rowid;
  INSERT INTO transcript_fts(rowid, transcript, page_id) VALUES (new.rowid, new.transcript, new.page_id);
END;

CREATE TABLE IF NOT EXISTS outline_nodes (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL,
  parent_id     TEXT,
  position      INTEGER NOT NULL DEFAULT 0,
  kind          TEXT NOT NULL CHECK(kind IN ('heading','bullet','card_ref')),
  text          TEXT NOT NULL DEFAULT '',
  card_id       TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_outline_nodes_doc ON outline_nodes(document_id, parent_id, position);

CREATE TABLE IF NOT EXISTS cards (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL,
  page_id       TEXT NOT NULL,
  snippet       TEXT NOT NULL,
  start_offset  INTEGER NOT NULL DEFAULT 0,
  end_offset    INTEGER NOT NULL DEFAULT 0,
  source_label  TEXT,
  state         TEXT NOT NULL DEFAULT 'candidate' CHECK(state IN ('candidate','in_outline','materialized')),
  created_at    TEXT NOT NULL,
  UNIQUE (document_id, page_id, start_offset, end_offset),
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_cards_doc ON cards(document_id, state);

CREATE TABLE IF NOT EXISTS comment_threads (
  id                TEXT PRIMARY KEY,
  document_id       TEXT NOT NULL,
  resolved          INTEGER NOT NULL DEFAULT 0,
  created_by_email  TEXT NOT NULL,
  created_at        TEXT NOT NULL,
  resolved_at       TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_threads_doc ON comment_threads(document_id, resolved);

CREATE TABLE IF NOT EXISTS comments (
  id            TEXT PRIMARY KEY,
  thread_id     TEXT NOT NULL,
  author_email  TEXT NOT NULL,
  body          TEXT NOT NULL,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (thread_id) REFERENCES comment_threads(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_comments_thread ON comments(thread_id, created_at);

CREATE TABLE IF NOT EXISTS suggestions (
  id              TEXT PRIMARY KEY,
  document_id     TEXT NOT NULL,
  author_email    TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK(kind IN ('insert','delete','replace')),
  anchor_mark_id  TEXT NOT NULL,
  before          TEXT,
  after           TEXT,
  state           TEXT NOT NULL DEFAULT 'open' CHECK(state IN ('open','accepted','rejected')),
  created_at      TEXT NOT NULL,
  resolved_at     TEXT,
  resolved_by     TEXT,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_suggestions_doc ON suggestions(document_id, state);

CREATE TABLE IF NOT EXISTS style_guides (
  id            TEXT PRIMARY KEY,
  owner_email   TEXT NOT NULL,
  title         TEXT NOT NULL,
  body_md       TEXT NOT NULL DEFAULT '',
  updated_at    TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_style_guides_owner ON style_guides(owner_email);

CREATE TABLE IF NOT EXISTS document_snapshots (
  id            TEXT PRIMARY KEY,
  document_id   TEXT NOT NULL,
  snapshot      BLOB NOT NULL,
  label         TEXT,
  created_at    TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_snapshots_doc ON document_snapshots(document_id, created_at);
