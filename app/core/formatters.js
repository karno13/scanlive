export function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char],
  );
}
export function money(value) {
  return value == null
    ? '-'
    : new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(value / 100);
}
export function date(value) {
  return value ? new Date(value).toLocaleString('pl-PL') : '-';
}
export function shortTime(value) {
  return value
    ? new Date(value).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })
    : '-';
}

// Prices in offer records are integer grosze. User-entered amounts are złote.
export function zlotyToGrosze(value) {
  const amount = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(amount) || amount < 0) return null;
  const grosze = Math.round(amount * 100);
  return Number.isSafeInteger(grosze) ? grosze : null;
}
export function groszeToZloty(value) {
  return value == null ? null : Number(value) / 100;
}
export function moneyFromZloty(value) {
  const amount = Number(value);
  const grosze = Math.round(amount * 100);
  return Number.isFinite(amount) && Number.isSafeInteger(grosze) ? money(grosze) : '-';
}

// Never interpolate untrusted non-HTTPS URLs into actionable links from legacy records.
export function safeOfferHref(value) {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && url.hostname && !url.username &&
      !url.password && !url.port ? url.href : '#';
  } catch { return '#'; }
}

/** Offer lifecycle as shown next to a listing: sold / reserved / gone / unconfirmed. */
export function availabilityLabel(offer = {}) {
  const when = offer.availabilityChangedAt ? ' ' + String(offer.availabilityChangedAt).slice(0, 10) : '';
  switch (offer.availability) {
    case 'sold':
      return 'sprzedana' + when;
    case 'reserved':
      return 'zarezerwowana' + when;
    case 'unavailable':
      return 'niedostępna' + when;
    case 'available':
      return 'aktywna (sprawdzono)';
    case 'not_seen':
      return 'nie było jej w ostatnim skanie';
    default:
      return 'dostępność niepotwierdzona';
  }
}

/** Short listing state for a badge: what the listing is now, never the identification job state. */
export function availabilityBadge(offer = {}, now = Date.now()) {
  switch (offer.availability) {
    case 'sold':
      return { label: 'Sprzedana', tone: 'neutral' };
    case 'reserved':
      return { label: 'Zarezerwowana', tone: 'warning' };
    case 'unavailable':
      return { label: 'Usunięta', tone: 'neutral' };
    case 'available':
      return { label: 'Aktywna', tone: 'success' };
    case 'not_seen':
      return { label: 'Mogła zniknąć', tone: 'warning' };
    default: {
      const seen = Date.parse(offer.lastSeenAt || '');
      if (Number.isFinite(seen) && now - seen <= 3 * 86400000) return { label: 'Aktywna', tone: 'success' };
      return { label: 'Dawno niewidziana', tone: 'neutral' };
    }
  }
}

/** Offers that can still be bought: sold, reserved and removed listings are out of current prices. */
export const isPurchasable = (offer = {}) => !['unavailable', 'sold', 'reserved'].includes(offer.availability);

/** One line about a scan source's recent health; `short` is for the scanner checkbox. */
export function sourceHealthNote(row, { short = false } = {}) {
  if (!row) return short ? '' : 'Dostępny w programie; jeszcze nie sprawdzono działania.';
  const day = (value) => (value ? new Date(value).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : null);
  if (row.status === 'ok') return short ? '' : 'Działa · ostatni udany odczyt ' + day(row.last_success_at);
  // Rows saved before 'failed' existed: 'partial' without any success means the source never worked.
  if (row.status === 'failed' || (row.status === 'partial' && !row.last_success_at && !row.offers_seen)) {
    const since = row.last_success_at ? 'ostatnio działał ' + day(row.last_success_at) : 'jeszcze nigdy nie zadziałał';
    return short ? 'nie działa' : 'Nie działa w ostatnim skanie (' + (row.last_error || 'błąd') + ') · ' + since;
  }
  return short ? 'część zapytań zawodzi' : 'Działa częściowo: część zapytań kończy się błędem (' + (row.last_error || 'błąd') + ') · ostatni udany odczyt ' + (day(row.last_success_at) || 'brak');
}
