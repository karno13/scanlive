// The book page's top (owner request 2026-11-15): price tiles, one row of actions, and the offers
// as a short list with links to the listings. The longer material (price chart, variant tables,
// data origin) sits folded below; the edit forms open under the action bar, one at a time.
import { safeOfferHref, availabilityLabel, moneyFromZloty } from '../core/formatters.js';
import { coverMarkup } from '../core/bibliography.js';

const OFFERS_SHOWN = 15;

const plural = (n, one, few, many) =>
  n === 1 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;

/** Best buyback quote among the editions' ISBNs: { price, checkedAt } | { status } | null. */
export function bestBuyback(quotes = {}) {
  const all = Object.values(quotes).filter(Boolean);
  if (!all.length) return null;
  const priced = all.filter((quote) => quote.status === 'priced' && quote.price > 0).sort((a, b) => b.price - a.price);
  return priced[0] || all.sort((a, b) => String(b.checkedAt).localeCompare(String(a.checkedAt)))[0];
}

function tile(label, value, note, tone = '') {
  return `<div class="bp-tile${tone ? ' ' + tone : ''}"><small>${label}</small><strong>${value}</strong><small>${note}</small></div>`;
}

/**
 * Tiles: lowest and (from two offers) median asking price of the offers still on sale, Vinted sold
 * median and wholesale buyback. The number of offers heads the offer list right below. `overview` is /api/catalog/works/:id/prices
 * (grosze), `buyback` the best quote (złoty) or null, `isbns` how many editions can be quoted.
 */
export function bookTilesMarkup(overview, buyback, { money, escapeHtml, isbns = 0, buybackBusy = false }) {
  const overall = overview?.overall || {};
  const sold = overview?.vintedSold || { count: 0 };
  const live = overall.live || 0;
  const dash = '–';
  const buybackValue = buybackBusy
    ? 'sprawdzam…'
    : !buyback
      ? dash
      : buyback.status === 'priced'
        ? moneyFromZloty(buyback.price)
        : buyback.status === 'not_bought'
          ? 'nie skupują'
          : buyback.status === 'manual'
            ? 'wycena ręczna'
            : 'błąd';
  const buybackNote = !isbns
    ? 'brak ISBN-13'
    : buyback?.checkedAt
      ? 'skupksiazek.pl · ' + new Date(buyback.checkedAt).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })
      : 'nie sprawdzono';
  return [
    tile('Najniższa cena', live ? money(overall.min) : dash, live ? 'wśród dostępnych ofert' : 'brak dostępnych ofert', 'is-key'),
    live > 1 ? tile('Mediana ofert', money(overall.median), `${live} ${plural(live, 'oferta', 'oferty', 'ofert')}${live < 3 ? ' · mało danych' : ''}`) : '',
    tile('Sprzedane na Vinted', sold.count ? money(sold.median) : dash, sold.count ? `${sold.count} ${plural(sold.count, 'sprzedaż', 'sprzedaże', 'sprzedaży')}${sold.count > 1 ? ` · ${money(sold.min)}–${money(sold.max)}` : ''}` : 'brak sprzedaży'),
    tile('Cena skupu', escapeHtml(buybackValue), escapeHtml(buybackNote), buyback?.status === 'priced' ? 'is-good' : ''),
  ].join('');
}

const isGone = (item) => ['sold', 'unavailable', 'reserved'].includes(item.availability);

/** One offer: the row opens the offer drawer, the arrow opens the listing in a new tab. */
function offerRowMarkup(item, row, { money, escapeHtml }) {
  const edition = item.match?.editionTitle && item.match.editionTitle !== row.title ? item.match.editionTitle : '';
  const href = safeOfferHref(item.url);
  return `<div class="bp-offer${isGone(item) ? ' is-gone' : ''}"><button type="button" class="bp-offer-open" data-work-offer="${escapeHtml(item.id)}">${coverMarkup(item.image, item.title, { size: 'xs', escapeHtml })}<span><b>${escapeHtml(item.title)}</b><small>${escapeHtml([item.source, edition, availabilityLabel(item)].filter(Boolean).join(' · '))}</small></span><strong>${money(item.currentPrice)}</strong></button>${href && href !== '#' ? `<a class="bp-offer-link" href="${escapeHtml(href)}" target="_blank" rel="noreferrer" title="Otwórz ogłoszenie w nowej karcie">Ogłoszenie ↗</a>` : ''}</div>`;
}

export function bookOffersMarkup(data, row, { money, escapeHtml, showAll = false }) {
  // Offers still on sale first (cheapest first), then sold and withdrawn ones.
  const items = [...(data.items || [])].sort((a, b) => isGone(a) - isGone(b));
  if (!items.length) return '<h4>Oferty</h4><p class="inline-note">Żadna zapisana oferta nie jest przypisana do tej książki.</p>';
  const total = Math.max(data.total || 0, items.length);
  const shown = showAll ? items : items.slice(0, OFFERS_SHOWN);
  const more = items.length - shown.length;
  const note = total > items.length ? `<p class="inline-note">Pokazano ${items.length} najtańszych z ${total}.</p>` : '';
  return `<h4>Oferty · ${total} <small>dostępne od najtańszej, potem sprzedane</small></h4><div class="bp-offer-list">${shown.map((item) => offerRowMarkup(item, row, { money, escapeHtml })).join('')}</div>${more > 0 ? `<button type="button" class="button ghost compact bp-more-offers" data-bp-all-offers>Pokaż więcej (${items.length}${total > items.length ? ` najtańszych z ${total}` : ''})</button>` : note}`;
}

export const BOOK_ACTIONS = [
  ['scan', 'Szukaj w skanerze', 'Wpisz tytuł i autora do skanera'],
  ['buyback', 'Sprawdź skup', 'Sprawdź cenę skupu w skupksiazek.pl dla wydań z ISBN-13'],
  ['edit', 'Popraw dane', 'Tytuł, autorzy, połączenie z duplikatem'],
  ['series', 'Seria i tom', ''],
  ['universe', 'Uniwersum', 'Półka w widoku „Serie”'],
  ['remove', 'Usuń z katalogu', ''],
];

export function bookActionsMarkup(escapeHtml) {
  return BOOK_ACTIONS.map(
    ([key, label, title]) =>
      `<button type="button" class="button ${key === 'scan' ? 'primary' : key === 'remove' ? 'secondary danger-text' : 'secondary'} compact" data-bp-action="${key}"${title ? ` title="${escapeHtml(title)}"` : ''}${['edit', 'series', 'universe'].includes(key) ? ' aria-expanded="false"' : ''}>${escapeHtml(label)}</button>`,
  ).join('');
}

/** Shows one edit pane under the action bar (or hides it when it is already open). */
export function toggleBookPane(detail, key) {
  const panes = detail.querySelectorAll('[data-bp-pane]');
  const target = detail.querySelector(`[data-bp-pane="${key}"]`);
  if (!target) return false;
  const open = target.hidden;
  panes.forEach((pane) => (pane.hidden = true));
  detail.querySelectorAll('[data-bp-action][aria-expanded]').forEach((button) => button.setAttribute('aria-expanded', 'false'));
  if (open) {
    target.hidden = false;
    const fold = target.matches('details') ? target : target.querySelector('details');
    if (fold) fold.open = true;
    detail.querySelector(`[data-bp-action="${key}"]`)?.setAttribute('aria-expanded', 'true');
  }
  return true;
}
