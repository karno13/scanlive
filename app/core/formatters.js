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
/**
 * Date for a list row: "dziś 20:53", "wczoraj", "8.11" (another year: "8.11.2025"). The full date
 * and time belong in the title (dateMarkup).
 */
export function relativeDate(value, now = new Date()) {
  const moment = value ? new Date(value) : null;
  if (!moment || Number.isNaN(moment.getTime())) return '-';
  const midnight = (day) => new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime();
  const days = Math.round((midnight(now) - midnight(moment)) / 86_400_000);
  if (days === 0)
    return 'dziś ' + moment.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' });
  if (days === 1) return 'wczoraj';
  return moment.toLocaleDateString(
    'pl-PL',
    moment.getFullYear() === now.getFullYear()
      ? { day: 'numeric', month: 'numeric' }
      : { day: 'numeric', month: 'numeric', year: 'numeric' },
  );
}
/** <time> with the short date shown and the full one in its title. */
export function dateMarkup(value, now = new Date()) {
  const moment = value ? new Date(value) : null;
  if (!moment || Number.isNaN(moment.getTime())) return '-';
  return `<time datetime="${escapeHtml(moment.toISOString())}" title="${escapeHtml(date(value))}">${escapeHtml(relativeDate(value, now))}</time>`;
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
      // Found by the scan; the listing page itself was not opened.
      return 'w wynikach skanu (strony ogłoszenia nie sprawdzano)';
  }
}

const seenAgo = (days) => (days <= 0 ? 'dziś' : days === 1 ? 'wczoraj' : days + ' dni temu');
// Calendar days between two times (yesterday 20:30 is "wczoraj" at 9:00, not "dziś").
const calendarDays = (now, then) => Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(then).setHours(0, 0, 0, 0)) / 86400000);

/** Short listing state for a badge: what the listing is now, never the identification job state. */
export function availabilityBadge(offer = {}, now = Date.now()) {
  switch (offer.availability) {
    case 'sold':
      return { label: 'Sprzedana', tone: 'neutral' };
    case 'reserved':
      return { label: 'Zarezerwowana', tone: 'warning' };
    case 'unavailable':
      return { label: 'Niedostępna', tone: 'neutral' };
    case 'available':
      return { label: 'Aktywna', tone: 'success' };
    case 'not_seen':
      return { label: 'Mogła zniknąć', tone: 'warning' };
    default: {
      // Not confirmed on the listing page: say when the scan last saw it instead of "Aktywna".
      const seen = Date.parse(offer.lastSeenAt || '');
      if (Number.isFinite(seen) && now - seen <= 3 * 86400000)
        return { label: 'Widziana ' + seenAgo(calendarDays(now, seen)), tone: 'success' };
      return { label: 'Dawno niewidziana', tone: 'neutral' };
    }
  }
}

/** Offers that can still be bought: sold, reserved and removed listings are out of current prices. */
export const isPurchasable = (offer = {}) => !['unavailable', 'sold', 'reserved'].includes(offer.availability);

/** What a source error means for the operator, and what to do about it. */
export const SOURCE_PROBLEMS = {
  SOURCE_CAPTCHA: ['wymaga CAPTCHA', 'Serwis prosi o potwierdzenie, że to człowiek. BookFlip nie obchodzi takich zabezpieczeń — odznacz źródło i spróbuj za kilka godzin.'],
  SOURCE_HTTP_403: ['odmowa dostępu (403)', 'Serwis blokuje automatyczne zapytania. Zwykle mija po kilku godzinach; do tego czasu odznacz źródło.'],
  SOURCE_FORBIDDEN_UNREADABLE: ['odmowa dostępu', 'Serwis zwrócił stronę blokady. Odznacz źródło i spróbuj później.'],
  SOURCE_HTTP_429: ['za dużo zapytań (429)', 'Serwis ogranicza tempo. Skanuj mniej fraz naraz albo użyj „Ponów chwilowe błędy” za kilkanaście minut.'],
  SOURCE_HTTP_503: ['serwis niedostępny (503)', 'Serwis chwilowo nie odpowiada albo ma przerwę techniczną. Użyj „Ponów chwilowe błędy” później.'],
  SOURCE_HTTP_502: ['błąd serwera (502)', 'Chwilowy błąd po stronie serwisu. Użyj „Ponów chwilowe błędy” później.'],
  SOURCE_HTTP_500: ['błąd serwera (500)', 'Chwilowy błąd po stronie serwisu. Użyj „Ponów chwilowe błędy” później.'],
  SOURCE_HTTP_404: ['strona nie istnieje (404)', 'Serwis zmienił adres wyszukiwania — źródło wymaga poprawki w programie.'],
  SOURCE_TIMEOUT: ['brak odpowiedzi', 'Serwis odpowiadał za wolno. Użyj „Ponów chwilowe błędy”.'],
  SOURCE_NOT_HTML: ['nieoczekiwana odpowiedź', 'Serwis zwrócił coś innego niż stronę wyników — możliwa zmiana serwisu.'],
  SOURCE_REQUEST_FAILED: ['błąd połączenia', 'Nie udało się połączyć z serwisem. Sprawdź internet i ponów.'],
  PAGINATION_LOOP: ['powtarzające się strony', 'Serwis podawał w kółko tę samą stronę wyników; zapisano to, co było przed pętlą.'],
};
export const problemLabel = (code) => SOURCE_PROBLEMS[code]?.[0] || (code ? String(code).toLowerCase().replace(/^source_/, '').replace(/_/g, ' ') : 'błąd');

/** One line about a scan source's recent health; `short` is for the scanner checkbox. */
export function sourceHealthNote(row, { short = false } = {}) {
  if (!row) return short ? '' : 'Dostępny w programie; jeszcze nie sprawdzono działania.';
  const day = (value) => (value ? new Date(value).toLocaleString('pl-PL', { day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }) : null);
  // "SOURCE_HTTP_429, SOURCE_TIMEOUT" → "za dużo zapytań (429), brak odpowiedzi"
  const problems = String(row.last_error || '').split(/,\s*/).filter(Boolean).map(problemLabel).join(', ') || 'błąd';
  const since = row.last_success_at ? 'ostatnio działał ' + day(row.last_success_at) : 'jeszcze nigdy nie zadziałał';
  if (row.status === 'ok') return short ? '' : 'Działa · ostatni udany odczyt ' + day(row.last_success_at);
  // Rate limited (HTTP 429): the source works, it only wants slower requests. Not a dead source.
  if (row.status === 'limited') return short ? 'ogranicza tempo' : 'Ogranicza tempo zapytań: ' + problems + ' · ' + since;
  // Rows saved before 'failed' existed: 'partial' without any success means the source never worked.
  if (row.status === 'failed' || (row.status === 'partial' && !row.last_success_at && !row.offers_seen))
    return short ? 'nie działa' : 'Nie działa w ostatnim skanie: ' + problems + ' · ' + since;
  return short ? 'część zapytań zawodzi' : 'Działa częściowo, część zapytań kończy się błędem: ' + problems + ' · ostatni udany odczyt ' + (day(row.last_success_at) || 'brak');
}

/** "1 zadanie z problemami", "3 zadania z problemami", "14 zadań z problemami". */
export function problemTasks(count) {
  const n = Math.abs(Number(count) || 0);
  const word = n === 1 ? 'zadanie' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'zadania' : 'zadań';
  return `${n} ${word} z problemami`;
}
