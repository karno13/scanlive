import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Preloaded before application imports in each test process. Never use the
// user's live catalog, log or scan-status files, including with :memory: mocks.
const directory = mkdtempSync(join(tmpdir(), 'bookflip-test-runtime-'));
process.env.BOOKFLIP_CATALOG_DB = join(directory, 'catalog.sqlite');
// Tests must never reach real shops; enrichment has its own tests with injected pages.
process.env.BOOKFLIP_DETAIL_ENRICHMENT ??= '0';
// Background work that reads shops or BN, and first-run profiles that would schedule real scans.
process.env.BOOKFLIP_OFFER_LIFECYCLE ??= '0';
process.env.BOOKFLIP_CATALOG_SEEDS ??= '0';
process.env.BOOKFLIP_STARTER_PROFILES ??= '0';
process.env.BOOKFLIP_AUTO_BACKUP ??= '0';
// Scheduled scans read real shops; a run on a copy of the owner's data must not start one.
process.env.BOOKFLIP_SCHEDULED_SCANS ??= '0';
process.once('exit', () => {
  rmSync(directory, { recursive: true, force: true, maxRetries: 3 });
});
