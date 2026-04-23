// Black HTTP client — companion to gloss.js and comms.js, talks to black-hole
// (the archive search service).
//
// Dev: http://localhost:3749. Prod: https://black-hole.fly.dev.
// Auth: Bearer `BLACK_API_KEY` (black accepts SUITE_API_KEY as a fallback,
// but we use a dedicated key so outbound interactive reads can be rotated
// independently of suite-wide polling).
//
// All methods are deliberately graceful: 4xx / 5xx / network errors resolve
// to `{ results: [] }` rather than throwing. The reference panel calls
// this on every document open — a black outage must not break editing.

const BLACK_URL     = (process.env.BLACK_URL || 'http://localhost:3749').replace(/\/$/, '');
const BLACK_API_KEY = process.env.BLACK_API_KEY || process.env.SUITE_API_KEY || '';

function buildHeaders() {
  const h = { Accept: 'application/json' };
  if (BLACK_API_KEY) h['Authorization'] = `Bearer ${BLACK_API_KEY}`;
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
export async function search({ q, k = 20 } = {}) {
  const query = (q || '').trim();
  if (!query) return { results: [] };
  if (!BLACK_API_KEY) return { results: [] };
  const url = `${BLACK_URL}/api/search?q=${encodeURIComponent(query)}&k=${encodeURIComponent(k)}`;
  try {
    const res = await fetch(url, { headers: buildHeaders(), redirect: 'manual' });
    if (!res.ok) return { results: [] };
    const data = await res.json().catch(() => null);
    if (!data || !Array.isArray(data.results)) return { results: [] };
    return { results: data.results };
  } catch {
    return { results: [] };
  }
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

export { BLACK_URL };
