import { json } from '../core/api.js';
import { escapeHtml, sourceHealthNote } from '../core/formatters.js';

// "Since your last visit" strip at the top of the scanner: new listings, decisions waiting and
// sources that stopped working — the three things worth a look before starting a new scan.
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

const plural = (n, one, few, many) => (n === 1 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);

export function installSinceLastVisit({ state, showView }) {
  const scanner = document.querySelector('#view-scanner');
  const heading = scanner?.querySelector('.view-heading');
  if (!heading || document.querySelector('#sinceLastVisit')) return () => {};
  const strip = document.createElement('section');
  strip.id = 'sinceLastVisit';
  strip.className = 'since-visit';
  strip.setAttribute('aria-label', 'Od ostatniej wizyty');
  strip.hidden = true;
  heading.after(strip);
  const since = visitBaseline();

  async function refresh() {
    const [offers, health] = await Promise.all([
      since ? json('/api/offers?' + new URLSearchParams({ since, limit: '1', offset: '0' })).catch(() => null) : null,
      json('/api/source-health').catch(() => ({ items: [] })),
    ]);
    const fresh = Number(offers?.total || 0);
    const pending = Number(state.catalogPages?.jobs?.total || 0);
    const broken = (health.items || []).filter((row) => sourceHealthNote(row, { short: true }) === 'nie działa').map((row) => row.source);
    const parts = [];
    if (since)
      parts.push(
        fresh
          ? `<span><b>${fresh}</b> ${plural(fresh, 'nowa oferta', 'nowe oferty', 'nowych ofert')} od ${escapeHtml(new Date(since).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }))} <button type="button" class="link-button" data-since="offers">Pokaż</button></span>`
          : '<span>Brak nowych ofert od ostatniej wizyty.</span>',
      );
    if (pending) parts.push(`<span><b>${pending}</b> do decyzji <button type="button" class="link-button" data-since="review">Weryfikuj</button></span>`);
    if (broken.length) parts.push(`<span class="since-warn">Nie działa: ${escapeHtml(broken.join(', '))}</span>`);
    strip.hidden = !parts.length;
    strip.innerHTML = parts.join('');
    strip.querySelector('[data-since="review"]')?.addEventListener('click', () => showView('review'));
    strip.querySelector('[data-since="offers"]')?.addEventListener('click', () => {
      const sort = document.querySelector('#offerSort');
      if (sort) {
        sort.value = 'newest';
        sort.dispatchEvent(new Event('change', { bubbles: true }));
      }
      showView('offers');
    });
  }
  return () => void refresh().catch(() => {});
}
