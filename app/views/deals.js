// "Okazje": offers that can be bought now for clearly less than their edition is worth
// (deals.mjs on the server). The list is read on every visit; filter and order are applied here.
// Each deal can be rated ("was it real?"); rated deals are hidden unless asked for, so the list
// shows what is still to check, and the summary says how often the list was right.
import { coverMarkup, tidyOfferTitle } from '../core/bibliography.js';
import { dateMarkup, safeOfferHref } from '../core/formatters.js';
import { plural, zl } from '../core/valuation.js';

const CONDITION_LABELS = { new: 'nowa', very_good: 'bardzo dobra', good: 'dobra', satisfactory: 'zadowalająca', unknown: 'stan nieznany' };
const SORTS = {
  saving: (a, b) => b.saving - a.saving,
  discount: (a, b) => b.discount - a.discount || b.saving - a.saving,
  newest: (a, b) => String(b.firstSeenAt || '').localeCompare(String(a.firstSeenAt || '')),
  price: (a, b) => a.price - b.price,
  demand: (a, b) => (b.demand?.median ?? -1) - (a.demand?.median ?? -1) || b.saving - a.saving,
};
const DEMAND_LABELS = { high: 'wysoki', medium: 'średni', low: 'niski' };

/** "♥ 12 · popyt wysoki (mediana 9 polubień w 5 ofertach Vinted)"; empty without data. */
export function demandLabel(item) {
  const own = item.favourites == null ? '' : `♥ ${item.favourites}`;
  const demand = item.demand
    ? `popyt ${DEMAND_LABELS[item.demand.level] || item.demand.level} (mediana ${item.demand.median} ${plural(item.demand.median, 'polubienie', 'polubienia', 'polubień')} w ${item.demand.offers} ${plural(item.demand.offers, 'ofercie', 'ofertach', 'ofertach')} Vinted)`
    : '';
  return [own, demand].filter(Boolean).join(' · ');
}
export const VERDICT_LABELS = { good: 'Trafna', wrong_match: 'Złe przypisanie', condition: 'Inny stan / zestaw', overvalued: 'Wycena zawyżona' };
const VERDICT_HINTS = {
  good: 'Naprawdę wyraźnie tańsza, niż jest warta — nadaje się do odsprzedaży',
  wrong_match: 'Oferta przypisana do innej książki albo innego wydania',
  condition: 'Egzemplarz w gorszym stanie niż przyjęty, zestaw, brak tomu itp.',
  overvalued: 'Przypisanie dobre, ale książka nie jest tyle warta',
};
const LEVELS = { high: 'wysokiej', medium: 'średniej', low: 'niskiej' };

/**
 * The deals to show: without low-confidence valuations and without rated ones unless asked,
 * in the chosen order. `keep`: offers rated during this visit stay visible, with their undo.
 */
export function visibleDeals(items, { includeLow = false, showRated = false, sort = 'saving', keep = new Set() } = {}) {
  return items
    .filter((item) => keep.has(item.offerId) || ((includeLow || item.confidence !== 'low') && (showRated || !item.verdict)))
    .sort(SORTS[sort] || SORTS.saving);
}

/** "12 okazji · 94 ukryte (niska wiarygodność wyceny) · 5 ocenionych ukrytych". */
export function dealsCountLabel(items, shown) {
  const visible = new Set(shown.map((item) => item.offerId));
  const hidden = items.filter((item) => !visible.has(item.offerId));
  const rated = hidden.filter((item) => item.verdict).length;
  const low = hidden.length - rated;
  return `${shown.length} ${plural(shown.length, 'okazja', 'okazje', 'okazji')}${low ? ` · ${low} ${plural(low, 'ukryta', 'ukryte', 'ukrytych')} (niska wiarygodność wyceny)` : ''}${rated ? ` · ${rated} ${plural(rated, 'oceniona ukryta', 'ocenione ukryte', 'ocenionych ukrytych')}` : ''}`;
}

