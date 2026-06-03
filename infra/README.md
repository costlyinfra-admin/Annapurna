# infra/ — Infrastructure as code (placeholder)

Infrastructure-as-code for Annapurna's cloud deployment (AWS or equivalent, per
design doc §10).

Expected to hold, as milestones require it:

- Postgres (multi-tenant, row-level tenant isolation) — provisioning + migrations wiring.
- Serverless functions / services for connector ingest, hook-event ingest, the API
  layer, and scheduled reconciliation jobs.
- Encrypted credential storage for per-tenant connector credentials.
- Scheduled-job (cadence) configuration for Admin/GitHub API polling.

No infrastructure is provisioned in M0 — this is a placeholder so the layout is
stable. Real IaC lands alongside the milestones that need deployed resources.
