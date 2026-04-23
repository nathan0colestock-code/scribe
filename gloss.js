// Gloss HTTP client + transcript hydrator.
//
// Gloss is a sibling app. Dev: http://localhost:3747. Prod: https://gloss-nc.fly.dev.
// Auth: prod Gloss enforces a `foxed_auth` signed cookie from POST /api/login.
// We lazily log in with GLOSS_PASSWORD, cache the returned Set-Cookie, and attach
// it on every outgoing call. On 401, we clear the cache and re-login once.
// (Bearer-token support exists in Gloss's local source but isn't deployed yet.)
//
// HARD INVARIANT: the body shown to the user as "their own notebook prose" must come
// from /api/pages/:id/transcript (raw_ocr_text). Pointer-summaries are NEVER surfaced
// as a user's own words. This module writes only transcript.transcript to transcript_cache.transcript.

import * as db from './db.js';

const GLOSS_URL = (process.env.GLOSS_URL || 'http://localhost:3747').replace(/\/$/, '');
const GLOSS_PASSWORD = process.env.GLOSS_PASSWORD || '';
const GLOSS_API_KEY = process.env.GLOSS_API_KEY || '';

let cachedCookie = null;
let loginInFlight = null;

async function login() {
  if (!GLOSS_PASSWORD) throw new Error('GLOSS_PASSWORD not set — cannot authenticate against Gloss');
  const res = await fetch(`${GLOSS_URL}/api/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify({ password: GLOSS_PASSWORD }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`[gloss] login failed: ${res.status} ${body.slice(0, 200)}`);
  }
  const setCookie = res.headers.get('set-cookie') || '';
  const m = setCookie.match(/foxed_auth=([^;]+)/);
  if (!m) throw new Error('[gloss] login returned no foxed_auth cookie');
  cachedCookie = `foxed_auth=${m[1]}`;
  return cachedCookie;
}

async function ensureCookie() {
  if (cachedCookie) return cachedCookie;
  if (!loginInFlight) loginInFlight = login().finally(() => { loginInFlight = null; });
  return loginInFlight;
}

async function request(path, { method = 'GET', body, retried = false } = {}) {
  const headers = { Accept: 'application/json' };
  if (body) headers['Content-Type'] = 'application/json';
  if (GLOSS_API_KEY) headers['Authorization'] = `Bearer ${GLOSS_API_KEY}`;
  if (GLOSS_PASSWORD) {
    try { headers['Cookie'] = await ensureCookie(); }
    catch (err) {
      // If bearer is present, let the request go through — cookie is the fallback.
      if (!GLOSS_API_KEY) throw err;
    }
  }
  const res = await fetch(`${GLOSS_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
    redirect: 'manual',
  });
  if ((res.status === 401 || res.status === 302) && !retried && GLOSS_PASSWORD) {
    cachedCookie = null;
    return request(path, { method, body, retried: true });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`[gloss] ${method} ${path} → ${res.status} ${text.slice(0, 200)}`);
  }
  return res.json();
}

// ---- Picker endpoints (labels only — safe to forward to UI) ----

export async function listCollections() { return request('/api/collections'); }
export async function listTopics() { return request('/api/indexes/topics'); }
export async function listPeople() { return request('/api/indexes/people'); }
export async function listBooks() { return request('/api/indexes/books'); }
export async function listScripture() { return request('/api/indexes/scripture'); }
export async function indexTree() { return request('/api/index/tree?archived=active'); }

// ---- Page resolution for a linked source ----

async function pageIdsForLink({ kind, gloss_id, label }) {
  if (kind === 'collection') {
    const detail = await request(`/api/collections/${encodeURIComponent(gloss_id)}`);
    const pages = detail?.pages || detail?.detail?.pages || [];
    const collectionTitle = detail?.collection?.title || detail?.detail?.collection?.title || label;
    return pages.map(p => ({ id: String(p.id), volume: p.volume || null, page_number: p.page_number != null ? String(p.page_number) : null, collection_title: collectionTitle })).filter(p => p.id);
  }
  // Topic / person / book / scripture: fall back to /api/search by label.
  const res = await request(`/api/search?q=${encodeURIComponent(label)}`);
  const ids = new Set();
  for (const group of Object.values(res || {})) {
    if (Array.isArray(group)) {
      for (const hit of group) {
        if (hit.page_id) ids.add(String(hit.page_id));
        if (hit.id && hit.kind === 'page') ids.add(String(hit.id));
      }
    }
  }
  return [...ids].map(id => ({ id, volume: null, page_number: null, collection_title: label }));
}

