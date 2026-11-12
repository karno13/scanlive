// The moment of the previous visit, for the "Dziś" view (app/views/today.js): what changed since then.
const VISIT_KEY = 'bookflip.lastVisitAt';
const BASELINE_KEY = 'bookflip.visitBaseline';

function read(storage, key) {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}
function write(storage, key, value) {
  try {
    storage.setItem(key, value);
  } catch {}
}

/** The previous visit for this browser session; the current one is recorded for next time. */
export function visitBaseline(now = new Date(), local = globalThis.localStorage, session = globalThis.sessionStorage) {
  let baseline = local && session ? read(session, BASELINE_KEY) : null;
  if (!baseline) {
    baseline = (local && read(local, VISIT_KEY)) || null;
    if (session) write(session, BASELINE_KEY, baseline || '');
  }
  if (local) write(local, VISIT_KEY, now.toISOString());
  return baseline || null;
}
