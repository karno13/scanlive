import { coverMarkup, tidyOfferTitle } from '../core/bibliography.js';

// Oferty → "Wg książki": one card per edition (cover, title, publisher and year, how many listings,
// price range, sources) instead of six separate "Fourth Wing" rows. A card opens its listings;
// a listing opens the usual offer panel. The list filters (search, source, status, scan, price)
// apply to both layouts; offers not assigned to an edition are counted under the cards.
const LAYOUT_KEY = 'bookflip.offerLayout';
const PAGE = 40;

export function installOfferGroups({ $, $$, json, money, escapeHtml, filters, openOfferDrawer }) {
  const panel = $('#offerGroups');
  const list = $('#view-offers .offers-panel');
  const pager = $('#view-offers .pagination');
  if (!panel || !list) return { refresh: () => {}, active: () => false };
  let layout = 'list';
  try {
    layout = localStorage.getItem(LAYOUT_KEY) === 'groups' ? 'groups' : 'list';
  } catch {}
  let serial = 0;
  let items = [];
  let total = 0;
  let unassigned = 0;
  const open = new Set();

  const params = (extra = {}) => {
    const values = { ...filters(), ...extra };
    // Group order: the list's sort where it means something for a group; "newest" by default.
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(values)) if (value !== '' && value != null) query.set(key, String(value));
    return query;
  };
  const priceRange = (item) =>
    item.minPrice == null ? '—' : item.minPrice === item.maxPrice ? money(item.minPrice) : `${money(item.minPrice)} – ${money(item.maxPrice)}`;
  const plural = (n, one, few, many) => (n === 1 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);

  function card(item) {
    const author = item.authors?.[0] ? String(item.authors[0]).replace(/\s*\(.*\)$/, '') : '';
    // Editions of one book differ by ISBN ("Fourth Wing", Filia 2023: three of them).
    const facts = [item.publisher, item.publicationYear, item.isbn ? 'ISBN ' + item.isbn : ''].filter(Boolean).join(' · ');
    const expanded = open.has(item.editionId);
    return `<article class="offer-group${expanded ? ' is-open' : ''}" data-edition="${escapeHtml(item.editionId)}">
      <button type="button" class="offer-group-head" aria-expanded="${expanded}">
        ${coverMarkup(item.cover, item.workTitle, { size: 'sm', escapeHtml })}
        <span class="offer-group-copy"><strong>${escapeHtml(item.workTitle)}</strong>
          <small>${escapeHtml([author, facts].filter(Boolean).join(' · '))}</small>
          <small class="offer-group-sources">${item.sources.map((source) => `<span class="source-dot" data-source="${escapeHtml(source)}"></span>${escapeHtml(source)}`).join(' ')}</small></span>
        <span class="offer-group-numbers"><b>${escapeHtml(priceRange(item))}</b><small>${item.offers} ${plural(item.offers, 'ogłoszenie', 'ogłoszenia', 'ogłoszeń')}</small></span>
      </button>
      <div class="offer-group-offers" ${expanded ? '' : 'hidden'}></div>
    </article>`;
  }

  async function loadOffers(article) {
    const mount = article.querySelector('.offer-group-offers');
    mount.innerHTML = '<p class="inline-note">Wczytywanie ogłoszeń…</p>';
    try {
      const data = await json('/api/offers?' + params({ edition: article.dataset.edition, limit: 100, offset: 0, sort: 'price-asc' }));
      mount.innerHTML = data.items
        .map(
          (offer) => `<button type="button" class="offer-group-row" data-offer="${escapeHtml(offer.id)}">
            <span class="source-dot" data-source="${escapeHtml(offer.source)}"></span><span class="offer-group-row-title">${escapeHtml(tidyOfferTitle(offer.title || offer.originalTitle))}</span>
            <small>${escapeHtml(offer.source)}</small><b>${money(offer.currentPrice)}</b></button>`,
        )
        .join('') || '<p class="inline-note">Brak ogłoszeń zgodnych z filtrami.</p>';
      mount.querySelectorAll('[data-offer]').forEach((button) => button.addEventListener('click', () => openOfferDrawer(button.dataset.offer)));
    } catch {
      mount.innerHTML = '<p class="inline-note">Nie udało się wczytać ogłoszeń.</p>';
    }
  }

  function render() {
    const more = items.length < total;
    panel.innerHTML =
      (items.length ? items.map(card).join('') : '<div class="empty-detail">Brak przypisanych ofert zgodnych z filtrami.</div>') +
      `<footer class="offer-groups-footer"><span>${total} ${plural(total, 'wydanie', 'wydania', 'wydań')}${unassigned ? ` · ${unassigned} ${plural(unassigned, 'oferta', 'oferty', 'ofert')} bez przypisanego wydania (widok „Lista”)` : ''}</span>${more ? '<button type="button" class="button secondary compact" data-groups-more>Pokaż kolejne</button>' : ''}</footer>`;
    panel.querySelectorAll('.offer-group').forEach((article) => {
      article.querySelector('.offer-group-head').addEventListener('click', () => {
        const id = article.dataset.edition;
        const expanded = !open.has(id);
        if (expanded) open.add(id);
        else open.delete(id);
        article.classList.toggle('is-open', expanded);
        article.querySelector('.offer-group-head').setAttribute('aria-expanded', String(expanded));
        article.querySelector('.offer-group-offers').hidden = !expanded;
        if (expanded) void loadOffers(article);
      });
      if (open.has(article.dataset.edition)) void loadOffers(article);
    });
    panel.querySelector('[data-groups-more]')?.addEventListener('click', () => void load({ append: true }));
    $('#offerTotal').textContent = `${total} ${plural(total, 'wydanie', 'wydania', 'wydań')}`;
  }

  async function load({ append = false } = {}) {
    const request = ++serial;
    const groupSort = { newest: 'newest', oldest: 'oldest', 'price-asc': 'price-asc', 'price-desc': 'price-desc', title: 'title', 'title-desc': 'title-desc' }[filters().sort] || 'offers';
    try {
      const data = await json('/api/offer-groups?' + params({ sort: groupSort, limit: PAGE, offset: append ? items.length : 0 }));
      if (request !== serial) return;
      items = append ? [...items, ...data.items] : data.items;
      total = data.total;
      unassigned = data.unassigned;
      render();
    } catch {
      if (request === serial) panel.innerHTML = '<div class="empty-detail">Nie udało się wczytać ofert według wydania.</div>';
    }
  }

  function apply() {
    const grouped = layout === 'groups';
    panel.hidden = !grouped;
    list.hidden = grouped;
    if (pager) pager.hidden = grouped;
    $$('[data-offer-layout]').forEach((button) => button.setAttribute('aria-pressed', String(button.dataset.offerLayout === layout)));
    if (grouped) void load();
  }
  $$('[data-offer-layout]').forEach((button) =>
    button.addEventListener('click', () => {
      layout = button.dataset.offerLayout;
      try {
        localStorage.setItem(LAYOUT_KEY, layout);
      } catch {}
      apply();
    }),
  );
  apply();
  return {
    active: () => layout === 'groups',
    // Called after the offer list reloads with new filters.
    refresh: () => {
      if (layout === 'groups') void load();
    },
  };
}
