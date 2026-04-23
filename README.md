# Scribe

A collaborative longform document editor that lives inside a personal app suite. Scribe is where prose goes: drafts, essays, proposals, meeting notes — anything that benefits from a real editor rather than a bullet-journal page.

Scribe's superpower is **two-way linking with [gloss](https://github.com/nathan0colestock-code/gloss)**: a gloss collection can be attached to a document, and the document's drag-handles, block actions, and reference side-panel know how to pull from that collection.

---

## Surfaces

- **Home** — dashboard of all documents, tagged by linked gloss collection
- **Editor** — a block-based editor with drag handles, style guide, and gloss-linked side panel
- **Collections** — documents grouped under the gloss collections they reference

### Workflow features

- **Three stages per doc** — outline → draft → review, each with its own Yjs-backed editor. Stage transitions auto-snapshot into `document_snapshots` so rewinding to "what did the outline look like when I started drafting" is free.
- **Paste-import** — "Import text…" button next to "New document". Paste a reMarkable export (or any plain text), confirm the title, hit Create. The new doc opens in Draft with the text seeded in.
- **Send to Comms** — on a review-stage doc, hand off the current plaintext to comms as an outbound Gmail draft. Comms regenerates the body in Nathan's voice using the recipient's comms + gloss history; nothing sends automatically.
- **Corruption-safe collab** — Yjs updates are try/catch-wrapped, so a single bad buffer no longer bricks a doc permanently; the corrupt state is preserved as a `corruption_fallback` snapshot for offline inspection.

---

## Stack

- Node 20 + Express API
- Vite + React frontend (`src/`)
- SQLite (`better-sqlite3`)
- Deployed to [Fly.io](https://fly.io) as **`scribe-nc`**
- SQLite replicated to Cloudflare R2 via [Litestream](https://litestream.io)

---

## Quick start

```bash
npm install
cp .env.example .env              # set API_KEY, GLOSS_URL, GLOSS_API_KEY
npm run dev                        # API on :3000, web on :5173
npm test
```

---

## API

All `/api/*` routes require Bearer auth with either the app's `API_KEY` or the shared suite `SUITE_API_KEY`.

- `GET /api/health` — liveness, no auth
- `GET /api/status` — suite-standard status envelope (see "Suite siblings" below)
- `GET /api/documents` — list + search
- `POST /api/documents` — create. Accepts optional `source: { kind, ... }` + `seed_body` so a server-side creator (e.g. Black's "Open in Scribe") can seed the initial draft.
- `GET /api/documents/:id/pending-seed` — read-once drain of server-side seed text, used by the draft editor on first open.
- `GET /api/documents/:id/black-suggestions` — Archive hits for the doc's topic (queries black on demand, cached 5 min).
- `POST /api/documents/:id/send-to-comms` — hand off to comms for outbound drafting
- `POST /api/documents/:id/materialize` — explode outline into a draft fragment
- `GET /api/gloss-links/collections` — list linked gloss collections
- `POST /api/readwise/sync` — pull updated highlights + books from Readwise (needs `READWISE_TOKEN`)
- `GET /api/readwise/search?q=...` — fuzzy search across highlights + notes + book titles
- `GET /api/readwise/books`, `GET /api/readwise/books/:id/highlights`, `GET /api/readwise/recent`, `GET /api/readwise/state`

## Reference panel

The sidebar on any document now has three sources feeding it:

- **Gloss** — collections, people, scripture, books, artifacts matching the doc's topic
- **Archive** — top hits from [black-hole](https://github.com/nathan0colestock-code/black) matching the doc's topic
- **Readwise** — searchable library of highlights + source books pulled from your Readwise account

Clicking any item inserts a citation-style blockquote at the cursor. Scribe routes the insertion to the right editor based on stage (Outline vs Draft).

---

## Deploy

```bash
fly deploy -a scribe-nc
```

Fly secrets needed: `API_KEY`, `SUITE_API_KEY`, `GLOSS_URL`, `GLOSS_API_KEY`, `SESSION_SECRET`, `AUTH_PASSWORD`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT`.

---

## Suite siblings

Scribe is the **longform writing** node of a five-app personal suite. Independent processes, all on [Fly.io](https://fly.io), all backed up to R2 via Litestream.

| App | Role | How it integrates with Scribe |
|---|---|---|
| **[gloss](https://github.com/nathan0colestock-code/gloss)** | Personal knowledge graph | Primary partner — scribe reads/writes gloss collections, documents are tagged by gloss collection |
| **[comms](https://github.com/nathan0colestock-code/comms)** | iMessage + Gmail + contacts | Indirect: contact profiles flow comms → gloss → scribe |
| **[black](https://github.com/nathan0colestock-code/black)** | Personal file search (Drive, Evernote, iCloud → indexed) | Black can search inside scribe documents via the shared gloss surface |
| **[maestro](https://github.com/nathan0colestock-code/maestro)** | Overnight orchestration | Polls `GET /api/status`; can dispatch feature sets touching scribe |

All five apps expose a suite-standard `GET /api/status` → `{ app, version, ok, uptime_seconds, metrics }`, Bearer-authed.

Integration contracts between pairs of apps live in `docs/INTEGRATIONS/` in the primary repo for each contract.

---

## License

Private.
