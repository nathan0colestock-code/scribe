// Readwise HTTP client.
//
// Official API: https://readwise.io/api_deets
// Auth: `Authorization: Token <READWISE_TOKEN>` (Readwise does NOT use the
// "Bearer" scheme — it's a literal "Token" prefix).
//
// This module is READ-ONLY. It never POSTs or PATCHes back to Readwise.
//
// Exports:
//   listBooks({ token, fetchImpl?, pageSize? })
//     — paginated GET /api/v2/books/. Returns the full array.
//   listHighlights({ token, since?, fetchImpl?, pageSize? })
//     — paginated GET /api/v2/highlights/. `since` is an ISO8601 string;
//       translates to `updated__gt=<since>` for incremental sync.
//   normalizeBook(raw), normalizeHighlight(raw)
//     — shape-normalizers exposed so routes/tests can call them on fixtures.

const BASE = 'https://readwise.io/api/v2';

export function normalizeBook(raw) {
  if (!raw || raw.id == null) return null;
  const category = raw.category || 'books';
  return {
    id: Number(raw.id),
    title: String(raw.title || '').trim() || 'Untitled',
    author: raw.author ? String(raw.author) : null,
    category,
    source_url: raw.source_url || null,
    cover_url: raw.cover_image_url || raw.cover_url || null,
    num_highlights: Number.isFinite(raw.num_highlights) ? raw.num_highlights : 0,
  };
}

export function normalizeHighlight(raw) {
  if (!raw || raw.id == null || raw.book_id == null) return null;
  // Readwise exposes `location` as an integer or null and `location_type` as
  // "order"|"page"|"offset"|"none". We flatten both into a string for display.
  let location = null;
  if (raw.location != null) {
    location = raw.location_type && raw.location_type !== 'none'
      ? `${raw.location_type} ${raw.location}`
      : String(raw.location);
  }
  return {
    id: Number(raw.id),
    book_id: Number(raw.book_id),
    text: String(raw.text || ''),
    note: raw.note ? String(raw.note) : null,
    location,
    url: raw.url || null,
    highlighted_at: raw.highlighted_at || null,
    // `updated` is required — Readwise always populates it. Fall back to
    // highlighted_at then a current timestamp so the cursor never goes null.
    updated: raw.updated || raw.highlighted_at || new Date().toISOString(),
  };
}

// Sleep for ms. Extracted so tests can stub it if needed.
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// Shared paginator. Readwise paginates via `?page_size=` + `?page=` and returns
// `{ count, next, previous, results }`. On 429, we sleep and retry.
async function paginate(url, { token, params = {}, fetchImpl = globalThis.fetch, pageSize = 1000 } = {}) {
  const out = [];
  let page = 1;
  while (true) {
    const q = new URLSearchParams({ ...params, page: String(page), page_size: String(pageSize) });
    const res = await fetchImpl(`${url}?${q}`, {
      headers: { Authorization: `Token ${token}` },
    });
    if (res.status === 429) {
      const retryAfter = Number(res.headers.get('Retry-After') || 2);
      await sleep((retryAfter + 1) * 1000);
      continue; // same page
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[readwise] ${url} → ${res.status} ${body.slice(0, 200)}`);
    }
    const json = await res.json();
    const results = Array.isArray(json.results) ? json.results : [];
    for (const r of results) out.push(r);
    if (!json.next) break;
    page += 1;
  }
  return out;
}

export async function listBooks({ token, fetchImpl, pageSize } = {}) {
  if (!token) throw new Error('READWISE_TOKEN required');
  const raw = await paginate(`${BASE}/books/`, { token, fetchImpl, pageSize });
  return raw.map(normalizeBook).filter(Boolean);
}

export async function listHighlights({ token, since, fetchImpl, pageSize } = {}) {
  if (!token) throw new Error('READWISE_TOKEN required');
  const params = {};
  if (since) params['updated__gt'] = since;
  const raw = await paginate(`${BASE}/highlights/`, { token, params, fetchImpl, pageSize });
  return raw.map(normalizeHighlight).filter(Boolean);
}
