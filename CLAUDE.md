# BookFlip — notes for coding agents

Local Windows app: Node (no framework, no bundler) + `node:sqlite` + vanilla ES-module frontend.
UI text, docs and changelog are **Polish**; code comments and commit messages are English.
Current focus: scanner, catalogue, verification (trading features are parked) — see `docs/PRODUCT-DIRECTION.md`.

## Commands

- **`npm run verify` before finishing work**: lint, `check:syntax`, typecheck, `format:check`, tests — in that order, stops at the first failure (`scripts/verify.mjs`). There is no git remote, so `.github/workflows` never run — this is the check.
- `npm test` — all tests (isolated temp data dir, never the user's DB). One file: `npm test -- rejected-offers.test.mjs`.
- `npm run lint` (incl. `no-undef`; globals listed by hand in `eslint.config.mjs`) · `npm run check:syntax` · `npm run typecheck` (files with `// @ts-check`; each must be listed in `tsconfig.typecheck.json`, a test enforces it) · `npm run format:check` (needs `npm install` once; do not commit a `package-lock.json`).
- CSS changes: `node scripts/css-snapshot.mjs <port> <dir> --verify` compares the computed styles of every view and state (4 widths, both themes, trading on/off) for HEAD against the working tree; server on a copy of the data, other port than 4317 (command in the script header; ~1.5 h, `--only <regex>` for a subset). Zero differences = the look did not change.
- UI smoke: `node scripts/browser-smoke.mjs` (needs `npm install --no-save --no-package-lock playwright@1.55.1` and `npx playwright install chromium`).
- Shell: Git Bash / PowerShell on Windows; **no Python** — write helper scripts in Node.

## Where things are

Full table: `docs/REPOSITORY-MAP.md`. The short version:

- `local-app.mjs` — HTTP server: route table `localRoutes` in `createLocalAppServer` (`router.mjs`: `.add(method, '/api/x/:id', handler)`, first match wins, params already decoded), background jobs (`schedule*` functions run after each identification pass). Smaller routes live in the `tradingRoutes` table of `trading-api.mjs`; requests whose path that table knows are forwarded to it automatically.
- `catalog-api.mjs` — read models for lists (works, offers, offer groups, review queue, buckets).
- `catalog-production.mjs` — opens the DB and runs `startup-jobs.mjs`: data repairs are **one-time jobs** with a flag in `app_preferences` (`runOnce`, versioned key when rules can change); only in-memory loads and series aliases run every start. Scanned offers enter through `offer-ingest.mjs` (`ScannedOffer`, one shape).
- `catalog-resolver.mjs` + `identification-worker.mjs` — ISBN → edition; `metadata-sources/*` adapters.
- `marketplaces.mjs` — source adapters and `readSourceHtml`; every marketplace request goes through `marketplace-gate.mjs` (per-source adaptive pacing). Never add a request path that bypasses it.
- Frontend: `app/index.html`, `app/app.js` (shell, tabs, wiring), `app/views/<area>.js`, `app/core/*` (api, formatters, prefs). Styles: `app/styles/*.css`, linked from `index.html` in a fixed order that is the cascade order (tokens, base, shell, components, then one file per area: today, queue, catalog, offers, sets, sources, settings, trading). Each selector has one rule per context; its `@media` variant follows it where the cascade allows. A rule lives in its area's file unless it must come after a rule of a later file — then it sits there under a `/* Z obszaru „…” … */` note. Edit the existing rule of a selector instead of adding another; colours only as tokens (`styles/tokens.css`).

## Rules

- **Migrations are immutable** (`migrations/NNN_*.sql`, checksums stored in user DBs). New schema = next number (currently 132 is the last).
- Automatic decisions must be reversible and visible in „Ostatnie decyzje” (write a `review_decisions` row with a `created_by` marker); manual assignments and sets always win over automation.
- Never touch the user's DB (`%LOCALAPPDATA%\BookFlip\data`). To measure on real data, copy it: `node scripts/backup-catalog.mjs <scratch>/copy.sqlite`.
- Trading UI is hidden unless `body.trading-mode` (localStorage `bookflip.tradingMode=1`).
- Every user-visible change gets a numbered entry at the top of `CHANGELOG.md` (Polish, „**Błąd:**” for fixes, real numbers from the user's data when available); entries up to 2026-11-09 are in `docs/archive/CHANGELOG-do-2026-11-09.md`. Env vars: only the table in `PRODUCTION-CATALOG.md` („Konfiguracja”). New module → a row in `docs/REPOSITORY-MAP.md`; new migration or env var → that table / map. `documentation-current.test.mjs` checks a few doc phrases.
