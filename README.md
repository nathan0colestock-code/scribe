# Scribe

A collaborative longform document editor that lives inside a personal app suite. Scribe is where prose goes: drafts, essays, proposals, meeting notes — anything that benefits from a real editor rather than a bullet-journal page.

Scribe's superpower is **two-way linking with [gloss](https://github.com/nathan0colestock-code/gloss)**: a gloss collection can be attached to a document, and the document's drag-handles, block actions, and reference side-panel know how to pull from that collection.

---

## Surfaces

- **Home** — dashboard of all documents, tagged by linked gloss collection
- **Editor** — a block-based editor with drag handles, style guide, and gloss-linked side panel
- **Collections** — documents grouped under the gloss collections they reference

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
- `POST /api/documents` — create
- `GET /api/gloss-links/collections` — list linked gloss collections

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
