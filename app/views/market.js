// „Okazje” → „Rynek” (market-index.mjs, /api/market/index): every edition with what a used copy
// resells for, the chance a listed copy sells within 30 days, the usual time to a sale, the copies
// on sale now and the turnover (value × chance). The view the niche-or-broad question is read on.
import { coverMarkup, parseBnPeople } from '../core/bibliography.js';
import { zl } from '../core/valuation.js';
import { liquidityLabel } from './deals.js';

const PAGE = 50;

/** One edition of the index. Pure (tested). */
export function marketRowMarkup(item, { escapeHtml }) {
  // The catalogue's reading of BN author strings; three names at most (anthologies list dozens).
  const people = parseBnPeople((item.authors || []).join(' '), item.authors).slice(0, 3).join(', ');
  const supply = item.liquidity.live === 1 ? '1 egzemplarz w sprzedaży' : `${item.liquidity.live} w sprzedaży`;
  const record = item.liquidity.listings ? `sprzedane ${item.liquidity.sales} z ${item.liquidity.listings} na Vinted` : 'bez ofert na Vinted (średnia rynku)';
  return `<article class="market-row"><button type="button" class="market-open" data-market-work="${escapeHtml(item.workId)}" title="Strona książki">${coverMarkup(item.cover, item.title, { size: 'sm', escapeHtml })}<span class="market-copy"><b class="market-title">${escapeHtml(item.title)}</b><small>${escapeHtml([people, item.publisher, item.year].filter(Boolean).join(' · '))}</small><small class="deal-liquidity is-${escapeHtml(item.liquidity.level)}">${escapeHtml(liquidityLabel(item.liquidity))}</small><small>${escapeHtml(record)} · ${escapeHtml(supply)}</small></span></button><span class="market-numbers"><strong>~${zl(item.value)}</strong><small>${Math.round(item.low / 100)}–${zl(item.high)} · <span class="value-confidence is-${escapeHtml(item.confidence)}">${escapeHtml(item.confidenceLabel)}</span></small><span class="market-turnover" title="Wartość × szansa sprzedaży w 30 dni">obrót ~${zl(item.turnover)}</span></span></article>`;
}

/** "Rynek: 2 364 ofert Vinted, 151 sprzedanych — przeciętnie 18% szans na sprzedaż w 30 dni." */
export function marketSummary(data) {
  const m = data?.market;
  if (!m) return '';
  return `${data.total} wydań z wyceną. Na Vinted ${m.listings} ofert tych wydań, ${m.sales} sprzedanych — przeciętny egzemplarz ma ${Math.round((m.chance ?? 0) * 100)}% szans na sprzedaż w 30 dni.`;
}

export function installMarket({ $, json, escapeHtml, openWork }) {
  const list = $('#marketList');
  if (!list) return { refresh: async () => {} };
  let items = [];
  let total = 0;
  let serial = 0;
  let timer = null;
  const params = (offset) =>
    new URLSearchParams({
      sort: $('#marketSort').value,
      limit: String(PAGE),
      offset: String(offset),
      ...($('#marketSearch').value.trim() ? { q: $('#marketSearch').value.trim() } : {}),
      ...($('#marketReliable').checked ? { confidence: 'medium' } : {}),
    });
  function render(data) {
    $('#marketSummary').textContent = marketSummary(data);
    list.innerHTML = items.length
      ? items.map((item) => marketRowMarkup(item, { escapeHtml })).join('') + (items.length < total ? `<button type="button" class="button secondary compact market-more" data-market-more>Pokaż więcej (${items.length} z ${total})</button>` : '')
      : '<p class="inline-note">Brak wydań z wyceną dla tych ustawień.</p>';
    list.querySelectorAll('[data-market-work]').forEach((button) => button.addEventListener('click', () => openWork(button.dataset.marketWork)));
    list.querySelector('[data-market-more]')?.addEventListener('click', () => void load(items.length));
  }
  async function load(offset = 0) {
    const request = ++serial;
    let data;
    try {
      data = await json('/api/market/index?' + params(offset));
    } catch {
      if (request === serial) list.innerHTML = '<p class="inline-note">Nie udało się odczytać indeksu rynku.</p>';
      return;
    }
    if (request !== serial) return;
    items = offset ? [...items, ...data.items] : data.items;
    total = data.total;
    render(data);
  }
  $('#marketSort').addEventListener('change', () => void load());
  $('#marketReliable').addEventListener('change', () => void load());
  $('#marketSearch').addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(() => void load(), 250);
  });
  return { refresh: () => load() };
}