/** "Ocenione: 12 — trafna 7 (58%) · złe przypisanie 3 … Przy wiarygodności średniej trafne 4 z 6." */
export function verdictSummaryLabel(summary) {
  if (!summary?.total) return 'Ocenione: 0. Oceń kilka okazji przyciskami przy ofercie — wtedy będzie widać, jak często lista ma rację.';
  const { total, counts = {}, byConfidence = {} } = summary;
  const parts = Object.keys(VERDICT_LABELS)
    .filter((key) => counts[key])
    .map((key) => `${VERDICT_LABELS[key].toLowerCase()} ${counts[key]}${key === 'good' ? ` (${Math.round((100 * counts[key]) / total)}%)` : ''}`);
  const perLevel = Object.entries(LEVELS)
    .filter(([key]) => byConfidence[key]?.total)
    .map(([key, label]) => `przy wiarygodności ${label} trafne ${byConfidence[key].good} z ${byConfidence[key].total}`);
  const levels = perLevel.join('; ');
  return `Ocenione: ${total} — ${parts.join(' · ')}${levels ? `. ${levels[0].toUpperCase()}${levels.slice(1)}` : ''}.`;
}

function verdictMarkup(item, escapeHtml) {
  if (item.verdict)
    return `<div class="deal-verdict is-rated"><small>Ocena: <b>${escapeHtml(VERDICT_LABELS[item.verdict] || item.verdict)}</b></small><button type="button" class="link-button" data-deal-unrate="${escapeHtml(item.offerId)}">Cofnij</button></div>`;
  return `<div class="deal-verdict" role="group" aria-label="Oceń okazję"><small>Oceń:</small>${Object.entries(VERDICT_LABELS)
    .map(([key, label]) => `<button type="button" class="deal-verdict-chip" data-deal-rate="${escapeHtml(item.offerId)}" data-verdict="${key}" title="${escapeHtml(VERDICT_HINTS[key])}">${escapeHtml(label)}</button>`)
    .join('')}</div>`;
}

const loose = (value) => String(value || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9ł]+/g, ' ').trim();

/** The book link repeats nothing: the book's title when the listing names it otherwise, else a plain "strona książki". */
function workLinkMarkup(item, escapeHtml) {
  const same = loose(item.workTitle) && loose(item.title).includes(loose(item.workTitle));
  return `<small>↳ <button type="button" class="link-button" data-deal-work="${escapeHtml(item.workId)}" title="Strona książki: ${escapeHtml(item.workTitle)}">${same ? 'strona książki' : escapeHtml(item.workTitle)}</button></small>`;
}

export function dealMarkup(item, { escapeHtml, money, now = new Date() }) {
  const demand = demandLabel(item);
  const basis = [item.sold ? `${item.sold} ${plural(item.sold, 'sprzedaż', 'sprzedaże', 'sprzedaży')}` : '', item.live ? `${item.live} ${plural(item.live, 'oferta', 'oferty', 'ofert')}` : ''].filter(Boolean).join(', ');
  return `<article class="deal-row${item.suspicious ? ' is-suspicious' : ''}" data-deal-offer="${escapeHtml(item.offerId)}">${coverMarkup(item.image, item.title, { size: 'sm', escapeHtml })}<div class="deal-copy"><button type="button" class="link-button deal-title" data-deal-open="${escapeHtml(item.offerId)}" title="${escapeHtml(item.title)}">${escapeHtml(tidyOfferTitle(item.title))}</button><small>${escapeHtml(item.source)} · ${escapeHtml(CONDITION_LABELS[item.condition] || item.condition)} · wykryta ${dateMarkup(item.firstSeenAt, now)}${demand ? ` · <span class="deal-demand${item.demand ? ` is-${escapeHtml(item.demand.level)}` : ''}" title="Polubienia tej oferty i mediana polubień pozostałych ofert tego wydania na Vinted — im więcej, tym częściej oferty schodzą">${escapeHtml(demand)}</span>` : ''} · <a href="${escapeHtml(safeOfferHref(item.url))}" target="_blank" rel="noopener noreferrer">ogłoszenie ↗</a></small>${workLinkMarkup(item, escapeHtml)}${item.suspicious ? '<small class="deal-warning">Bardzo daleko od wyceny — sprawdź, czy oferta jest przypisana do właściwej książki i czy to jeden egzemplarz.</small>' : ''}${verdictMarkup(item, escapeHtml)}</div><div class="deal-numbers" title="${escapeHtml((item.reasons || []).join(' '))}"><strong class="deal-saving">−${zl(item.saving)}</strong><span class="deal-price">−${item.discount}% · za <b>${money(item.price)}</b></span><span>warta ~${zl(item.worth)} <small>(${Math.round(item.worthLow / 100)}–${zl(item.worthHigh)})</small></span><small><span class="value-confidence is-${escapeHtml(item.confidence)}">wiarygodność ${escapeHtml(item.confidenceLabel)}</span> ${escapeHtml(basis)}</small></div></article>`;
}

