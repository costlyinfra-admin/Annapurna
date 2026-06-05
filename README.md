# Annapurna

Annapurna takes a company's blended AI bill and tells them exactly **which
features consumed it** — what each feature cost to **build** (AI coding tools)
and to **run** (inference) — so a CTO/CFO can decide whether the AI investment
was worth it.

The buyer is a CTO/CFO, not a developer. The output is board-grade: one credible,
defensible number per feature, with a confidence level and an evidence trail
behind every figure.

> **Core invariants** (see [`CLAUDE.md`](CLAUDE.md)): the connector path is the
> must-ship core and stands alone; build cost and inference cost are never
> blended; every cost row carries a confidence value with an evidence trail;
> `feature_id` is the spine and unmapped spend goes to the **Unattributed**
> bucket; all connectors are read-only with strict per-tenant isolation.

## Documentation

- **[`docs/annapurna-design-doc.md`](docs/annapurna-design-doc.md)** — the canonical
  spec (intent, data model, attribution, screens). Wins on intent.
- **[`docs/build-plan.md`](docs/build-plan.md)** — ordered milestones M0–M8 with
  acceptance criteria. Built one at a time, in order.
- **[`CLAUDE.md`](CLAUDE.md)** — standing instructions and non-negotiable invariants.

## Repository layout

| Path        | What it is |
|-------------|------------|
| `backend/`  | Python services — connector ingest, attribution, reconciliation, API layer. |
| `web/`      | React + TypeScript single-page app — the dashboard, drill-down, and onboarding wizard. |
| `sdk/`      | Placeholder for the M7 metering hook (Python first, then Node). |
| `infra/`    | Infrastructure-as-code (AWS or equivalent). |
| `docs/`     | Design doc + build plan. |

## Prerequisites

- **Python 3.9+** (backend)
- **Node 18+ and npm** (web)
- **GNU Make** (orchestration)
- **PostgreSQL 16** (database). On macOS: `brew install postgresql@16`. The test
  suite spins up its own throwaway Postgres, so you don't need a running server
  just to run tests — only the Postgres tools installed.

## Quick start

```bash
# 1. Install dependencies for both packages
make install

# 2. Run the full test suite (backend + web)
make test
```

`make install` creates a Python virtualenv at `backend/.venv` and runs `npm install`
in `web/`. `make test` runs `pytest` (backend) and `vitest` (web).

### Running each package on its own

**Backend (Python):**

```bash
make install-backend          # creates backend/.venv and installs dev deps
cd backend && .venv/bin/pytest # run tests
```

**Web (React + TypeScript):**

```bash
make install-web              # npm install in web/
cd web && npm run dev         # start the Vite dev server (http://localhost:5173)
cd web && npm test            # run the Vitest suite
```

### Other make targets

```bash
make lint     # ruff (backend) + eslint (web)
make format   # ruff format (backend) + prettier (web)
make clean    # remove venv, node_modules, build caches
make help     # list all targets
```

## Running the app (M2+)

Two processes: the FastAPI backend and the Vite web dev server. You need a
running Postgres (see Database below) plus two environment variables —
`DATABASE_URL` and `APP_SECRET_KEY` (used for sessions and credential encryption).

```bash
export DATABASE_URL=postgresql://localhost:5432/annapurna
export APP_SECRET_KEY=dev-secret-change-me

make db-migrate     # set up the schema (first time)
make api            # terminal 1: backend on http://localhost:8000
make web            # terminal 2: web on http://localhost:5173
```

Open http://localhost:5173, create an account, and you'll land in the three-step
onboarding wizard (Connect → Review → Confirm). The web dev server proxies `/api`
to the backend. Auth uses a signed, http-only session cookie; connector secrets
you paste are encrypted before they're stored.

**Want to see the dashboard with data immediately?** Run `make db-seed` and log in
as the demo account it prints (`demo@annapurna.com` / `annapurna-demo`) — the seeded
"Acme Security" tenant has features with build + inference cost, usage, and an
Unattributed bucket already populated.

**Fastest path — one command:** `make demo` spins up a throwaway seeded database,
starts both servers, and prints the login. See
[docs/demo-script.md](docs/demo-script.md) for the full demo narrative.

## Database

The data model (design doc §6) is six entities — `feature`, `feature_signal`,
`build_cost`, `inference_cost`, `bill_reconciliation`, `feature_usage` — plus a
`tenant` table that anchors tenant isolation. Schema lives in
[`backend/migrations/`](backend/migrations) as plain, readable SQL.

**Tenant isolation is enforced by the database, not just by application code.**
Every tenant table uses Postgres Row-Level Security (RLS): the app connects as a
non-privileged role and each request sets `app.current_tenant`, so a query can
only ever see the current tenant's rows — even if a `WHERE` clause is forgotten.
Migrations and seeding run as a separate bootstrap role that bypasses RLS.

To run against a real local Postgres (a running server, unlike the tests):

