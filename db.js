import Database from 'better-sqlite3';
import { nanoid } from 'nanoid';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.SCRIBE_DATA_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'scribe.db');
export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const migrations = fs.readFileSync(path.join(__dirname, 'migrations', '001_init.sql'), 'utf8');
db.exec(migrations);
for (const mig of ['002_outline_doc.sql', '003_gloss_artifact.sql', '004_readwise.sql', '004_source_json.sql']) {
  const sql = fs.readFileSync(path.join(__dirname, 'migrations', mig), 'utf8');
  for (const stmt of sql.split(';').map(s => s.trim()).filter(Boolean)) {
    try { db.exec(stmt + ';'); } catch (e) { if (!e.message.includes('duplicate column')) throw e; }
  }
}

const now = () => new Date().toISOString();
const sha256 = (s) => crypto.createHash('sha256').update(s || '').digest('hex');

// ---- Documents ----

export function createDocument({ title = 'Untitled', owner_email, description = '', main_point = '', source = null, pending_seed = null }) {
  const id = nanoid(12);
  const t = now();
  const source_json = source ? JSON.stringify(source) : null;
  db.prepare(`
    INSERT INTO documents (id, title, owner_email, description, main_point, source_json, pending_seed, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, title, owner_email, description, main_point, source_json, pending_seed, t, t);
  return getDocument(id);
}

// Consume the pending seed text for a server-side create-and-redirect flow
// (e.g. Black's "Open in Scribe"). The seed is read-once: the first caller
// gets the text, subsequent callers get null. Returning null means "no seed
// waiting" — callers can quietly skip the draft-insertion step.
export function consumePendingSeed(id) {
  const row = db.prepare(`SELECT pending_seed FROM documents WHERE id = ?`).get(id);
  if (!row?.pending_seed) return null;
  const seed = row.pending_seed;
  db.prepare(`UPDATE documents SET pending_seed = NULL WHERE id = ?`).run(id);
  return seed;
}

export function getDocument(id) {
  return db.prepare(`SELECT * FROM documents WHERE id = ?`).get(id);
}

// Parse the `source_json` blob into an object. Tolerant of bad JSON so a
// corrupt row never takes down a document fetch — returns null instead.
export function getDocumentSource(id) {
  const row = db.prepare(`SELECT source_json FROM documents WHERE id = ?`).get(id);
  if (!row?.source_json) return null;
  try { return JSON.parse(row.source_json); } catch { return null; }
}

export function listDocumentsForUser(email) {
  return db.prepare(`
    SELECT d.id, d.title, d.description, d.updated_at,
           (d.owner_email = ?) AS is_owner,
           COALESCE(c.role, CASE WHEN d.owner_email = ? THEN 'editor' ELSE NULL END) AS role
    FROM documents d
    LEFT JOIN document_collaborators c ON c.document_id = d.id AND c.user_email = ?
    WHERE d.owner_email = ? OR c.user_email = ?
    ORDER BY d.updated_at DESC
  `).all(email, email, email, email, email);
}

export function updateDocumentMeta(id, { title, description, main_point, style_guide_id }) {
  const cur = getDocument(id);
  if (!cur) return null;
  db.prepare(`
    UPDATE documents SET
      title = COALESCE(?, title),
      description = COALESCE(?, description),
      main_point = COALESCE(?, main_point),
      style_guide_id = COALESCE(?, style_guide_id),
      updated_at = ?
    WHERE id = ?
  `).run(title ?? null, description ?? null, main_point ?? null, style_guide_id ?? null, now(), id);
  return getDocument(id);
}

export function deleteDocument(id) {
  db.prepare(`DELETE FROM documents WHERE id = ?`).run(id);
}

export function setDocumentGlossArtifact(id, gloss_artifact_id) {
  db.prepare(`UPDATE documents SET gloss_artifact_id = ? WHERE id = ?`).run(gloss_artifact_id, id);
}

export function setYjsState(id, buf, kind = 'draft') {
  const col = kind === 'outline' ? 'outline_yjs_state' : 'yjs_state';
  db.prepare(`UPDATE documents SET ${col} = ?, updated_at = ? WHERE id = ?`).run(buf, now(), id);
}
export function getYjsState(id, kind = 'draft') {
  const col = kind === 'outline' ? 'outline_yjs_state' : 'yjs_state';
  const row = db.prepare(`SELECT ${col} AS state FROM documents WHERE id = ?`).get(id);
  return row?.state || null;
}

// ---- Users ----

export function upsertUser({ email, display_name, color }) {
  const t = now();
  db.prepare(`
    INSERT INTO users (email, display_name, color, created_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET display_name = excluded.display_name, color = excluded.color
  `).run(email, display_name, color, t);
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
}
export function getUser(email) {
  return db.prepare(`SELECT * FROM users WHERE email = ?`).get(email);
}

// ---- Share tokens / collaborators ----

export function createShareToken({ document_id, role, created_by }) {
  const token = nanoid(24);
  db.prepare(`
    INSERT INTO share_tokens (token, document_id, role, created_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(token, document_id, role, created_by, now());
  return getShareToken(token);
}
export function getShareToken(token) {
  return db.prepare(`SELECT * FROM share_tokens WHERE token = ?`).get(token);
}
export function listShareTokens(document_id) {
  return db.prepare(`SELECT * FROM share_tokens WHERE document_id = ? ORDER BY created_at DESC`).all(document_id);
}
export function revokeShareToken(token) {
  db.prepare(`UPDATE share_tokens SET revoked_at = ? WHERE token = ?`).run(now(), token);
}

export function addCollaborator(document_id, user_email, role) {
  db.prepare(`
    INSERT INTO document_collaborators (document_id, user_email, role, last_seen_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(document_id, user_email) DO UPDATE SET role = excluded.role, last_seen_at = excluded.last_seen_at
  `).run(document_id, user_email, role, now());
}
export function getCollaboratorRole(document_id, user_email) {
  const row = db.prepare(`
    SELECT role FROM document_collaborators WHERE document_id = ? AND user_email = ?
  `).get(document_id, user_email);
  return row?.role || null;
}
export function listCollaborators(document_id) {
  return db.prepare(`
    SELECT c.*, u.display_name, u.color
    FROM document_collaborators c
    LEFT JOIN users u ON u.email = c.user_email
    WHERE c.document_id = ?
  `).all(document_id);
}

// ---- Gloss links ----

export function addGlossLink(document_id, { kind, gloss_id, label }) {
  try {
    const info = db.prepare(`
      INSERT INTO gloss_links (document_id, kind, gloss_id, label, added_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(document_id, kind, String(gloss_id), label, now());
    return db.prepare(`SELECT * FROM gloss_links WHERE id = ?`).get(info.lastInsertRowid);
  } catch (err) {
    if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') {
      return db.prepare(`
        SELECT * FROM gloss_links WHERE document_id = ? AND kind = ? AND gloss_id = ?
      `).get(document_id, kind, String(gloss_id));
    }
    throw err;
  }
}

export function listGlossLinks(document_id) {
  return db.prepare(`SELECT * FROM gloss_links WHERE document_id = ? ORDER BY added_at`).all(document_id);
}

export function removeGlossLink(id, document_id) {
  db.prepare(`DELETE FROM gloss_links WHERE id = ? AND document_id = ?`).run(id, document_id);
}

// ---- Transcript cache / FTS ----

export function upsertTranscript({ page_id, source_kind, captured_at, is_voice, is_markdown, transcript, summary, volume, page_number, collection_title }) {
  const hash = sha256(transcript || '');
  const existing = db.prepare(`SELECT etag_hash FROM transcript_cache WHERE page_id = ?`).get(page_id);
  if (existing && existing.etag_hash === hash) {
    db.prepare(`UPDATE transcript_cache SET fetched_at = ?, volume = COALESCE(?, volume), page_number = COALESCE(?, page_number), collection_title = COALESCE(?, collection_title) WHERE page_id = ?`)
      .run(now(), volume ?? null, page_number ?? null, collection_title ?? null, page_id);
    return { changed: false };
  }
  db.prepare(`
    INSERT INTO transcript_cache (page_id, source_kind, captured_at, is_voice, is_markdown, transcript, summary, fetched_at, etag_hash, volume, page_number, collection_title)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(page_id) DO UPDATE SET
      source_kind      = excluded.source_kind,
      captured_at      = excluded.captured_at,
      is_voice         = excluded.is_voice,
      is_markdown      = excluded.is_markdown,
      transcript       = excluded.transcript,
      summary          = excluded.summary,
      fetched_at       = excluded.fetched_at,
      etag_hash        = excluded.etag_hash,
      volume           = COALESCE(excluded.volume, volume),
      page_number      = COALESCE(excluded.page_number, page_number),
      collection_title = COALESCE(excluded.collection_title, collection_title)
  `).run(
    page_id, source_kind || null, captured_at || null,
    is_voice ? 1 : 0, is_markdown ? 1 : 0,
    transcript || '', summary || null, now(), hash,
    volume ?? null, page_number != null ? String(page_number) : null, collection_title ?? null
  );
  return { changed: true };
}

export function linkTranscriptSource(page_id, link_kind, gloss_id) {
  db.prepare(`
    INSERT OR IGNORE INTO transcript_sources (page_id, link_kind, gloss_id)
    VALUES (?, ?, ?)
  `).run(page_id, link_kind, String(gloss_id));
}

export function getTranscript(page_id) {
  return db.prepare(`SELECT * FROM transcript_cache WHERE page_id = ?`).get(page_id);
}

export function transcriptStatsForDocument(document_id) {
  return db.prepare(`
    SELECT COUNT(DISTINCT ts.page_id) AS total,
           SUM(CASE WHEN LENGTH(tc.transcript) > 0 THEN 1 ELSE 0 END) AS with_text,
           MAX(tc.fetched_at) AS last_fetched
    FROM gloss_links gl
    JOIN transcript_sources ts ON ts.link_kind = gl.kind AND ts.gloss_id = gl.gloss_id
    JOIN transcript_cache tc ON tc.page_id = ts.page_id
    WHERE gl.document_id = ?
  `).get(document_id) || { total: 0, with_text: 0, last_fetched: null };
}

export function searchTranscriptsForDocument(document_id, query, limit = 30) {
  if (!query || !query.trim()) return [];
  // Sanitize for FTS5: take alpha-num words, OR them together.
  const terms = query
    .toLowerCase()
    .match(/[a-z0-9]{3,}/g) || [];
  const stopwords = new Set(['the','and','for','that','this','with','from','have','you','your','about','into','when','what','where','which','their','would','there','been','will','just','they','them','were']);
  const keepers = [...new Set(terms.filter(t => !stopwords.has(t)))].slice(0, 12);
  if (!keepers.length) return [];
  const match = keepers.map(t => `"${t}"`).join(' OR ');
  try {
    return db.prepare(`
      SELECT f.page_id,
             snippet(transcript_fts, 0, '<mark>', '</mark>', '…', 20) AS snippet,
             bm25(transcript_fts) AS score,
             tc.source_kind,
             tc.captured_at,
             tc.transcript,
             tc.volume,
             tc.page_number,
             tc.collection_title
      FROM transcript_fts f
      JOIN transcript_cache tc ON tc.page_id = f.page_id
      WHERE f.transcript MATCH ?
        AND f.page_id IN (
          SELECT DISTINCT ts.page_id
          FROM transcript_sources ts
          JOIN gloss_links gl ON gl.kind = ts.link_kind AND gl.gloss_id = ts.gloss_id
          WHERE gl.document_id = ?
        )
      ORDER BY score
      LIMIT ?
    `).all(match, document_id, limit);
  } catch (err) {
    console.warn('[fts] query failed', err.message);
    return [];
  }
}

// ---- Outline nodes ----

export function listOutline(document_id) {
  return db.prepare(`
    SELECT * FROM outline_nodes WHERE document_id = ?
    ORDER BY COALESCE(parent_id, ''), position
  `).all(document_id);
}

export function createOutlineNode({ document_id, parent_id = null, position = 0, kind = 'bullet', text = '', card_id = null }) {
  const id = nanoid(10);
  const t = now();
  db.prepare(`
    INSERT INTO outline_nodes (id, document_id, parent_id, position, kind, text, card_id, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, document_id, parent_id, position, kind, text, card_id, t, t);
  return db.prepare(`SELECT * FROM outline_nodes WHERE id = ?`).get(id);
}

export function updateOutlineNode(id, { parent_id, position, kind, text, card_id }) {
  db.prepare(`
    UPDATE outline_nodes SET
      parent_id = COALESCE(?, parent_id),
      position = COALESCE(?, position),
      kind = COALESCE(?, kind),
      text = COALESCE(?, text),
      card_id = COALESCE(?, card_id),
      updated_at = ?
    WHERE id = ?
  `).run(parent_id ?? null, position ?? null, kind ?? null, text ?? null, card_id ?? null, now(), id);
  return db.prepare(`SELECT * FROM outline_nodes WHERE id = ?`).get(id);
}

export function deleteOutlineNode(id) {
  db.prepare(`DELETE FROM outline_nodes WHERE id = ?`).run(id);
}

// ---- Cards ----

export function upsertCard({ document_id, page_id, snippet, start_offset, end_offset, source_label }) {
  const existing = db.prepare(`
    SELECT * FROM cards WHERE document_id = ? AND page_id = ? AND start_offset = ? AND end_offset = ?
  `).get(document_id, page_id, start_offset, end_offset);
  if (existing) return existing;
  const id = nanoid(10);
  db.prepare(`
    INSERT INTO cards (id, document_id, page_id, snippet, start_offset, end_offset, source_label, state, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'candidate', ?)
  `).run(id, document_id, page_id, snippet, start_offset, end_offset, source_label || null, now());
  return db.prepare(`SELECT * FROM cards WHERE id = ?`).get(id);
}

export function getCard(id) {
  return db.prepare(`SELECT * FROM cards WHERE id = ?`).get(id);
}
export function setCardState(id, state) {
  db.prepare(`UPDATE cards SET state = ? WHERE id = ?`).run(state, id);
}

export function listCards(document_id, state) {
  if (state) return db.prepare(`SELECT * FROM cards WHERE document_id = ? AND state = ?`).all(document_id, state);
  return db.prepare(`SELECT * FROM cards WHERE document_id = ?`).all(document_id);
}

// ---- Comments ----

export function createCommentThread({ document_id, created_by_email }) {
  const id = nanoid(10);
  db.prepare(`
    INSERT INTO comment_threads (id, document_id, created_by_email, created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, document_id, created_by_email, now());
  return db.prepare(`SELECT * FROM comment_threads WHERE id = ?`).get(id);
}

export function addComment({ thread_id, author_email, body }) {
  const id = nanoid(10);
  db.prepare(`
    INSERT INTO comments (id, thread_id, author_email, body, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, thread_id, author_email, body, now());
  return db.prepare(`SELECT * FROM comments WHERE id = ?`).get(id);
}

export function listThreadsWithComments(document_id) {
  const threads = db.prepare(`SELECT * FROM comment_threads WHERE document_id = ? ORDER BY created_at`).all(document_id);
  const all = db.prepare(`
    SELECT c.*, u.display_name, u.color
    FROM comments c
    LEFT JOIN users u ON u.email = c.author_email
    WHERE c.thread_id IN (${threads.map(() => '?').join(',') || 'NULL'})
    ORDER BY c.created_at
  `).all(...threads.map(t => t.id));
  const byThread = new Map();
  for (const c of all) {
    if (!byThread.has(c.thread_id)) byThread.set(c.thread_id, []);
    byThread.get(c.thread_id).push(c);
  }
  return threads.map(t => ({ ...t, comments: byThread.get(t.id) || [] }));
}

export function resolveThread(id) {
  db.prepare(`UPDATE comment_threads SET resolved = 1, resolved_at = ? WHERE id = ?`).run(now(), id);
}

// ---- Suggestions ----

export function createSuggestion({ document_id, author_email, kind, anchor_mark_id, before, after }) {
  const id = nanoid(10);
  db.prepare(`
    INSERT INTO suggestions (id, document_id, author_email, kind, anchor_mark_id, before, after, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, document_id, author_email, kind, anchor_mark_id, before || null, after || null, now());
  return db.prepare(`SELECT * FROM suggestions WHERE id = ?`).get(id);
}

export function listSuggestions(document_id) {
  return db.prepare(`
    SELECT s.*, u.display_name, u.color
    FROM suggestions s
    LEFT JOIN users u ON u.email = s.author_email
    WHERE s.document_id = ? ORDER BY s.created_at
  `).all(document_id);
}

export function resolveSuggestion(id, state, resolved_by) {
  db.prepare(`
    UPDATE suggestions SET state = ?, resolved_at = ?, resolved_by = ? WHERE id = ?
  `).run(state, now(), resolved_by, id);
  return db.prepare(`SELECT * FROM suggestions WHERE id = ?`).get(id);
}

// ---- Style guides ----

export function listStyleGuides(owner_email) {
  return db.prepare(`SELECT * FROM style_guides WHERE owner_email = ? ORDER BY updated_at DESC`).all(owner_email);
}
export function getStyleGuide(id) {
  return db.prepare(`SELECT * FROM style_guides WHERE id = ?`).get(id);
}
export function upsertStyleGuide({ id, owner_email, title, body_md }) {
  if (id) {
    db.prepare(`
      UPDATE style_guides SET title = ?, body_md = ?, updated_at = ? WHERE id = ? AND owner_email = ?
    `).run(title, body_md, now(), id, owner_email);
    return getStyleGuide(id);
  }
  const newId = nanoid(10);
  db.prepare(`
    INSERT INTO style_guides (id, owner_email, title, body_md, updated_at) VALUES (?, ?, ?, ?, ?)
  `).run(newId, owner_email, title, body_md, now());
  return getStyleGuide(newId);
}
export function deleteStyleGuide(id, owner_email) {
  db.prepare(`DELETE FROM style_guides WHERE id = ? AND owner_email = ?`).run(id, owner_email);
}

// ---- Readwise ----
//
// Local mirror of Readwise books + highlights. Pulls happen in routes/readwise.js;
// these helpers are purely storage/query. Never write back to Readwise.

export function upsertReadwiseBook(book) {
  db.prepare(`
    INSERT INTO readwise_books (id, title, author, category, source_url, cover_url, num_highlights, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title          = excluded.title,
      author         = excluded.author,
      category       = excluded.category,
      source_url     = excluded.source_url,
      cover_url      = excluded.cover_url,
      num_highlights = excluded.num_highlights,
      synced_at      = excluded.synced_at
  `).run(
    book.id,
    book.title,
    book.author ?? null,
    book.category || 'books',
    book.source_url ?? null,
    book.cover_url ?? null,
    Number.isFinite(book.num_highlights) ? book.num_highlights : 0,
    now(),
  );
}

export function upsertReadwiseHighlight(h) {
  db.prepare(`
    INSERT INTO readwise_highlights (id, book_id, text, note, location, url, highlighted_at, updated, synced_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      book_id        = excluded.book_id,
      text           = excluded.text,
      note           = excluded.note,
      location       = excluded.location,
      url            = excluded.url,
      highlighted_at = excluded.highlighted_at,
      updated        = excluded.updated,
      synced_at      = excluded.synced_at
  `).run(
    h.id,
    h.book_id,
    h.text,
    h.note ?? null,
    h.location ?? null,
    h.url ?? null,
    h.highlighted_at ?? null,
    h.updated,
    now(),
  );
}

export function listReadwiseBooks() {
  return db.prepare(`
    SELECT b.*,
           (SELECT COUNT(*) FROM readwise_highlights h WHERE h.book_id = b.id) AS highlight_count
    FROM readwise_books b
    ORDER BY b.title COLLATE NOCASE
  `).all();
}

export function getReadwiseBook(id) {
  return db.prepare(`SELECT * FROM readwise_books WHERE id = ?`).get(id);
}

export function listReadwiseHighlightsForBook(book_id, { limit = 100, offset = 0 } = {}) {
  return db.prepare(`
    SELECT * FROM readwise_highlights
    WHERE book_id = ?
    ORDER BY COALESCE(highlighted_at, updated) DESC
    LIMIT ? OFFSET ?
  `).all(book_id, limit, offset);
}

export function listRecentReadwiseHighlights(limit = 20) {
  return db.prepare(`
    SELECT h.*, b.title AS book_title, b.author AS book_author, b.category AS book_category
    FROM readwise_highlights h
    JOIN readwise_books b ON b.id = h.book_id
    ORDER BY COALESCE(h.highlighted_at, h.updated) DESC
    LIMIT ?
  `).all(limit);
}

export function searchReadwiseHighlights(q, limit = 20) {
  if (!q || !q.trim()) return [];
  const like = `%${q.trim().replace(/[%_]/g, s => '\\' + s)}%`;
  return db.prepare(`
    SELECT h.id AS highlight_id,
           h.text, h.note, h.location, h.url, h.highlighted_at,
           b.id AS book_id, b.title AS book_title, b.author AS book_author, b.category AS book_category
    FROM readwise_highlights h
    JOIN readwise_books b ON b.id = h.book_id
    WHERE h.text LIKE ? ESCAPE '\\'
       OR h.note LIKE ? ESCAPE '\\'
       OR b.title LIKE ? ESCAPE '\\'
    ORDER BY COALESCE(h.highlighted_at, h.updated) DESC
    LIMIT ?
  `).all(like, like, like, limit);
}

export function getSyncState(key) {
  const row = db.prepare(`SELECT value FROM sync_state WHERE key = ?`).get(key);
  return row?.value || null;
}

export function setSyncState(key, value) {
  db.prepare(`
    INSERT INTO sync_state (key, value, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).run(key, value, now());
}

// ---- Snapshots ----

export function createSnapshot(document_id, snapshot, label) {
  const id = nanoid(10);
  db.prepare(`
    INSERT INTO document_snapshots (id, document_id, snapshot, label, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(id, document_id, snapshot, label || null, now());
  return id;
}
export function listSnapshots(document_id) {
  return db.prepare(`
    SELECT id, document_id, label, created_at FROM document_snapshots
    WHERE document_id = ? ORDER BY created_at DESC
  `).all(document_id);
}
export function deleteSnapshot(id) {
  db.prepare(`DELETE FROM document_snapshots WHERE id = ?`).run(id);
}
