# BookFlip — working brief for coding agents

Everything needed to start a task without re-asking. Read this, then the one file the task touches.
UI text, docs and changelog are **Polish**; code, comments and commit messages are English.

## Settled — do not re-ask or re-propose

- **What it is:** a local Windows app for one person (the owner). Node (no framework, no bundler, no runtime dependencies) + `node:sqlite` + vanilla ES-module frontend, opened at `http://127.0.0.1:4317`. Not a service: no multi-user, hosting, accounts or cloud.
- **Purpose:** find used books for resale as a personal side income. Resale channel is Vinted, so Vinted prices are the reference; Polish editions only by default. Niche vs. broad market is still open — measure with data, do not assume.
- **Current focus (since 2026-11-07):** scanner, catalogue, verification. Trading features (profit, costs, ledger, alerts) are parked and hidden behind `body.trading-mode` (localStorage `bookflip.tradingMode=1`). Exception since 2026-11-15, asked for by the owner: the „Okazje” tab (`deals.mjs`) lists buyable offers clearly below the market valuation of their edition — a price-against-valuation comparison only, no costs or profit. No collector features, ever (`docs/PRODUCT-DIRECTION.md`).
- **Sources:** Allegro, OLX and Dedalus (since 2026-11-17) have no legal access (`docs/SOURCES-ACCESS-2026-11.md`) — they are not scanned and that is not a bug. Never work around CAPTCHA or blocks; every marketplace request goes through `marketplace-gate.mjs`.
- **Maintenance goal:** future work must stay simple and cheap — small files per area, a fast `verify`, behaviour tests, no new dependencies or tooling without a clear saving.
- **Git:** remote `origin` = GitHub `karno13/scanlive`; push the working branch only when the owner asks. Workflows run only on push to `main`, on pull requests or by hand — a push of the working branch starts nothing; `npm run verify` is the check. The `remotes/gh/*` refs are the only copy of the history before 2026-11-07 — never prune or delete them. No configured git identity: commit with `-c user.name=… -c user.email=…` taken from `git log -1 --format='%an %ae'`.

## How to work

- Work autonomously: choose sensible defaults, implement, verify, report at the end. Do not stop for confirmation between steps of an agreed task.
- Ask first only before: deleting or overwriting the owner's data, touching the live database, anything outside this repository, removing a feature.
- Stay on the current branch; commit each finished, verified step (short English message).
- Done means: `npm run verify` passes, the change has a `CHANGELOG.md` entry if the owner can see it, and the docs listed under “Keep in sync” are updated.
- Report in Polish, with real numbers and what was not checked.

## Commands

