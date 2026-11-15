// Command palette (Ctrl+K): jump to a view, run a frequent action, or find an offer / work / ISBN.
import { coverMarkup, tidyOfferTitle, tidyWorkTitle, parseBnPeople } from '../core/bibliography.js';

/** Digits of a text that looks like an ISBN (10 or 13 characters after removing spaces and dashes), else null. */
export function isbnLike(text) {
  const clean = String(text ?? '').replace(/[\s-]/g, '').toUpperCase();
  return /^(?:\d{9}[\dX]|97[89]\d{10})$/.test(clean) ? clean : null;
}

/**
 * What the palette offers when nothing matched: scan the phrase, search the offers or the
 * catalogue for it, and for an ISBN-like text add the book by ISBN. Empty for an empty query.
 * @returns {{ kind: 'isbn' | 'scan' | 'offers' | 'catalog', label: string, hint: string }[]}
 */
export function fallbackActions(query) {
  const text = String(query ?? '').trim();
  if (!text) return [];
  const isbn = isbnLike(text);
  return [
    ...(isbn ? [{ kind: 'isbn', label: 'Dodaj książkę przez ISBN', hint: 'ISBN ' + isbn + ' · BN, Open Library, e-ISBN' }] : []),
    { kind: 'scan', label: 'Skanuj «' + text + '»', hint: 'Skan tej frazy w zaznaczonych źródłach' },
    { kind: 'offers', label: 'Szukaj w ofertach', hint: '„' + text + '” w zapisanych ofertach' },
    { kind: 'catalog', label: 'Szukaj w katalogu', hint: '„' + text + '” w dziełach i wydaniach' },
  ];
}

/** "1 oferta", "2 oferty", "5 ofert", "22 oferty". */
export const offersWord = (n) =>
  n === 1 ? 'oferta' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'oferty' : 'ofert';

export function installCommandPalette({ $, json, escapeHtml, money, showView, openOfferDrawer, openWork, onFallback = () => {}, actions = [] }) {
  const dialog = $('#commandPalette');
  const input = $('#paletteInput');
  const results = $('#paletteResults');
  if (!dialog || !input || !results) return;
  const views = [
    ['today', 'Dziś', 'Zmiany od ostatniej wizyty, stan źródeł'],
    ['queue', 'Kolejka', 'Weryfikacja, zestawy, podejrzane przypisania, duplikaty'],
    ['catalog', 'Książki', 'Dzieła, wydania i serie'],
    ['offers', 'Oferty', 'Wszystkie zebrane ogłoszenia'],
    ['deals', 'Okazje', 'Oferty wyraźnie poniżej wyceny wydania'],
    ['scanner', 'Źródła', 'Stan źródeł i nowy skan'],
    ['sets', 'Zestawy', 'Kolejka: oferty z wieloma książkami'],
    ['settings', 'Ustawienia', 'Interfejs, reguły odrzucania, kopie'],
  ];
  let items = [];
  let active = 0;
  let serial = 0;
  let timer = null;
  const fold = (text) => String(text).toLocaleLowerCase('pl').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');

  function staticItems(query) {
    const needle = fold(query.trim());
    const list = [
      ...views.map(([view, label, hint]) => ({ group: 'Przejdź', label, hint, run: () => showView(view) })),
      ...actions.map((action) => ({ group: 'Akcja', ...action })),
    ];
    return needle ? list.filter((item) => fold(item.label + ' ' + (item.hint || '')).includes(needle)) : list;
  }

  // Nothing matched (yet): the text itself becomes the action instead of "Brak wyników".
  function withFallback(list, query) {
    if (list.length) return list;
    return fallbackActions(query).map((action) => ({
      group: 'Brak trafień — co zrobić z tym tekstem',
      label: action.label,
      hint: action.hint,
      run: () => onFallback(action.kind, query.trim(), isbnLike(query)),
    }));
  }

  function render() {
    let lastGroup = '';
    results.innerHTML = items.length
      ? items
          .map((item, index) => {
            const header = item.group !== lastGroup ? `<div class="palette-group">${escapeHtml(item.group)}</div>` : '';
            lastGroup = item.group;
            return `${header}<button type="button" role="option" class="palette-item${index === active ? ' is-active' : ''}" aria-selected="${index === active}" data-index="${index}">${item.cover !== undefined ? coverMarkup(item.cover, item.label, { size: 'xs', escapeHtml }) : '<span class="palette-icon" aria-hidden="true">›</span>'}<span class="palette-copy"><b>${escapeHtml(item.label)}</b>${item.hint ? `<small>${escapeHtml(item.hint)}</small>` : ''}</span>${item.meta ? `<span class="palette-meta">${escapeHtml(item.meta)}</span>` : ''}</button>`;
          })
          .join('')
      : '<p class="palette-empty">Brak wyników.</p>';
    results.querySelector('.is-active')?.scrollIntoView({ block: 'nearest' });
  }

  async function search(query) {
    const request = ++serial;
    items = withFallback(staticItems(query), query);
    active = 0;
    render();
    const text = query.trim();
    if (text.length < 2) return;
    try {
      const [offers, works] = await Promise.all([
        json('/api/offers?' + new URLSearchParams({ query: text, limit: '6', status: 'all' })),
        json('/api/catalog/works?' + new URLSearchParams({ query: text, limit: '6' })),
      ]);
      if (request !== serial) return;
      items = withFallback([
        ...staticItems(query),
        ...(works.items || []).map((work) => ({
          group: 'Katalog',
          label: tidyWorkTitle(work.title),
          hint: parseBnPeople((work.authors || []).join(' '), work.authors).join(', ') || `${work.editionCount} ${work.editionCount === 1 ? 'wydanie' : 'wydań'}`,
          meta: `${work.offerCount} ${offersWord(work.offerCount)}`,
          cover: work.cover || null,
          run: () => openWork(work.id),
        })),
        ...(offers.items || []).map((offer) => ({
          group: 'Oferty',
          label: tidyOfferTitle(offer.title),
          hint: `${offer.source}${offer.observedIsbn ? ' · ISBN ' + offer.observedIsbn : ''}`,
          meta: money(offer.currentPrice),
          cover: offer.image || null,
          run: () => openOfferDrawer(offer.id),
        })),
      ], query);
      render();
    } catch {
      // Static entries stay usable when search fails.
    }
  }

  function open() {
    if (dialog.open) return;
    input.value = '';
    dialog.showModal();
    void search('');
    input.focus();
  }
  function choose(index) {
    const item = items[index];
    if (!item) return;
    dialog.close();
    item.run();
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    items = withFallback(staticItems(input.value), input.value);
    active = 0;
    render();
    timer = setTimeout(() => void search(input.value), 220);
  });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      active = Math.max(0, Math.min(items.length - 1, active + (event.key === 'ArrowDown' ? 1 : -1)));
      render();
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      choose(active);
    }
  });
  results.addEventListener('click', (event) => {
    const button = event.target.closest('[data-index]');
    if (button) choose(Number(button.dataset.index));
  });
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
      event.preventDefault();
      if (dialog.open) dialog.close();
      else open();
    }
  });
  return { open };
}
