# Page Pulse

Page Pulse is a website SEO audit workspace. It fetches a public page's returned HTML, extracts page-level SEO and accessibility signals, assigns a transparent weighted score, and saves evidence-backed recommendations in scan reports.

The application has a public product site and a local development workspace. Hosted workspace APIs require server-verified sign-in and scope report operations to each account. Local development retains the unauthenticated SQLite workspace for existing local reports.

## Features

- Public landing page, feature guide, workflow guide, privacy and terms pages.
- Dashboard values, score trend, issue categories, report list, and score averages sourced only from saved scans.
- Real HTML analysis for response status and timing, title and description, headings, images, links, canonical, robots, language, viewport, Open Graph, JSON-LD, visible word estimate, HTTPS, robots.txt, and sitemap discovery.
- Weighted score with unevaluated checks excluded from the denominator.
- Findings with severity, priority, observed evidence, context, and a suggested fix.
- Searchable and sortable report history, JSON and CSV exports, print layout, clear-history action, and dark/light theme preference.
- Local SQLite persistence by default; PostgreSQL persistence when `DATABASE_URL` is set.
- SSRF controls, response limits, request timeouts, redirect revalidation, security headers, CORS allowlist, and request rate limits.

## Architecture

- `client/`: React 19 and Vite 8 application, React Router, Framer Motion, Lucide icons, and Recharts.
- `server/`: Express 5 API. Services separate URL validation and fetching, HTML parsing, scoring, and recommendations.
- `server/src/repositories/scanRepository.js`: repository boundary for PostgreSQL or local SQLite storage.
- `server/migrations/`: PostgreSQL schema migration.
- `server/tests/`: Jest and Supertest service/API tests.

The local SQLite database is stored at `server/data/scans.sqlite` (ignored by Git). It is suitable for local use or a single persistent server disk, not a multi-instance deployment. Configure PostgreSQL for a shared durable database. Raw page HTML is not stored.

## Requirements

- Node.js 22.13 through 22.x; Render's backend runtime is pinned to 22.15.0 by `server/.node-version`.
- npm 10 or later.
- PostgreSQL is optional for local development.

## Install

```powershell
cd server
npm ci
cd ..\client
npm ci
```

## Local development

Open two terminals from the project root.

Terminal 1, backend:

```powershell
cd server
Copy-Item .env.example .env
npm run dev
```

Terminal 2, frontend:

```powershell
cd client
Copy-Item .env.example .env
# For local development, leave VITE_API_BASE_URL unset. Vite proxies /api to port 5000.
npm run dev
```

Open <http://localhost:5173>. The backend listens on `http://localhost:5000`. Confirm service status at `http://localhost:5000/api/health`.

The workspace runs in local development mode without an account. Reports are stored on the backend machine. Do not expose this local workspace directly to the public internet.

## Environment variables

`client/.env.example`:

| Variable | Purpose |
| --- | --- |
| `VITE_API_BASE_URL` | Public API origin for a separately hosted production backend. |
| `VITE_DEV_API_URL` | Optional Vite proxy target; defaults to `http://localhost:5000`. |

`server/.env.example`:

| Variable | Purpose |
| --- | --- |
| `PORT` | HTTP listener port; defaults to 5000 and respects the hosting platform's port. |
| `NODE_ENV` | Use `development` locally; use `production` on the hosted backend to require authenticated workspace access. |
| `CORS_ORIGINS` | Comma-separated exact frontend origins. Defaults to the two local Vite origins. |
| `TRUST_PROXY` | Set `true` only behind a trusted reverse proxy so IP-based rate limits use the forwarded client IP. |
| `COOKIE_SAME_SITE` | Use `Lax` for same-site custom subdomains or `None` for cross-site Vercel/Render hostnames. Production cookies are Secure. |
| `DATABASE_URL` | PostgreSQL connection string. Omit only for local development and tests; production requires PostgreSQL and will not fall back to SQLite. |
| `DATABASE_SSL` | Required with PostgreSQL. Production requires `true` for TLS with certificate verification; `false` is available only for local development or private/internal connections. |
| `SCAN_STORE_PATH` | Optional path to the local SQLite database. Defaults to `server/data/scans.sqlite`. |
| `SQLITE_IMPORT_SOURCE` | Explicit source file path used only by the manual SQLite import command. |
| `SHUTDOWN_TIMEOUT_MS` | Maximum HTTP drain duration before active connections are closed; defaults to 10,000 ms. |

Keep real `.env` files and database credentials out of Git and logs. The `.env.example` files contain placeholders only.

## Persistence

Without `DATABASE_URL`, local development and tests write reports to `server/data/scans.sqlite`. Production startup requires `DATABASE_URL` and will fail clearly instead of opening an ephemeral SQLite database. SQLite persists reports across local restarts. Back up this file if you need to retain local reports. Clear history in Settings to delete all local reports.

To use PostgreSQL, set `DATABASE_URL` and `DATABASE_SSL`, then run:

```powershell
cd server
npm run migrate
npm start
```

