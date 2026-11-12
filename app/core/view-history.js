// Pure helpers for view <-> URL mapping. Kept free of DOM so they are unit-testable.
export const VIEWS = ['today', 'scanner', 'queue', 'review', 'checks', 'catalog', 'sets', 'offers', 'settings'];

// Addresses use the names shown in the navigation (review 11.2026, stage 3): "Książki" is
// ?view=books, "Źródła" ?view=sources. The sections keep their ids (#view-catalog, #view-scanner).
// Old addresses (?view=catalog, ?view=scanner) still open the same view; the app then replaces the
// address with the new one, so bookmarks and the browser history keep working.
const URL_NAMES = { scanner: 'sources', catalog: 'books' };
const FROM_URL = { sources: 'scanner', books: 'catalog' };

export function viewFromSearch(search) {
  const raw = new URLSearchParams(search || '').get('view');
  const name = FROM_URL[raw] || raw;
  // "Dziś" is the start view.
  return VIEWS.includes(name) ? name : 'today';
}

/** True for an address written with an old view name (it is replaced by the new one). */
export function isLegacyAddress(search) {
  const raw = new URLSearchParams(search || '').get('view');
  return Boolean(raw && URL_NAMES[raw]);
}

// Selected item (book, review job, set) for views that have a list + detail layout.
export const ITEM_VIEWS = ['catalog', 'review', 'sets'];

export function idFromSearch(search) {
  const id = new URLSearchParams(search || '').get('id');
  return id && id.length <= 200 ? id : null;
}

export function urlForView(name, id = null) {
  if (name === 'today' || !VIEWS.includes(name)) return '/';
  const base = '/?view=' + (URL_NAMES[name] || name);
  return id && ITEM_VIEWS.includes(name) ? base + '&id=' + encodeURIComponent(id) : base;
}

// True when navigating to `name` must add a history entry: the visible URL differs
// from the target and this is not the initial render.
export function shouldPush(currentUrl, name, initial) {
  // Compare views only: selecting an item inside a view must not create a new entry.
  const current = currentUrl.split('#')[0];
  const [path, query = ''] = current.split('?');
  return !initial && urlForView(viewFromSearch('?' + query)) !== urlForView(name);
}