export async function fetchTranscript(page_id) {
  return request(`/api/pages/${encodeURIComponent(page_id)}/transcript`);
}

export async function fetchPageMeta(page_id) {
  // Used by the callout node to display volume/page/reference metadata.
  // Gloss's /api/pages/:id returns the page row with collection + reference context.
  return request(`/api/pages/${encodeURIComponent(page_id)}`);
}

// ---- Hydration: for a gloss_links row, pull pages + transcripts into local cache ----

export async function hydrateLink({ document_id, kind, gloss_id, label }) {
  let pageIds = [];
  try {
    pageIds = await pageIdsForLink({ kind, gloss_id, label });
  } catch (err) {
    console.warn('[gloss] page resolution failed:', err.message);
    return { pages: 0, with_text: 0, error: err.message };
  }

  let withText = 0;
  for (const pageInfo of pageIds) {
    const { id: page_id, volume, page_number, collection_title } = typeof pageInfo === 'string' ? { id: pageInfo, volume: null, page_number: null, collection_title: null } : pageInfo;
    try {
      const t = await fetchTranscript(page_id);
      db.upsertTranscript({
        page_id,
        source_kind: t.source_kind,
        captured_at: t.captured_at,
        is_voice: !!t.is_voice,
        is_markdown: !!t.is_markdown,
        transcript: t.transcript || '',
        summary: t.summary || null,
        volume,
        page_number,
        collection_title,
      });
      db.linkTranscriptSource(page_id, kind, gloss_id);
      if ((t.transcript || '').trim().length > 0) withText += 1;
    } catch (err) {
      console.warn(`[gloss] transcript fetch ${page_id} failed:`, err.message);
    }
  }
  return { pages: pageIds.length, with_text: withText };
}

export async function hydrateAllLinksForDocument(document_id) {
  const links = db.listGlossLinks(document_id);
  let totalPages = 0, totalText = 0;
  for (const link of links) {
    const r = await hydrateLink({
      document_id,
      kind: link.kind,
      gloss_id: link.gloss_id,
      label: link.label,
    });
    totalPages += r.pages;
    totalText += r.with_text;
  }
  return { links: links.length, pages: totalPages, with_text: totalText };
}

const SCRIBE_URL = (process.env.SCRIBE_URL || 'https://scribe-nc.fly.dev').replace(/\/$/, '');

// Create or update a Gloss artifact that represents this Scribe document.
// Call this when a new collection is linked so the collection detail in Gloss
// shows the Scribe doc as a connected artifact.
export async function ensureGlossArtifact(document, collection_id) {
  if (!document) return null;
  const external_url = `${SCRIBE_URL}/d/${document.id}`;
  try {
    let artifactId = document.gloss_artifact_id;
    if (!artifactId) {
      const a = await request('/api/artifacts', {
        method: 'POST',
        body: {
          title: document.title || 'Untitled (Scribe)',
          external_url,
          collection_ids: collection_id ? [collection_id] : [],
          notes: document.description || '',
        },
      });
      artifactId = a.id;
      db.setDocumentGlossArtifact(document.id, artifactId);
    } else if (collection_id) {
      await request(`/api/artifacts/${encodeURIComponent(artifactId)}/links`, {
        method: 'POST',
        body: { to_type: 'collection', to_id: collection_id },
      }).catch(e => console.warn('[gloss] artifact link failed:', e.message));
    }
    return artifactId;
  } catch (err) {
    console.warn('[gloss] ensureGlossArtifact failed:', err.message);
    return null;
  }
}

export function buildSearchQuery(doc) {
  return [doc?.description || '', doc?.main_point || '', doc?.title || ''].join(' ');
}

export function pageDeepLink(page_id) {
  return `${GLOSS_URL}/page/${encodeURIComponent(page_id)}`;
}