The explicit migrations create `users`, `sessions`, and `scans`, and add nullable `scans.owner_id` without assigning pre-existing rows. The repository stores report documents as JSONB with indexed ownership and date fields. Migrations are not run automatically at server startup or deployment.

### Import existing SQLite reports

The manual importer never edits the SQLite source. It reads the source in read-only mode, requires both `SQLITE_IMPORT_SOURCE` and a PostgreSQL `DATABASE_URL`, checks IDs and all report fields, writes in a PostgreSQL transaction, and verifies the resulting IDs and records. It can be safely rerun: exact existing rows are skipped, while a conflicting duplicate ID stops before writing. Use `--dry-run` for a no-write preflight.

Existing unowned local reports remain unowned (`owner_id = NULL`) after import. Hosted authenticated report endpoints intentionally do not expose them to an arbitrary account. Reports that already have an owner are refused by this importer; importing them requires a separately reviewed identity mapping and matching destination user records. Sessions are never migrated. The original SQLite file remains available for local development or rollback.

PowerShell example (configure the PostgreSQL destination in `server/.env` with `DATABASE_SSL=true` for a verified TLS connection, or set the variables in the current shell):

```powershell
cd server
$env:SQLITE_IMPORT_SOURCE = (Resolve-Path .\data\scans.sqlite).Path
npm run import-sqlite -- --dry-run
npm run import-sqlite
```

The Blueprint disables external database access by default. For a one-time import launched from your workstation, temporarily add only that workstation's current public IP as a `/32` entry to the database's external IP allow list in Render (preserve any existing entries). Use the external PostgreSQL URL in the ignored `server/.env`, set `DATABASE_SSL=true`, and remove `sslmode` plus any other TLS query parameters from the URL. Remove the temporary `/32` entry after the import. Keep database credentials in `.env`; never paste them into the command line or logs.

Run `npm run migrate` against that same destination first so its `scans` table exists. Remove `--dry-run` only after reviewing the preflight result and confirming `DATABASE_URL` points at the intended destination. Do not run the import automatically during deployment. Keep the source database and a backup of the destination until IDs and report counts have been reviewed.

## Tests and builds

```powershell
cd server
npm test

cd ..\client
npm test
npm run lint
npm run build
```

Backend tests use Jest and Supertest; external website requests are mocked. Frontend tests use Vitest, jsdom, and React Testing Library. No automated test depends on a third-party website. Playwright browser tests are not included in this build.

## API endpoints

- `GET /api/health` - liveness and service version, without a database query.
- `GET /api/ready` - database readiness for deployment checks; it returns only generic status and storage mode, never connection details.
- `POST /api/analyze` - submit a URL; validates the target and saves the report to the signed-in account.
- `GET /api/analyze/:scanId` - retrieve a saved scan only when owned by the signed-in account.
- `GET /api/reports` - list only the signed-in account's reports.
- `GET /api/reports/:scanId` - retrieve an owned report; other accounts receive 404.
- `DELETE /api/reports` - delete only the signed-in account's reports; local unauthenticated use requires confirmation.

`GET /api/auth/session`, `POST /api/auth/sign-in`, and `POST /api/auth/sign-out` provide session lifecycle; mutations require a CSRF token. Production analysis and report routes require a valid authenticated session. The health route remains available for deployment checks.

## Security and scope

The scanner permits only HTTP/HTTPS on ports 80 and 443. It rejects local, private, link-local, multicast, reserved, and internal host destinations; resolves and validates all DNS answers; pins each outbound connection to a validated address; and revalidates redirect destinations. Requests are bounded by a 10-second timeout, 1.5 MB HTML cap, and four redirects. robots.txt and sitemap lookups are also bounded and validated, and sitemap fetching is restricted to the scanned page's origin.

The scanner does not forward cookies or authorization headers, retain raw HTML, execute JavaScript, test image destinations, run Lighthouse, or measure Core Web Vitals or field performance. The score is a rule-based summary of a limited set of page checks. A successful HTTP response and a high score do not establish indexability or guarantee rankings.

## Deployment

No deployment was performed or verified as part of this build.

### Vercel frontend

1. Import the repository and set the Vercel **Root Directory** to `client`.
2. Use the Vite framework preset, build command `npm run build`, and output directory `dist`.
3. Set `VITE_API_BASE_URL` to the HTTPS origin of the API before building.
4. `client/vercel.json` rewrites client-side routes to `index.html`.
5. Set the API's `CORS_ORIGINS` to the exact Vercel site origin.

The frontend can be hosted independently. Provision an operator account before exposing the workspace; do not make a local development API publicly reachable as a workaround.

### Render backend

