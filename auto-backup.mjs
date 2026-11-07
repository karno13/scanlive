// Daily automatic backup of the catalogue while the app runs: an integrity-checked SQLite copy in
// the "backups" folder, the newest seven kept. BOOKFLIP_BACKUP_DIR adds a second copy elsewhere
// (another disk), with the same rotation. Pre-migration and manual backups are never removed.
import { readdir, rm } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';

import { backupCatalog } from './scripts/backup-catalog.mjs';

export const AUTO_PREFIX = 'auto-';
const DAY_MS = 24 * 3_600_000;

function stamp(date) {
  return date.toISOString().replace(/[:.]/g, '-');
}

async function autoFiles(directory, base) {
  const names = await readdir(directory).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return names.filter((name) => name.startsWith(`${base}-${AUTO_PREFIX}`) && name.endsWith('.sqlite')).sort();
}

function stampOf(name, base) {
  const raw = name.slice(`${base}-${AUTO_PREFIX}`.length, -'.sqlite'.length);
  const iso = raw.replace(/^(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z$/, '$1T$2:$3:$4.$5Z');
  const time = Date.parse(iso);
  return Number.isFinite(time) ? time : 0;
}

async function backupInto(source, directory, { now, keep, minAgeMs }) {
  const base = basename(source, extname(source));
  const existing = await autoFiles(directory, base);
  const newest = existing.length ? stampOf(existing.at(-1), base) : 0;
  if (newest && now.getTime() - newest < minAgeMs) return { created: null, removed: [] };
  const created = await backupCatalog({ source, destination: join(directory, `${base}-${AUTO_PREFIX}${stamp(now)}.sqlite`) });
  const all = await autoFiles(directory, base);
  const removed = all.slice(0, Math.max(0, all.length - keep));
  for (const name of removed) await rm(join(directory, name), { force: true });
  return { created, removed };
}

export async function runAutoBackup(source, { now = new Date(), keep = 7, minAgeMs = 20 * 3_600_000, extraDirectory = process.env.BOOKFLIP_BACKUP_DIR || null } = {}) {
  if (!source || source === ':memory:') return { skipped: true };
  const result = { local: await backupInto(source, join(dirname(source), 'backups'), { now, keep, minAgeMs }) };
  if (extraDirectory) result.extra = await backupInto(source, extraDirectory, { now, keep, minAgeMs });
  return result;
}

/** Checks every few hours; a copy is made when the newest automatic one is older than ~a day. */
export function createAutoBackupScheduler({ getPath, onEvent = () => {}, everyMs = 6 * 3_600_000, setTimer = setInterval, clearTimer = clearInterval }) {
  let timer = null;
  let running = null;
  async function tick() {
    if (running) return running;
    running = (async () => {
      const path = getPath();
      if (!path) return null;
      try {
        const result = await runAutoBackup(path);
        if (result.local?.created || result.extra?.created) onEvent({ type: 'auto_backup', path: result.local?.created ?? null, extra: result.extra?.created ?? null, removed: (result.local?.removed.length ?? 0) + (result.extra?.removed.length ?? 0) });
        return result;
      } catch (error) {
        onEvent({ type: 'auto_backup_error', code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'AUTO_BACKUP_FAILED' });
        return null;
      }
    })();
    try {
      return await running;
    } finally {
      running = null;
    }
  }
  return {
    tick,
    start() {
      void tick();
      if (!timer) timer = setTimer(() => void tick(), everyMs);
      timer?.unref?.();
    },
    stop() {
      if (timer) clearTimer(timer);
      timer = null;
    },
  };
}

export { DAY_MS };
