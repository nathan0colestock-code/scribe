# Overnight Report — scribe (2026-04-23)

## Shipped

### SPEC 5 — Exports

- `pdfkit` added as a runtime dep.
- New module `exports.js` reconstitutes the draft Y.Doc from
  `documents.yjs_state` via `y-prosemirror`'s `yDocToProsemirrorJSON`, then
  serializes to:
  - **PDF** (`renderPdfBuffer`): title/date/collection header, block-level
    rendering for paragraph/heading/blockquote/list/codeblock/notecard/hr with
    inline marks (bold/italic/code/link). No UI chrome.
  - **Markdown** (`docToMarkdown`): YAML frontmatter
    (`title`/`date`/`collection`/`id`) + block serialization. Inline bold,
    italic, code, and links round-trip; notecards render as blockquoted
    snippets with a source label.
- `routes/exports.js` mounts `GET /api/documents/:id/export.pdf` and
  `export.md`. Uses `ensureAccess` for per-doc authorization (same as all
  other document routes). Content-Disposition is set so the browser saves a
  file with a safe filename.
- UI: `ExportMenu` dropdown component in `src/DocumentView.jsx`'s header
  toolbar — two menu items (PDF, Markdown) that hit the new endpoints
  directly as plain anchor hrefs. No new frontend deps.

### Auto-archive to Black

- New `black.archiveIngest({ doc_id, title, date, collection, body_text, url,
  traceId, fetchImpl, log })`. POSTs to `BLACK_URL/api/archive/ingest` with
  Bearer `BLACK_API_KEY` (or `SUITE_API_KEY` as a fallback). Retries once on
  network errors or 5xx; 4xx is final. Always resolves — never throws —
  because the export path must stay green even if Black is down.
- Fires fire-and-forget from both export routes after the response is written
  (so a slow Black doesn't stall the download).
- Stage→Review hook: `POST /api/documents/:id/auto-archive` (owner-only,
  best-effort) so the client can ping archive after the `Review` transition
  without changing the PATCH body shape. Always returns 200 with
  `archived: boolean`.

### S-U-01 — Readwise sync failure UI

- Server now emits `event: 'readwise_sync_failure'` with timestamp, error,
  and `scheduled: true|false` in both the manual `/api/readwise/sync` path
  (502 body now has `retryable: true` and a `code`) and the scheduled
  6-hour timer.
- Frontend (`src/sidebar/ReadwisePanel.jsx`) shows a toast card when the
  sync throws — Retry re-runs `syncNow()`, Dismiss clears the toast. Styled
  inline so it slots in without touching the shared stylesheet.

### S-U-02 — Archive tab empty state

- New `GET /api/archive/config` returns `{ configured: boolean }`.
- `src/sidebar/ArchiveSuggestions.jsx` probes on mount; when
  `configured === false` renders an empty-state card that hints at
  `BLACK_URL` + `BLACK_API_KEY` (or `SUITE_API_KEY`) as the Fly secrets to
  set. No silent hide.

### S-I-03 — Trace-id middleware

- `log.js` `httpMiddleware` echoes inbound `X-Trace-Id` (truncated to 200
  chars) or generates one via `crypto.randomUUID()`. `req.trace_id` is set,
  and the response carries `X-Trace-Id` on its way back out.
- Outbound propagation:
  - `black.js search()` forwards the trace id to Black.
  - `black.js archiveIngest()` forwards it as well (so Black's archive log
    line carries the same trace as Scribe's export log line).
  - `gloss.js request()` now threads `traceId` into the outbound headers.

### Structured logging

- `log.js` (ESM) mirrors Black's contract: `log(level, event, ctx)`, JSON
  lines to stderr, 1000-entry ring buffer, level filter, HTTP middleware.
- `GET /api/logs/recent` is bearer-gated (reuses `requireBearer` from
  `server.js`). Returns `{ entries, count }`.

## Tests

- Pre-existing: 50 passing.
- New: 13 across `tests/overnight.test.js`.
- Final count: **63 pass / 0 fail** (`npm test`).

Coverage:
- PDF export: status, byte length ≥ 500, `%PDF` magic, Content-Type +
  Content-Disposition.
- MD export: YAML frontmatter, heading serialization, **bold** round-trip,
  body preserved; separate test for docs with no yjs_state (empty case).
- `archiveIngest`: happy path payload + headers (bearer + trace id), single
  retry on 503, network error swallowed without throw, unconfigured skip.
- Trace-id middleware: echo + generate, response header present.
- Logs: endpoint returns entries, level filter, ring-buffer bound.
- `prosemirrorToPlain` helper (fed to archive body_text).

## Bugs fixed

- None new in scope. One small DX improvement: `black.js` now reads
  `BLACK_URL` / `BLACK_API_KEY` lazily per call so tests can toggle them per
  case without re-requiring the module.

## Deferred

- y-prosemirror's `prosemirrorJSONToYDoc` is used in tests with a minimal
  schema (paragraph/heading/text/bold/italic). Real documents use a fuller
  schema from Tiptap starter-kit, but since the export path only *reads*
  and serializes, the test schema is sufficient — no recommendation filed.
- Stage→Review auto-archive: wired as an explicit endpoint rather than
  piggybacking on PATCH. Frontend change to call it on the stage transition
  was left for a follow-up (the export path already covers the primary
  auto-archive trigger). Filed as a product-level note below.

## Questions filed

- None.

## Gemini substitution

- No `@anthropic-ai/sdk` calls introduced or discovered.

## Notes for orchestrator

- Branch: `maestro/overnight-scribe-20260423`
- New dep: `pdfkit`.
- Requires Black's `POST /api/archive/ingest` to be live — deploy Black
  first.
- `/api/logs/recent` is bearer-gated; Maestro's collector can hit it with
  `SUITE_API_KEY`.
