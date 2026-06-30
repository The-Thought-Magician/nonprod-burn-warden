# NonprodBurnWarden

NonprodBurnWarden is a FinOps platform that quantifies and helps recover the money that non-production cloud environments waste by running 24/7 for no reason. It builds a per-environment idle-spend ledger: it tags every cloud resource into an environment (dev, staging, QA, sandbox, preview), detects when those environments run out of hours with no usage, computes the dollars burned while always-on, and models the savings of timezone- and holiday-aware off-hours schedules. The output is a monthly recovery report a platform or FinOps lead can take to finance to prove five-to-six-figure monthly savings.

The product is deterministic and report-and-model only. It never mutates cloud infrastructure. It works over uploaded CSV billing/usage exports, connected read-only cost feeds, or a built-in sample-data seeder for instant demoability.

See [docs/idea.md](docs/idea.md) for the full feature spec.

## Features

- Environment inventory and classification (dev, staging, QA, sandbox, preview, prod, unknown).
- Tag and naming rule engine with priority ordering, preview, and coverage stats.
- Idle-window detection from usage samples (CPU, network, request count).
- Always-on waste ledger attributing wasted dollars per environment, resource, and team.
- Timezone- and holiday-aware off-hours schedule modeling with savings ROI estimates.
- Orphan findings, showback allocations, team budgets, recommendations, and recovery reports.
- CSV import batches, sample-data seeder, alerts, saved views, and activity log.

All features are free for every signed-in user. Stripe billing is wired but optional and returns 503 when unconfigured.

## Stack

- **Backend:** Hono on Node (TypeScript, ESM), Drizzle ORM over Neon Postgres. Run via `node --import tsx/esm` (no runtime compile step). REST API under `/api/v1`, one child Hono router per domain.
- **Frontend:** Next.js 16 (App Router), React 19, TypeScript strict, Tailwind 4. Auth via Neon Auth (`@neondatabase/auth`).
- **Auth model:** Next.js resolves the session server-side and proxies API calls to the backend through `/api/proxy/*`, injecting a trusted `X-User-Id` header. The backend trusts that header and does no JWT verification.
- **Database:** Neon Postgres. Tables are provisioned out of band (Drizzle schema push / Neon console); the app seeds sample data on first boot but does not create its own tables.

## Local Development

Prerequisites: Node 22+, pnpm, and a Neon Postgres database (or any Postgres reachable via `DATABASE_URL`).

### Backend

```bash
cd backend
pnpm install
cp .env.example .env   # then fill in DATABASE_URL etc.
pnpm dev               # node --import tsx/esm src/index.ts, listens on PORT (default 3001)
```

### Frontend

```bash
cd web
pnpm install
cp .env.example .env.local   # then fill in the values below
pnpm dev                     # next dev on http://localhost:3000
```

### Docker

```bash
docker compose up --build
```

Brings up backend on `http://localhost:3001` and web on `http://localhost:3000`.

## Environment Variables

### Backend (`backend/.env`)

```
PORT=3001
DATABASE_URL=postgres://user:password@host/db?sslmode=require
FRONTEND_URL=http://localhost:3000
ADMIN_USER_IDS=
# STRIPE_SECRET_KEY=
# STRIPE_PRO_PRICE_ID=
# STRIPE_WEBHOOK_SECRET=
```

- `DATABASE_URL` — Neon Postgres connection string (required).
- `FRONTEND_URL` — allowed CORS origin for the web app.
- `ADMIN_USER_IDS` — comma-separated user IDs granted admin endpoints (optional).
- `STRIPE_*` — optional; billing endpoints return 503 when unset.

### Frontend (`web/.env.local`)

```
NEON_AUTH_BASE_URL=https://<endpoint>.neonauth.<region>.aws.neon.tech/<db>/auth
NEON_AUTH_COOKIE_SECRET=<random 32-byte hex>
NEXT_PUBLIC_API_URL=https://nonprod-burn-warden-api.onrender.com
```

- `NEON_AUTH_BASE_URL`, `NEON_AUTH_COOKIE_SECRET` — server-only, used by Neon Auth.
- `NEXT_PUBLIC_API_URL` — the only public var; baked at build time and read by the proxy route as the backend base URL. Browser code calls the backend through relative `/api/proxy/...` paths.

## Deployment

- **Backend:** Render web service (see `render.yaml`). Build `cd backend && pnpm install`, start `cd backend && node --import tsx/esm src/index.ts`. Set `DATABASE_URL` and `FRONTEND_URL` as Render env vars.
- **Frontend:** Vercel, root directory `web`, framework Next.js, Node 22.x.