- **`npm run verify`** (~35 s): lint, typecheck, `format:check`, tests — stops at the first failure. `npm install` once; never commit a `package-lock.json`.
- `npm test` — all tests on an isolated temp data dir (never the owner's DB). One file: `npm test -- test/rejected-offers.test.mjs`.
- `npm run lint` (`no-undef`; globals listed by hand in `eslint.config.mjs`) · `npm run typecheck` (files starting with `// @ts-check`, each listed in `tsconfig.typecheck.json` — a test enforces it) · `npm run format` (Prettier; `app/**/*.js` and HTML are not formatted because tests read their text).
- Run the app for a check without the owner's data: `node --import ./scripts/isolated-runtime.mjs local-app.mjs --no-open` with `BOOKFLIP_LOCAL_PORT` other than 4317 (empty database). On real data, work on a copy: `node scripts/backup-catalog.mjs <tmp>/copy.sqlite`, then `BOOKFLIP_CATALOG_DB=<tmp>/copy.sqlite`; delete the copy afterwards.
- UI smoke: `node scripts/browser-smoke.mjs` (once: `npm install --no-save --no-package-lock playwright@1.55.1` and `npx playwright install chromium`).
- CSS: `node scripts/css-snapshot.mjs <port> <dir> --verify` compares computed styles of every view and state for HEAD against the working tree (command in the script header; full run ~1.5 h — use `--only <regex>` for the area you changed).
- Shell: Git Bash / PowerShell on Windows; **no Python** — helper scripts in Node. Put text with backticks or `$` into a file, not into a shell-quoted `node -e`.

## Where things are

One line per file: `docs/REPOSITORY-MAP.md`. Database: `docs/SCHEMA.sql` (generated; read it instead of the migrations). Env vars: the table in `PRODUCTION-CATALOG.md`.

- `local-app.mjs` — HTTP server: dispatcher, static files, process start, and the routes that need the running scan's state (`/api/search`, `/api/today`, `/api/events`).
- `routes/<area>-routes.mjs` (image, review, catalog, offer, source) — the other routes; `api-routes.mjs` — one-line JSON routes whose handler returns the result.
- `scan-engine.mjs` — the scan (`searchOffers`, `searchAndStore`); `marketplaces.mjs` — source adapters and `readSourceHtml`; `local-scan.mjs` — the list of sources (`localSourceHosts`).
- `offer-ingest.mjs` — the only way scanned offers are saved (`ScannedOffer`, one shape); `sqlite-single-store.mjs` — the scan write.
- `catalog-resolver.mjs` + `identification-worker.mjs` — ISBN → edition; `metadata-sources/*` — BN, Open Library, e-ISBN, Google Books adapters.
- `background-jobs.mjs` — `schedule*` jobs after each identification pass; `startup-jobs.mjs` — data repairs at start.
- `catalog-api.mjs` — read models for lists (works, offers, groups); `review-queue.mjs` — review queue (jobs, buckets, sure plan, decisions); `sqlite-catalog-repository.mjs` — writes.
- `app-runtime.mjs` — the open catalogue (`getProductionCatalog`), `send` / `readJson`, event log, history write lock.
- Frontend: `app/index.html`, `app/app.js` (shell, tabs, wiring), `app/views/<area>.js`, `app/core/*`, `app/styles/*.css`.
- Tests: `test/` (server), next to the module in `app/` (frontend units), `scripts/*.test.mjs`.

## Recipes

- **API route.** Result is plain JSON from the repository → one line in `apiRoutes` (`api-routes.mjs`): `.add('GET', '/api/x/:id', ({ repo, input, params }) => fn(repo, params.id))`; throw `Object.assign(Error('CODE'), { statusCode: 400 })` for errors. Needs the request, a status other than 200 or a stream → `routes/<area>-routes.mjs`: `.add(method, path, async ({ catalog, request, response, url, params }) => …)`; naming `catalog` gives the open catalogue or ends the request with 503. No two routes may match the same request (the order of tables is not a tie-breaker). Test over HTTP with `createLocalAppServer({ catalogProvider })`.
- **Schema change.** New file `migrations/NNN_name.sql` with the next number (last: 137); existing migrations are immutable (checksums are stored in user databases). Then `node scripts/dump-schema.mjs`. Data fix for existing rows → a one-time job in `startup-jobs.mjs` via `runOnce(repository, 'key_v1', job)`; bump the key's version when the rule changes.
- **Background job.** A `schedule*` function in `background-jobs.mjs` (one run at a time, own pacing, pause a source that blocked it), called from `scheduleCatalogResolution`; an env switch `BOOKFLIP_X=0` in the `PRODUCTION-CATALOG.md` table and, if it reads the network, a default-off line in `scripts/isolated-runtime.mjs`.
- **Automatic decision.** Must be reversible and visible in „Ostatnie decyzje”: write a `review_decisions` row with a `created_by` marker; never change manual assignments or sets; an undone decision is not repeated.
- **Source.** Host in `localSourceHosts` (`local-scan.mjs`), search URL and parser in `marketplaces.mjs`, a captured page in `fixtures/marketplaces/` with a test; requests only through `readSourceHtml` (the gate). Detail-page facts: `source-details.mjs`. A shop read by category (no search) is one entry in `ANTIQUARIAN_SOURCES` (`antiquarian-sources.mjs`): category paths, page URL / page number, card marker, parser; the scan reads it once and matches phrases afterwards.
- **Metadata source.** Adapter in `metadata-sources/` returning the shape of `metadata-record.mjs`, wired in `catalog-production.mjs`; BN stays first, others are asked only after BN's `not_found`.
- **View or UI change.** Markup in `app/index.html`, logic in `app/views/<area>.js`, wiring in `app/app.js`, requests through `app/core/api.js`, HTML through `escapeHtml` (`app/core/formatters.js`). Styles: edit the existing rule of the selector in its area file (`app/styles/`, cascade order = link order in `index.html`; one rule per selector and context; colours only as tokens from `tokens.css`); a rule that must come after a later file sits there under a `/* Z obszaru „…” … */` note. Then `browser-smoke` and, for CSS, `css-snapshot --only`.
- **New module.** In the root next to its area's files (routes in `routes/`), a row in `docs/REPOSITORY-MAP.md`, `// @ts-check` on the first line plus an entry in `tsconfig.typecheck.json` when it type-checks cleanly, a test in `test/`.
- **Test.** Behaviour, not source text: call the function or the HTTP route on `new SqliteCatalogRepository(':memory:')` / `createProductionCatalog({ databasePath: ':memory:' })`. No network: inject `fetcher` / `search`.

## Rules

- Never touch the owner's database or `%LOCALAPPDATA%\BookFlip\data`.
- Manual assignments and sets always win over automation.
- ISBN evidence only — no assignment from title similarity alone; a title proposal only fills the ISBN field.
- Offer prices are integer grosze (`offers.current_price`, `offer_price_history.price`); a price of 10 000 zł or more is treated as unknown. Trading and buyback amounts are złoty.
- No request path that bypasses `marketplace-gate.mjs`; provider rate limits stay.

## Keep in sync

| Change                       | Update                                                                                                               |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Anything the owner can see   | Numbered entry at the top of `CHANGELOG.md` (Polish, a few lines, „**Błąd:**” for fixes, real numbers when measured) |
| New, renamed or removed file | `docs/REPOSITORY-MAP.md`                                                                                             |
| Migration                    | `node scripts/dump-schema.mjs`; the “last: NNN” number above                                                         |
| Env var                      | Table „Konfiguracja” in `PRODUCTION-CATALOG.md` (the only list)                                                      |
| How to run, back up, restore | `README.md`                                                                                                          |
| A settled decision changed   | The first section of this file and `docs/PRODUCT-DIRECTION.md`                                                       |

Other docs: `docs/DATA-MIGRATION.md` (updating, migrations, legacy tools), `docs/TAILSCALE.md` (phone access). `docs/archive/` is history — never a source of current rules. `test/documentation-current.test.mjs` pins a few phrases of README, `PRODUCTION-CATALOG.md` and `DATA-MIGRATION.md`.

## Open items (known, not decided)

- 24 test files still read the source text of `app/` files; replacing them needs a DOM harness.
- 45 backend modules (root, `routes/`, `metadata-sources/`) have no `// @ts-check` yet (mostly default-parameter typing).
- Root modules could move to `src/`; it would change the start command in the `.cmd` launchers.
