# Integration Contract: Expand Scribe Content Sources

**Feature branch:** `maestro/expand-scribe-content-sources`  
**Repos involved:** `scribe` (primary), `black` (peer — no new endpoints required)

---

## Overview

Scribe's document view gains two additional reference panels:

| Panel | Source | Discovery |
|-------|--------|-----------|
| Archive | Black Hole (`/api/search`) | Semantic via document topic signal |
| Readwise | Local Readwise mirror (`readwise_highlights` table) | Keyword-matched via document topic signal |

Both panels reuse `buildSearchQuery(doc)` from `black.js` to derive the topic signal from `description + main_point + title`. This makes all three content source panels (Notebook / Archive / Readwise) driven by the same semantic intent.

---

## Black Integration (Direction A — Archive tab)

### Existing endpoint (unchanged)

```
GET /api/documents/:id/black-suggestions?k=N&fresh=1
```

**Auth:** any collaborator (viewer+), cookie or Bearer  
**Cache:** 5-minute per `(document_id, k)`, busted by `?fresh=1`

**Response:**
```json
{
  "results": [
    {
      "file_id": "string",
      "name": "string",
      "drive_path": "string",
      "web_view_link": "string | null",
      "content": "string",
      "distance": 0.12
    }
  ],
  "query": "string"
}
```

Black's `/api/search` endpoint is called server-side so `BLACK_API_KEY` never reaches the browser. The result shape comes directly from Black with no transformation — callers should treat unknown fields as opaque.

**Gating:** if `BLACK_URL` / `BLACK_API_KEY` are unset, the route returns `{ results: [], query: "" }` silently.

---

## Readwise Integration (Direction B — Readwise tab)

### Global read endpoints (existing, unchanged)

```
POST /api/readwise/sync
GET  /api/readwise/state
GET  /api/readwise/books
GET  /api/readwise/books/:id/highlights?limit=&offset=
GET  /api/readwise/search?q=&limit=
GET  /api/readwise/recent?limit=
```

**Auth:** app-level (cookie or Bearer), no per-document scoping  
**Env:** `READWISE_TOKEN` required for `/sync`; read endpoints work without it (return empty set)

### New: document-contextual endpoint

```
GET /api/documents/:id/readwise-suggestions?k=N&fresh=1
```

**Auth:** any collaborator (viewer+), cookie or Bearer  
**Cache:** 5-minute per `(document_id, k)`, busted by `?fresh=1`

**Topic derivation:** same `buildSearchQuery(doc)` used by `/black-suggestions`. Keywords with ≥4 characters are extracted and matched (OR) against `highlight.text`, `highlight.note`, and `book.title` using SQLite LIKE. Up to 8 keywords; rows ranked by match count (text matches weighted ×2 vs. note/title ×1).

**Response:**
```json
{
  "results": [
    {
      "highlight_id": 101,
      "text": "string",
      "note": "string | null",
      "location": 38,
      "url": "string | null",
      "highlighted_at": "2026-03-01T14:22:31Z",
      "book": {
        "id": 7,
        "title": "string",
        "author": "string | null",
        "category": "books"
      }
    }
  ],
  "query": "string"
}
```

**Gating:** if no highlights are synced yet, returns `{ results: [], query: "..." }`. No error status.

---

## Black → Scribe hand-off (Direction B — existing, unchanged)

Black's `/api/files/:id/open-in-scribe` calls `POST /api/documents` with:

```json
{
  "source": { "kind": "black", "file_id": "...", "drive_path": "...", "web_view_link": "...", "mime_type": "..." },
  "seed_body": "plain text extracted from the file"
}
```

Scribe stores `source_json` and `pending_seed` on the document row. The draft editor reads the seed once via `GET /api/documents/:id/pending-seed` (read-once consumer) and inserts it as paragraph blocks.

---

## UI layout

```
ReferencePanel (right sidebar)
  ├─ [Notebook] tab  — CandidateCards (gloss-linked notecards)
  ├─ [Archive]  tab  — ArchiveSuggestions (black semantic hits)
  └─ [Readwise] tab  — ReadwisePanel (contextual highlights)
```

Each tab persists in `localStorage` under `scribe.refPanel.tab`. Archive and Readwise panels are lazy — they only load when the tab is first activated.

---

## Environment variables

| Variable | Service | Purpose |
|----------|---------|---------|
| `BLACK_URL` | scribe | Base URL of the black service |
| `BLACK_API_KEY` | scribe | Bearer token for outbound calls to black |
| `READWISE_TOKEN` | scribe | Readwise API v2 token for sync |
| `SCRIBE_URL` | black | Base URL of scribe (for open-in-scribe) |
| `SCRIBE_API_KEY` | black | Bearer token for black→scribe calls |

---

## No changes required in Black

Black's `/api/search` endpoint is stable; Scribe calls it server-side via `black.js`. No new Black endpoints are introduced by this feature.