export function installDeals({ $, json, escapeHtml, money, openOfferDrawer, openWork }) {
  const list = $('#dealsList');
  if (!list) return { refresh: async () => {} };
  let items = [];
  let summary = null;
  const keep = new Set();
  function render() {
    const shown = visibleDeals(items, { includeLow: $('#dealsIncludeLow').checked, showRated: $('#dealsShowRated').checked, sort: $('#dealsSort').value, keep });
    $('#dealsCount').textContent = dealsCountLabel(items, shown);
    $('#dealsVerdicts').textContent = verdictSummaryLabel(summary);
    const nav = $('#dealsNavCount');
    if (nav) nav.textContent = dealsCountLabel(items, visibleDeals(items)).split(' · ')[0];
    list.innerHTML = shown.length
      ? shown.map((item) => dealMarkup(item, { escapeHtml, money })).join('')
      : `<p class="inline-note">${items.length ? 'Pozostałe okazje są ukryte (niska wiarygodność wyceny albo już ocenione) — zaznacz pole powyżej, aby je zobaczyć.' : 'Brak okazji: żadna dostępna oferta nie jest wyraźnie poniżej wyceny swojego wydania. Wycena potrzebuje co najmniej dwóch innych cen tego samego wydania.'}</p>`;
    list.querySelectorAll('[data-deal-open]').forEach((button) => button.addEventListener('click', () => openOfferDrawer(button.dataset.dealOpen)));
    list.querySelectorAll('[data-deal-work]').forEach((button) => button.addEventListener('click', () => openWork(button.dataset.dealWork)));
    list.querySelectorAll('[data-deal-rate]').forEach((button) => button.addEventListener('click', () => rate(button.dataset.dealRate, button.dataset.verdict)));
    list.querySelectorAll('[data-deal-unrate]').forEach((button) => button.addEventListener('click', () => rate(button.dataset.dealUnrate, null)));
  }
  async function rate(offerId, verdict) {
    const url = `/api/deals/${encodeURIComponent(offerId)}/verdict`;
    // Every write, DELETE too, must be JSON: the server refuses other writes (tailscale-access.mjs).
    const headers = { 'content-type': 'application/json' };
    try {
      const result = verdict
        ? await json(url, { method: 'PUT', headers, body: JSON.stringify({ verdict }) })
        : await json(url, { method: 'DELETE', headers });
      summary = result.verdicts;
      const item = items.find((entry) => entry.offerId === offerId);
      if (item) item.verdict = result.verdict;
      keep.add(offerId);
    } catch {
      $('#dealsVerdicts').textContent = 'Nie udało się zapisać oceny.';
      return;
    }
    render();
  }
  $('#dealsIncludeLow').addEventListener('change', render);
  $('#dealsShowRated').addEventListener('change', render);
  $('#dealsSort').addEventListener('change', render);
  async function refresh() {
    try {
      ({ items, verdicts: summary = null } = await json('/api/deals'));
      keep.clear();
    } catch {
      list.innerHTML = '<p class="inline-note">Nie udało się odczytać okazji.</p>';
      return;
    }
    render();
  }
  return { refresh };
}
