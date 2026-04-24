// Black HTTP client — companion to gloss.js and comms.js, talks to black-hole
// (the archive search service).
//
// Dev: http://localhost:3749. Prod: https://your-black-app.fly.dev.
// Auth: Bearer `BLACK_API_KEY` (black accepts SUITE_API_KEY as a fallback,
// but we use a dedicated key so outbound interactive reads can be rotated
// independently of suite-wide polling).
//
// All methods are deliberately graceful: 4xx / 5xx / network errors resolve
// to `{ results: [] }` rather than throwing. The reference panel calls
// this on every document open — a black outage must not break editing.

// BLACK_URL is read lazily so tests can toggle it per-case. In prod Fly
// resolves it once at boot and it never changes.
function blackUrl() {
  return (process.env.BLACK_URL || 'http://localhost:3749').replace(/\/$/, '');
}
function blackApiKey() {
  return process.env.BLACK_API_KEY || process.env.SUITE_API_KEY || '';
}

// S-U-02: the Archive tab needs to know at render time whether BLACK_URL is
// even configured. Without this, users saw an empty list and couldn't tell
// if it was "no matches" or "misconfigured Fly secret".
export function isConfigured() {
  return !!process.env.BLACK_URL;
}

function buildHeaders(extra = {}) {
  const h = { Accept: 'application/json', ...extra };
  const key = blackApiKey();
  if (key) h['Authorization'] = `Bearer ${key}`;
  return h;
}

// Semantic search via black's /api/search endpoint.
//
//   q  - free-text topic/people signal (e.g. doc description + main_point)
//   k  - top-K hits to request (default 20)
//
// Returns { results: [] } on any error. On success, returns black's raw
// response: { results: [{ file_id, name, drive_path, web_view_link,
// content, distance, ... }] }.
export async function search({ q, k = 20, traceId } = {}) {
  const query = (q || '').trim();
  if (!query) return { results: [] };
  if (!blackApiKey()) return { results: [] };
  const headers = buildHeaders(traceId ? { 'X-Trace-Id': traceId } : {});
  const url = `${blackUrl()}/api/search?q=${encodeURIComponent(query)}&k=${encodeURIComponent(k)}`;
  try {
    const res = await fetch(url, { headers, redirect: 'manual' });
    if (!res.ok) return { results: [] };
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.results)) return { results: [] };
    return { results: data.results };
  } catch {
    return { results: [] };
  }
}

// Auto-archive a finished scribe doc into black's archive. Called on:
//   1) any successful /export.pdf or /export.md
//   2) a stage transition into 'review'
//
// Failures are logged and swallowed (not fatal to the caller). One retry on
// network/5xx so a flaky deploy doesn't lose an archive. Caller passes a
// trace_id so the cross-app log trail can be stitched together.
//
// Payload shape matches Black's POST /api/archive/ingest contract:
//   { kind, doc_id, title, date, collection, body_text, url }
export async function archiveIngest({
  doc_id, title, date, collection, body_text, url, traceId,
  fetchImpl = globalThis.fetch,
  log = () => {},
} = {}) {
  if (!process.env.BLACK_URL) {
    log('debug', 'archive_skip_no_url', { doc_id });
    return { ok: false, skipped: true, reason: 'BLACK_URL unset' };
  }
  if (!blackApiKey()) {
    log('debug', 'archive_skip_no_key', { doc_id });
    return { ok: false, skipped: true, reason: 'no bearer key configured' };
  }

  const endpoint = `${blackUrl()}/api/archive/ingest`;
  const payload = {
    kind: 'scribe',
    doc_id: String(doc_id),
    title: title || 'Untitled',
    date: date || new Date().toISOString(),
    collection: collection || null,
    body_text: body_text || '',
    url: url || null,
  };
  const headers = buildHeaders({
    'Content-Type': 'application/json',
    ...(traceId ? { 'X-Trace-Id': traceId } : {}),
  });
  const body = JSON.stringify(payload);

  async function attempt() {
    try {
      const res = await fetchImpl(endpoint, { method: 'POST', headers, body });
      return { ok: res.ok, status: res.status };
    } catch (err) {
      return { ok: false, status: 0, error: err.message };
    }
  }

  // Retry once on network/5xx; 4xx is a contract error — don't burn cycles.
  let r = await attempt();
  if (!r.ok && (r.status === 0 || r.status >= 500)) {
    r = await attempt();
  }
  if (!r.ok) {
    log('warn', 'archive_ingest_failed', {
      trace_id: traceId, doc_id, status: r.status, error: r.error || null,
    });
    return { ok: false, status: r.status, error: r.error || null };
  }
  log('info', 'archive_ingest_ok', { trace_id: traceId, doc_id });
  return { ok: true, status: r.status };
}

// Derive a topic/people signal from a scribe document. Mirrors gloss.js's
// buildSearchQuery but keeps the same ordering (description first so it
// dominates the embedding) for consistency with the existing flow.
export function buildSearchQuery(doc) {
  return [doc?.description || '', doc?.main_point || '', doc?.title || '']
    .map(s => String(s || '').trim())
    .filter(Boolean)
    .join(' ');
}

// Backwards-compat: some call sites read this at module load. Returns a
// snapshot; callers that need live refresh should hit blackUrl() via
// isConfigured() instead.
export const BLACK_URL = blackUrl();
