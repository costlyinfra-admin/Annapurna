# Deploying Annapurna (free stack → `annapurna.costlyinfra.com`)

This gets the whole app live on a **free** stack, on your own subdomain.

**The stack**
- **Database:** Neon (free managed Postgres)
- **App (API + website):** Render (free Docker web service) — one service serves both
- **Scheduled cost ingest:** GitHub Actions (free cron)
- **Domain/DNS:** your existing IONOS panel (a single DNS record)

> ⏱️ ~30–45 minutes the first time. Free-tier note: the Render free service **sleeps
> after ~15 min idle** (first visit then takes ~30–60s to wake). Fine for demos;
> upgrade the Render service to a paid instance (~$7/mo) when a real user relies on it.

---

## What you'll need to invent (2 secrets)

Generate these once and keep them safe:

- **`APP_SECRET_KEY`** — a long random string. It encrypts stored connector
  credentials, so **never change it after launch** (changing it makes saved
  credentials undecryptable). Generate one:
  ```bash
  python3 -c "import secrets; print(secrets.token_urlsafe(48))"
  ```
- **`ANNAPURNA_APP_DB_PASSWORD`** — a password you pick for the app's database
  role (any strong random string; the same generator works).

---

## Step 1 — Database (Neon)

1. Sign up at **neon.tech**, create a project (pick a region near your users).
2. Copy the **connection string** it shows — looks like
   `postgresql://OWNER:PASSWORD@ep-xxx.neon.tech/neondb?sslmode=require`.
   This is your **`DATABASE_URL`**.

That's it — migrations create the tables and the app's database role automatically
on first deploy.

> If the deploy logs ever show a permission error creating the `annapurna_app`
> role, run this once in Neon's SQL editor, then redeploy:
> `CREATE ROLE annapurna_app LOGIN;`

## Step 2 — Deploy the app (Render)

1. Sign up at **render.com** and connect your GitHub (`costlyinfra-admin/Annapurna`).
2. **New → Blueprint** → pick the repo. Render reads [`render.yaml`](../render.yaml)
   and proposes the `annapurna` web service. Click **Apply**.
3. When prompted, fill the three secrets (these are `sync:false` in the blueprint):
   - `DATABASE_URL` → the Neon string from Step 1
   - `APP_SECRET_KEY` → your generated key
   - `ANNAPURNA_APP_DB_PASSWORD` → your chosen app DB password
4. Deploy. Render builds the Docker image (web + API), runs migrations on start,
   and gives you a URL like `https://annapurna.onrender.com`. Open it — you should
   see the login page. 🎉

## Step 3 — Your subdomain (Render + IONOS)

1. In Render: **Settings → Custom Domains → Add** `annapurna.costlyinfra.com`.
   Render shows you a target (a `CNAME` value).
2. In **IONOS** (your domain's DNS settings), add a **CNAME record**:
   - **Host/Name:** `annapurna`
   - **Points to / Value:** the target Render gave you
3. Wait a few minutes. Render auto-issues a free HTTPS certificate, and
   **https://annapurna.costlyinfra.com** goes live. Your `www` site is untouched.

## Step 4 — Scheduled cost ingest (GitHub Actions, free)

The daily ingest job ([`.github/workflows/ingest.yml`](../.github/workflows/ingest.yml))
just needs the same secrets. In GitHub: **Settings → Secrets and variables →
Actions → New repository secret**, add three:

- `DATABASE_URL`, `APP_SECRET_KEY`, `ANNAPURNA_APP_DB_PASSWORD`

It runs daily; you can also trigger it anytime from the **Actions** tab
(**Scheduled ingest → Run workflow**).

## Step 5 — First use

- Go to your URL and **create an account** — that's a fresh, empty tenant.
- Walk onboarding: connect GitHub + a provider, review features, confirm.
- On the dashboard, **Add cost data** to sync inference and import a build-cost CSV.

Want a populated demo instead? You can seed the demo tenant by running, with your
Neon `DATABASE_URL` exported locally: `make db-seed` (login `demo@acme.com` /
`annapurna-demo`).

---

## For customers installing the metering hook (optional)

They point the SDK at:
`https://annapurna.costlyinfra.com/api/hook/events`
using the ingest token from **POST `/api/hook/token`** (offered in onboarding).

## Environment variables (reference)

| Variable | Where | Purpose |
|---|---|---|
| `DATABASE_URL` | Render + GitHub secrets | Neon connection (owner/admin role) |
| `APP_SECRET_KEY` | Render + GitHub secrets | Encrypts stored credentials — **keep stable** |
| `ANNAPURNA_APP_DB_PASSWORD` | Render + GitHub secrets | Password for the RLS-enforced app DB role |
| `ANNAPURNA_SECURE_COOKIES` | set to `true` in prod (blueprint default) | Secure session cookie over HTTPS |
| `ANNAPURNA_STATIC_DIR` | set by the Docker image | Tells the API to also serve the web app |

## When you outgrow free
- **No more cold starts:** upgrade the Render service to a paid instance (~$7/mo).
- **Bigger/faster DB:** raise the Neon plan (same connection string).
- **Migrate to AWS** (the design-doc target) later — it's standard Postgres + a
  container, so nothing here locks you in.
