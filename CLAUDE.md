# Scribe

Collaborative document editor with gloss integration. Lets the user create and edit longform documents that link back to gloss pages and collections.

## Stack
- Node 20, Express API + Vite/React frontend
- SQLite (better-sqlite3) for documents and collaboration metadata
- Deployed to Fly.io as **`scribe-nc`**

## Key files
- `server.js` — Express API
- `db.js` — schema + queries
- `routes/gloss-links.js` — two-way link layer with gloss (read + write gloss collections)
- `src/` — Vite/React frontend (editor, dashboard)
- `public/` — built static assets (manifest, sw.js, offline.html)
- `tests/` — API + route tests (includes `status.test.js`)

## API routes
- `GET /api/health` — liveness
- `GET /api/status` — suite-standard status envelope, Bearer auth
- `GET /api/documents` — list/search docs
- `POST /api/documents` — create
- `GET /api/gloss-links/collections` — gloss-linked collections surface

## Integration points (env vars)
- `API_KEY` — inbound Bearer / X-API-Key
- `SUITE_API_KEY` — shared key maestro uses to poll `/api/status`
- `GLOSS_URL`, `GLOSS_API_KEY` — call gloss from scribe (gloss-linked collections)

## Auth model
Bearer token (`Authorization: Bearer ...`) on `/api/*`. `/api/status` accepts either `API_KEY` or `SUITE_API_KEY`.

## Data
SQLite at `/data/scribe.db` on the Fly volume.

## Test command
```
npm test
```

## Deploy command
```
fly deploy -a scribe-nc
```

## Backups
Litestream replicates `/data/scribe.db` continuously to R2 bucket `nathan-suite-backups/scribe/`. See `litestream.yml`.

## Suite siblings
- [gloss](../gloss/CLAUDE.md) — primary integration target (scribe calls gloss for linked collections)
- [comms](../comms/CLAUDE.md) — messaging/email hub
- [black](../black/CLAUDE.md) — personal file search
- [maestro](../maestro/CLAUDE.md) — orchestration daemon