```bash
# macOS: Postgres 16 is "keg-only", so put its tools on PATH and start the server
export PATH="/opt/homebrew/opt/postgresql@16/bin:$PATH"
brew services start postgresql@16   # or run pg_ctl manually

# one-time: create a database
createdb annapurna

# point the app at it, then apply migrations and load a demo tenant
export DATABASE_URL=postgresql://localhost:5432/annapurna
make db-migrate    # apply pending SQL migrations
make db-seed       # apply migrations + seed one demo tenant ("Acme Security")
```

The tenant-isolation guarantee is covered by tests in
[`backend/tests/test_tenant_isolation.py`](backend/tests/test_tenant_isolation.py).

> **macOS note:** if starting Postgres manually fails with “postmaster became
> multithreaded during startup”, set `export LC_ALL=en_US.UTF-8` first. The test
> suite handles this automatically.

## Configuration & secrets

Copy [`.env.example`](.env.example) to `.env` and fill in values locally. **Never
commit a real `.env`** — `.gitignore` excludes it. All connector credentials are
the customer's own admin credentials, used read-only and stored encrypted at rest.

## Self-hosting / use it yourself

Annapurna is open source — fork it, run it for your own company, or deploy your
own instance. Two paths:

- **Try it locally in one command:** `make demo` spins up a throwaway seeded
  database, starts the app, and prints a login (`demo@annapurna.com` / `annapurna-demo`).
  Prereqs: `make install` and PostgreSQL 16.
- **Deploy your own instance:** follow [`docs/deploy.md`](docs/deploy.md) — a
  step-by-step on a free stack (Neon + Render + a free GitHub Actions cron),
  reachable at your own subdomain. The Docker image is host-agnostic, so any
  container host works.

Forking for your own product? Swap the branding (`Annapurna`, the `annapurna_meter`
/ `@annapurna/meter` SDK names), the domain/repo references in the docs, and the
seed data, and you're off. See [`CONTRIBUTING.md`](CONTRIBUTING.md) for how the
repo is laid out and how to run the checks.

## License

Annapurna is licensed under the **GNU Affero General Public License v3.0**
(AGPL-3.0) — see [`LICENSE`](LICENSE). You're free to use, modify, and self-host
it; if you run a **modified** version as a network service, the AGPL requires you
to make your source available to its users. (If you need different terms for a
commercial/closed deployment, that's a separate licensing conversation with the
copyright holder.)

© 2026 CostlyInfra.

## Status

Built milestone-by-milestone per the build plan.

- **M0 — Repo scaffold & foundations.** Package skeletons, tooling, CI.
- **M1 — Data model & multi-tenancy.** The six entities + `tenant`, SQL
  migrations, RLS-enforced tenant isolation, and a seed script.
- **M2 — Auth & onboarding shell.** Email/password signup-login-logout over
  signed cookie sessions, a tenant created per signup, encrypted-at-rest
  connector credentials, and the 3-step onboarding wizard shell.
- **M3 — GitHub connector + feature auto-discovery.** Read-only GitHub PR
  connector; discovery clusters the last 90 days of merged PRs into proposed
  features (Claude when `ANTHROPIC_API_KEY` is set, deterministic heuristic
  otherwise); wizard Step 2 with rename/split/merge/delete/add; confirm writes
  confirmed features.
- **M4 — Provider cost ingest (inference).** Read-only Anthropic + OpenAI cost
  connectors; ingest stores authoritative monthly totals (`source = cost_api`)
  attributed by key/project to a feature (high/med confidence) or to the
  **Unattributed** bucket; `make ingest` runs the scheduled job.
- **M5 — Build-cost ingest (coding tools).** CSV import (Cursor-for-Teams seat
  export and the universal fallback); allocates each developer's spend across
  features by the PRs they authored; writes `build_cost` per feature and per
  developer, broken down by tool, with confidence; unattributable spend → the
  Unattributed bucket.
- **M6 — The three screens.** Features dashboard (build vs. inference in separate
  columns, active users, cost/user, "Worth it?", confidence, Unattributed row),
  feature drill-down (headlines, build-by-developer, inference trend, evidence
  trail, connector-vs-hook indicator), and the onboarding wizard wired end to end.
  **The connector path is complete and shippable here.**
- **M7 — Metering hook.** Thin, fail-safe SDKs ([Python + Node](sdk)) emit per-call
  usage; a token-authed ingest endpoint costs tokens from versioned pricing tables
  and writes `source = hook` rows at High confidence; reconciliation ties hook
  totals to the provider bill and routes the gap to Unattributed (no
  double-counting). The hook is optional and never blocks onboarding.
- **M8 — Hardening & demo readiness.** Retry/backoff on ingest, graceful connector
  failures, a React error boundary, request logging, and a one-command demo
  (`make demo` + [docs/demo-script.md](docs/demo-script.md)). ← **v1 complete**

**v1 is feature-complete:** the connector path (build + inference cost per feature,
confidence + evidence trail, Unattributed bucket) plus the optional metering hook.
