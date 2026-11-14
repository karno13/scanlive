// Process-wide pieces shared by the server, the scan and the background jobs: the open catalogue,
// the buyback service, the event log, scan status files, the history write lock and the HTTP
// response helpers.
import { defaultCatalogPath } from './catalog-data-location.mjs';
import { randomUUID } from 'node:crypto';
import { readFile, appendFile, writeFile, mkdir, rename, stat, rm } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { createProductionCatalog, productionCatalogEnabled } from './catalog-production.mjs';
import { analyzedOffers, allBookStatistics } from './price-analysis.mjs';
import { sqliteHistoryModel } from './sqlite-history-read.mjs';
import { createBuybackService } from './buyback-quotes.mjs';
import { createSkupksiazekClient } from './buyback-skupksiazek.mjs';

export let buyback = null;
// One buyback service per process: the catalogue's quote cache plus the automatic background check.
export function getBuyback() {
  const catalog = getProductionCatalog();
  if (!catalog) return null;
  buyback ||= createBuybackService(catalog.repository, createSkupksiazekClient());
  return buyback;
}
export async function readJson(request) {
  let size = 0;
  const chunks = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 32768) throw Object.assign(Error('REQUEST_TOO_LARGE'), { statusCode: 413 });
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
  } catch {
    throw Object.assign(Error('INVALID_JSON'), { statusCode: 400 });
  }
}
export const securityHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https://covers.openlibrary.org; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
};
export function send(response, status, body, type = 'application/json; charset=utf-8') {
  response.writeHead(status, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    ...securityHeaders,
  });
  response.end(body);
}
export const runtimeDataDirectory = dirname(defaultCatalogPath());
const logPath = join(runtimeDataDirectory, 'local-app.log');
const scanStatusPath = join(runtimeDataDirectory, 'scan-status.json');
export async function persistScanStatus(status) {
  await mkdir(runtimeDataDirectory, { recursive: true });
  const tempPath = scanStatusPath + '.' + process.pid + '.' + randomUUID() + '.tmp';
  try {
    await writeFile(tempPath, JSON.stringify(status));
    await rename(tempPath, scanStatusPath);
  } finally {
    await rm(tempPath, { force: true });
  }
}
export async function readScanStatus() {
  try {
    const value = JSON.parse(await readFile(scanStatusPath, 'utf8'));
    return value.status === 'running' ? { ...value, status: 'interrupted' } : value;
  } catch (error) {
    if (error.code === 'ENOENT') return { status: 'idle' };
    return { status: 'unknown' };
  }
}
export let productionCatalog = null;
export function getProductionCatalog() {
  if (!productionCatalogEnabled()) return null;
  if (!productionCatalog) productionCatalog = createProductionCatalog();
  return productionCatalog;
}
/** Closes the open catalogue when the server stops; a later request opens it again. */
export function closeProductionCatalog() {
  if (!productionCatalog) return;
  productionCatalog.close();
  productionCatalog = null;
}
// Incremental compatibility bridge: manual JSON operations must not replay the
// entire historical snapshot into a live SQLite catalog.
let logWriteQueue = Promise.resolve();
const maxLogBytes = 5 * 1024 * 1024;
export function recordProgress(event) {
  const safe = { at: new Date().toISOString(), ...event };
  logWriteQueue = logWriteQueue
    .then(async () => {
      await mkdir(runtimeDataDirectory, { recursive: true });
      const bytes = Buffer.byteLength(JSON.stringify(safe) + '\n');
      const size = await stat(logPath)
        .then((file) => file.size)
        .catch((error) => {
          if (error.code === 'ENOENT') return 0;
          throw error;
        });
      if (size + bytes > maxLogBytes) {
        await rm(logPath + '.1', { force: true });
        if (size) await rename(logPath, logPath + '.1');
      }
      await appendFile(logPath, JSON.stringify(safe) + '\n');
    })
    .catch(() => {});
  return safe;
}
export function streamHeaders(response, type = 'application/x-ndjson; charset=utf-8') {
  response.writeHead(200, {
    'Content-Type': type,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy':
      "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data: https://covers.openlibrary.org; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
  });
}
export async function readHistoryForUi({ catalog = getProductionCatalog() } = {}) {
  if (!catalog) throw Error('SQLITE_HISTORY_REQUIRES_CATALOG');
  return sqliteHistoryModel(catalog.repository);
}
function historySnapshot(history) {
  return {
    updatedAt: history.updatedAt,
    lastScan: history.lastScan,
    books: allBookStatistics(history).sort((a, b) =>
      String(b.book.lastSeenAt).localeCompare(String(a.book.lastSeenAt)),
    ),
    offers: analyzedOffers(history).sort((a, b) =>
      String(b.lastSeenAt).localeCompare(String(a.lastSeenAt)),
    ),
  };
}

// Keep the legacy full-snapshot response without loading every historical
// price observation. SQL reduces history to one minimum per offer first.
export function catalogHistorySnapshot(repository) {
  const history = sqliteHistoryModel(repository, { includePriceHistory: false });
  const snapshot = historySnapshot(history);
  const books = new Map(snapshot.books.map((row) => [row.book.id, row]));
  for (const point of repository.database
    .prepare('SELECT offer_id, min(price) AS price FROM offer_price_history GROUP BY offer_id')
    .all()) {
    const book = books.get(history.offers[point.offer_id]?.bookId);
    if (book)
      book.historicalMinimum =
        book.historicalMinimum === null
          ? point.price
          : Math.min(book.historicalMinimum, point.price);
  }
  return snapshot;
}
let historyWriteTail = Promise.resolve();
export async function withHistoryWriteLock(work) {
  let release;
  const previous = historyWriteTail;
  historyWriteTail = new Promise((resolve) => {
    release = resolve;
  });
  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}