The current production API is `https://page-pulse-lo70.onrender.com` and the Vercel site is `https://page-pulse-orcin.vercel.app`. Set Vercel's `VITE_API_BASE_URL` to the API origin and Render's `CORS_ORIGINS` to the exact Vercel origin. Configure the Render backend with the Neon PostgreSQL `DATABASE_URL`, `DATABASE_SSL=true`, `NODE_ENV=production`, `TRUST_PROXY=true`, and `COOKIE_SAME_SITE=None` for these cross-site default hostnames. `TRUST_PROXY=true` trusts one reverse proxy hop, matching Render's forwarding behavior; do not use `true` in Express as an unrestricted trust setting. The `pg` driver connects directly to Neon and also supports Neon `-pooler` hostnames; the application does not use named prepared statements. Remove `sslmode`, `sslcert`, `sslkey`, and `sslrootcert` query parameters from `DATABASE_URL`, because TLS is configured explicitly and certificate verification stays enabled. Never set the database URL in a frontend variable. Do not provision a second database from the Render Blueprint. Run migrations manually only after a verified connection; they are not part of startup or deployment. Hosted analysis and report operations continue to require a provisioned account session.

To verify the Neon connection and TLS before changing schema, run this in PowerShell from `server` after setting `DATABASE_URL` and `DATABASE_SSL=true` in the ignored `.env` file. This command performs only `SELECT 1`; it does not inspect or change application tables:

```powershell
cd server
node --env-file-if-exists=.env -e "const { Pool } = require('pg'); const { postgresConnectionOptions } = require('./src/repositories/scanRepository'); const { formatStartupFailure } = require('./src/startupDiagnostics'); let pool; (async () => { pool = new Pool({ ...postgresConnectionOptions(process.env.DATABASE_URL), max: 1 }); await pool.query('SELECT 1'); console.log('PostgreSQL connection and verified TLS succeeded.'); })().catch((error) => { console.error(formatStartupFailure(error, 'Connection verification')); process.exitCode = 1; }).finally(async () => { if (pool) await pool.end(); });"
```

After the connection succeeds, run `npm run migrate` explicitly from `server` to apply the idempotent additive migrations. Then deploy the code, provision an operator account with `npm run create-user` in an interactive Render shell, and verify `https://page-pulse-lo70.onrender.com/api/health` reports `storage: postgres` and `https://page-pulse-lo70.onrender.com/api/ready` reports `status: ready`. The readiness route requires the migrated schema. Do not run the SQLite importer.

## Troubleshooting

- **API unavailable in the browser:** start the backend on port 5000 or set `VITE_DEV_API_URL`; inspect `/api/health`.
- **CORS error:** set `CORS_ORIGINS` to the exact scheme and host where the frontend is served, then restart the backend.
- **Hostname or destination rejected:** Page Pulse deliberately blocks local/private/reserved destinations and nonstandard ports.
- **No locally saved reports:** check that the backend process can write to `server/data` or set `SCAN_STORE_PATH` to a writable directory.
- **Hosted workspace asks for sign-in:** provision an account on the backend with `npm run create-user` from `server` using an interactive terminal.
- **Missing page content:** the scanner reads returned HTML only; content rendered later by JavaScript is outside its current scope.
# Authentication and report ownership

Production workspace APIs require an authenticated session. Accounts are closed-registration and must be provisioned by an operator on the backend host; there is no public sign-up endpoint. From `server`, run `npm run create-user` in an interactive terminal and enter the account email and a 12–256 character password (the password is hidden while typed). Passwords are stored as Node.js `scrypt` hashes. Never pass passwords on the command line or place them in frontend environment variables.

Sign-in uses an opaque 256-bit random session cookie. Only its SHA-256 digest is persisted, with a 12-hour expiry. The cookie is HttpOnly and always Secure in production. Set `COOKIE_SAME_SITE=None` for cross-site default Vercel/Render hostnames; browsers that block third-party cookies may still prevent sign-in there. Prefer app and API custom subdomains under the same registrable domain and set `COOKIE_SAME_SITE=Lax` when possible. Mutating browser requests include a session-bound CSRF token and must have an allowlisted Origin. Configure `CORS_ORIGINS` to the exact frontend origins, including scheme and host. Keep `TRUST_PROXY=true` only behind the trusted Render proxy.

`GET /api/auth/session`, `POST /api/auth/sign-in`, and `POST /api/auth/sign-out` provide session lifecycle. Sign-in is limited to five attempts per 15 minutes per client IP. There is intentionally no registration, password-reset, user-management, or cross-user sharing API in this phase.

The additive migration creates `users` and `sessions` and adds a nullable `scans.owner_id`; it does not drop or rewrite scan rows. PostgreSQL startup verifies the migrated schema but never applies migrations. Existing SQLite reports remain unowned and available in the local development workspace only. They are not assigned to the first provisioned account and are excluded from authenticated report lists, detail lookups, and deletes. If those reports must enter a hosted workspace, first establish ownership explicitly with the data owner and perform a separately reviewed migration; SQLite-to-PostgreSQL import keeps them unowned.

Set `NODE_ENV=production`, the Neon `DATABASE_URL`, `DATABASE_SSL=true`, `CORS_ORIGINS`, `COOKIE_SAME_SITE=None`, and `TRUST_PROXY=true` on Render. Set `VITE_API_BASE_URL=https://page-pulse-lo70.onrender.com` in Vercel. Verify the Neon connection, run `npm run migrate` in `server`, deploy the backend, then provision accounts directly on the backend using the interactive command above. Production uses PostgreSQL because instance-local SQLite is not durable across hosted restarts.
