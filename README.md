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

## Configuration & secrets

Copy [`.env.example`](.env.example) to `.env` and fill in values locally. **Never
commit a real `.env`** — `.gitignore` excludes it. All connector credentials are
the customer's own admin credentials, used read-only and stored encrypted at rest.

## Status

Built milestone-by-milestone per the build plan. **M0 (repo scaffold &
foundations)** is the current baseline: package skeletons, tooling, CI, and one
placeholder test per package. Functional milestones (data model, auth, connectors,
screens, hook) follow in order.
