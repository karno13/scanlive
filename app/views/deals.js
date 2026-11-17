// "Okazje": offers that can be bought now for clearly less than their edition is worth
// (deals.mjs on the server). The list is read on every visit; filter and order are applied here.
import { coverMarkup, tidyOfferTitle } from '../core/bibliography.js';
import { dateMarkup, safeOfferHref } from '../core/formatters.js';
import { plural, zl } from '../core/valuation.js';

const CONDITION_LABELS = { new: 'nowa', very_good: 'bardzo dobra', good: 'dobra', satisfactory: 'zadowalająca', unknown: 'stan nieznany' };
const SORTS = {
  saving: (a, b) => b.saving - a.saving,
  discount: (a, b) => b.discount - a.discount || b.saving - a.saving,
  newest: (a, b) => String(b.firstSeenAt || '').localeCompare(String(a.firstSeenAt || '')),
  price: (a, b) => a.price - b.price,
};

/** The deals to show: without low-confidence valuations unless asked, in the chosen order. */
export function visibleDeals(items, { includeLow = false, sort = 'saving' } = {}) {
  return items.filter((item) => includeLow || item.confidence !== 'low').sort(SORTS[sort] || SORTS.saving);
}

/** "12 okazji · 94 ukryte (niska wiarygodność wyceny)". */
export function dealsCountLabel(items, shown) {
  const hidden = items.length - shown.length;
  return `${shown.length} ${plural(shown.length, 'okazja', 'okazje', 'okazji')}${hidden ? ` · ${hidden} ${plural(hidden, 'ukryta', 'ukryte', 'ukrytych')} (niska wiarygodność wyceny)` : ''}`;
}

export function dealMarkup(item, { escapeHtml, money, now = new Date() }) {
  const basis = [item.sold ? `${item.sold} ${plural(item.sold, 'sprzedaż', 'sprzedaże', 'sprzedaży')}` : '', item.live ? `${item.live} ${plural(item.live, 'oferta', 'oferty', 'ofert')}` : ''].filter(Boolean).join(', ');
  return `<article class="deal-row${item.suspicious ? ' is-suspicious' : ''}" data-deal-offer="${escapeHtml(item.offerId)}">${coverMarkup(item.image, item.title, { size: 'sm', escapeHtml })}<div class="deal-copy"><button type="button" class="link-button deal-title" data-deal-open="${escapeHtml(item.offerId)}" title="${escapeHtml(item.title)}">${escapeHtml(tidyOfferTitle(item.title))}</button><small>${escapeHtml(item.source)} · ${escapeHtml(CONDITION_LABELS[item.condition] || item.condition)} · wykryta ${dateMarkup(item.firstSeenAt, now)} · <a href="${escapeHtml(safeOfferHref(item.url))}" target="_blank" rel="noopener noreferrer">ogłoszenie ↗</a></small><small>↳ <button type="button" class="link-button" data-deal-work="${escapeHtml(item.workId)}" title="Strona książki">${escapeHtml(item.workTitle)}</button></small>${item.suspicious ? '<small class="deal-warning">Bardzo daleko od wyceny — sprawdź, czy oferta jest przypisana do właściwej książki i czy to jeden egzemplarz.</small>' : ''}</div><div class="deal-numbers" title="${escapeHtml((item.reasons || []).join(' '))}"><b>${money(item.price)}</b><span>warta ~${zl(item.worth)} <small>(${Math.round(item.worthLow / 100)}–${zl(item.worthHigh)})</small></span><strong class="deal-saving">−${zl(item.saving)} · −${item.discount}%</strong><small><span class="value-confidence is-${escapeHtml(item.confidence)}">wiarygodność ${escapeHtml(item.confidenceLabel)}</span> ${escapeHtml(basis)}</small></div></article>`;
}

export function installDeals({ $, json, escapeHtml, money, openOfferDrawer, openWork }) {
  const list = $('#dealsList');
  if (!list) return { refresh: async () => {} };
  let items = [];
  function render() {
    const shown = visibleDeals(items, { includeLow: $('#dealsIncludeLow').checked, sort: $('#dealsSort').value });
    $('#dealsCount').textContent = dealsCountLabel(items, shown);
    const nav = $('#dealsNavCount');
    if (nav) nav.textContent = dealsCountLabel(items, visibleDeals(items)).split(' · ')[0];
    list.innerHTML = shown.length
      ? shown.map((item) => dealMarkup(item, { escapeHtml, money })).join('')
      : `<p class="inline-note">${items.length ? 'Są tylko okazje z wyceną o niskiej wiarygodności — zaznacz pole powyżej, aby je zobaczyć.' : 'Brak okazji: żadna dostępna oferta nie jest wyraźnie poniżej wyceny swojego wydania. Wycena potrzebuje co najmniej dwóch innych cen tego samego wydania.'}</p>`;
    list.querySelectorAll('[data-deal-open]').forEach((button) => button.addEventListener('click', () => openOfferDrawer(button.dataset.dealOpen)));
    list.querySelectorAll('[data-deal-work]').forEach((button) => button.addEventListener('click', () => openWork(button.dataset.dealWork)));
  }
  $('#dealsIncludeLow').addEventListener('change', render);
  $('#dealsSort').addEventListener('change', render);
  async function refresh() {
    try {
      ({ items } = await json('/api/deals'));
    } catch {
      list.innerHTML = '<p class="inline-note">Nie udało się odczytać okazji.</p>';
      return;
    }
    render();
  }
  return { refresh };
}
