# BookFlip — notes for coding agents

Local Windows app: Node (no framework, no bundler) + `node:sqlite` + vanilla ES-module frontend.
UI text, docs and changelog are **Polish**; code comments and commit messages are English.
Current focus: scanner, catalogue, verification (trading features are parked) — see `docs/PRODUCT-DIRECTION.md`.

## Commands

- `npm test` — all tests (isolated temp data dir, never the user's DB). One file: `npm test -- rejected-offers.test.mjs`.
- `npm run lint` · `npm run check:syntax` · `npm run typecheck` (JSDoc types of the offer path and the repository, files with `// @ts-check`) · `npm run format:check` (needs `npm install` once; do not commit a `package-lock.json`).
- UI smoke: `node scripts/browser-smoke.mjs` (needs `npm install --no-save --no-package-lock playwright@1.55.1` and `npx playwright install chromium`).
- Shell: Git Bash / PowerShell on Windows; **no Python** — write helper scripts in Node.

## Where things are

Full table: `docs/REPOSITORY-MAP.md`. The short version:

- `local-app.mjs` — HTTP server: route table `localRoutes` in `createLocalAppServer` (`router.mjs`: `.add(method, '/api/x/:id', handler)`, first match wins, params already decoded), background jobs (`schedule*` functions run after each identification pass). Smaller routes live in the `tradingRoutes` table of `trading-api.mjs`; requests whose path that table knows are forwarded to it automatically.
- `catalog-api.mjs` — read models for lists (works, offers, offer groups, review queue, buckets).
- `catalog-production.mjs` — opens the DB and runs `startup-jobs.mjs`: data repairs are **one-time jobs** with a flag in `app_preferences` (`runOnce`, versioned key when rules can change); only in-memory loads and series aliases run every start. Scanned offers enter through `offer-ingest.mjs` (`ScannedOffer`, one shape).
- `catalog-resolver.mjs` + `identification-worker.mjs` — ISBN → edition; `metadata-sources/*` adapters.
- `marketplaces.mjs` — source adapters and `readSourceHtml`; every marketplace request goes through `marketplace-gate.mjs` (per-source adaptive pacing). Never add a request path that bypasses it.
- Frontend: `app/index.html`, `app/app.js` (shell, tabs, wiring), `app/views/<area>.js`, `app/core/*` (api, formatters, prefs). `app/app.css` is large and layered: later rules override earlier ones — append, and check the end of the file before adding a selector.

## Rules

- **Migrations are immutable** (`migrations/NNN_*.sql`, checksums stored in user DBs). New schema = next number (currently 130 is the last).
- Automatic decisions must be reversible and visible in „Ostatnie decyzje” (write a `review_decisions` row with a `created_by` marker); manual assignments and sets always win over automation.
- Never touch the user's DB (`%LOCALAPPDATA%\BookFlip\data`). To measure on real data, copy it: `node scripts/backup-catalog.mjs <scratch>/copy.sqlite`.
- Trading UI is hidden unless `body.trading-mode` (localStorage `bookflip.tradingMode=1`).
- Every user-visible change gets a numbered entry at the top of `CHANGELOG.md` (Polish, „**Błąd:**” for fixes, real numbers from the user's data when available); update README/REPOSITORY-MAP when adding modules, migrations or env vars (`PRODUCTION-CATALOG.md` lists env vars). `documentation-current.test.mjs` checks a few doc phrases.
