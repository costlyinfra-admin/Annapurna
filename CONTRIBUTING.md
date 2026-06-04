# Contributing to Annapurna

Thanks for your interest! Annapurna is open source (AGPL-3.0) — contributions and
forks are welcome.

## Repository layout

| Path | What it is |
|---|---|
| `backend/` | Python API + ingest/attribution/reconciliation (FastAPI, psycopg). |
| `web/` | React + TypeScript single-page app (Vite, Vitest). |
| `sdk/python`, `sdk/node` | The optional metering-hook SDKs. |
| `backend/migrations/` | Plain SQL migrations, applied in filename order. |
| `infra/`, `Dockerfile`, `render.yaml`, `deploy/` | Deployment. |
| `docs/` | Design doc, build plan, deploy guide, demo script. |

Start with [`docs/annapurna-design-doc.md`](docs/annapurna-design-doc.md) for the
intent and data model, then [`docs/build-plan.md`](docs/build-plan.md) for how it
was built.

## Prerequisites

- Python 3.9+, Node 18+, GNU Make, PostgreSQL 16 (`brew install postgresql@16` on macOS).
- The test suite spins up its own throwaway Postgres — you only need the tools installed.

## Develop

```bash
make install     # backend venv + web deps
make demo        # run the whole app locally with seeded data
```

## Run the checks (please do this before opening a PR)

```bash
make test        # backend (pytest) + web (vitest)
make lint        # ruff + eslint
make test-sdk    # the Python + Node SDKs
```

All three should be green. New behavior should come with tests — especially
anything touching **attribution, reconciliation, or tenant isolation**, which are
the core guarantees.

## Non-negotiable invariants (please preserve these)

These are the heart of the product (see [`CLAUDE.md`](CLAUDE.md) for the full list):

1. The **connector path stands alone**; the metering hook is optional and must
   never be required for onboarding.
2. **Build cost and inference cost are never blended** into one number.
3. **Every cost row carries a confidence value** and is explainable via its
   evidence trail.
4. **`feature_id` is the spine**; unmapped spend goes to the **Unattributed
   bucket**, never silently dropped.
5. **All connectors are read-only**, credentials encrypted at rest, with strict
   **per-tenant isolation** (enforced by Postgres Row-Level Security).

## Commit & PR style

- Small, focused commits with clear messages.
- Keep secrets out of the repo (`.env.example` only).
- Open a PR against `main`; make sure CI is green.

## License of contributions

By contributing, you agree your contributions are licensed under the project's
**AGPL-3.0-or-later** license.
