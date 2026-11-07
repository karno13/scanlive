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

/** Offers that can still be bought: sold, reserved and removed listings are out of current prices. */
export const isPurchasable = (offer = {}) => !['unavailable', 'sold', 'reserved'].includes(offer.availability);
