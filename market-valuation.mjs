// @ts-check
// Market value of a book or an edition: what a used copy resells for, as a range with a
// confidence level and the reasons behind it. Builds on the same offers as price-stats.mjs:
// confirmed sales (availability 'sold') weigh more than asking prices, asking prices are taken
// below their face value, shop prices of new books only as a weak ceiling, every price is brought
// to a "good used copy" by its condition, and outliers are dropped on a log scale (median ± MAD).
// One SQL query per list page; the estimate itself is a pure function (estimateValue).
import { offerKindSql } from './offer-kinds.mjs';

const DAY = 86_400_000;
const MAX_PRICE = 1_000_000; // grosze: 10 000 zł and more is an unknown price

/** Price of a copy in this condition → price of a good used copy. */
export const CONDITION_FACTOR = {
  new: 0.85,
  very_good: 0.95,
  good: 1,
  satisfactory: 1.25,
  unknown: 1,
};
const CONDITION_NOTE = {
  new: 'nowy −15%',
  very_good: 'bardzo dobry −5%',
  satisfactory: 'zadowalający +25%',
};
/** What a seller asks is more than what a buyer pays. */
export const ASKING_FACTOR = 0.9;
/** A new book in a shop resells used for about this share of its shop price. */
export const SHOP_FACTOR = 0.6;
const WEIGHT = { sold: 3, private: 1, antiquarian: 0.8, new_shop: 0.3 };

export const CONFIDENCE_LABELS = {
  high: 'wysoka',
  medium: 'średnia',
  low: 'niska',
  none: 'brak danych',
};

const zl = (grosze) => `${Math.round(grosze / 100)} zł`;
const plural = (n, one, few, many) =>
  n === 1 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;

/** Weighted quantile of [{ value, weight }] sorted by value. */
function quantile(sorted, q) {
  const total = sorted.reduce((sum, item) => sum + item.weight, 0);
  let seen = 0;
  for (const item of sorted) {
    seen += item.weight;
    if (seen >= q * total - 1e-9) return item.value;
  }
  return sorted.at(-1)?.value ?? null;
}
function plainMedian(values) {
  const sorted = [...values].sort((a, b) => a - b),
    middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}
/** Round to a price people use: whole złoty under 50 zł, 5 zł above. */
function roundPrice(grosze) {
  const step = grosze >= 5000 ? 500 : 100;
  return Math.max(step, Math.round(grosze / step) * step);
}

/**
 * @typedef {{ price: number, state: 'live'|'sold'|'gone', kind: string, condition: string,
 *   firstSeenAt?: string|null, soldAt?: string|null, firstPrice?: number|null,
 *   editionId?: string }} Observation
 */

/**
 * The estimate from the observations of one book/edition. Prices in grosze.
 * @param {Observation[]} observations
 * @param {number} [at]
 * @param {{ trackedSince?: number|null }} [options] when the catalogue started recording offers:
 *   "new listings" are reported only once there is a longer history to compare with.
 */
export function estimateValue(observations, at = Date.now(), { trackedSince = null } = {}) {
  const priced = observations.filter(
    (item) => item.price > 0 && item.price < MAX_PRICE && item.state !== 'gone',
  );
  const reasons = [];
  const live = priced.filter((item) => item.state === 'live');
  const sold = priced.filter((item) => item.state === 'sold');
  // Supply is the competing used copies; a shop's new book is not one of them.
  const usedLive = live.filter((item) => item.kind !== 'new_shop');
  const supply = usedLive.length >= 8 ? 'plentiful' : usedLive.length <= 1 ? 'scarce' : 'normal';
  if (!priced.length)
    return {
      estimate: null,
      low: null,
      high: null,
      confidence: 'none',
      confidenceLabel: CONFIDENCE_LABELS.none,
      basis: 'none',
      sold: 0,
      live: 0,
      excluded: 0,
      trend: null,
      supply,
      reasons: ['Brak cen ofert ani sprzedaży — nie da się oszacować wartości.'],
    };
  // Bring every price to a good used copy sold, with a weight for how much it says.
  let points = priced.map((item) => {
    const age = (at - Date.parse(item.soldAt || item.firstSeenAt || '')) / DAY;
    const stale = Number.isFinite(age) && age > 180 ? 0.5 : 1;
    const isShop = item.kind === 'new_shop';
    const factor = isShop
      ? SHOP_FACTOR
      : (CONDITION_FACTOR[item.condition] ?? CONDITION_FACTOR.unknown) *
        (item.state === 'sold' ? 1 : ASKING_FACTOR);
    const weight =
      (item.state === 'sold' ? WEIGHT.sold : (WEIGHT[item.kind] ?? WEIGHT.private)) * stale;
    return { value: item.price * factor, weight, item };
  });
  // Outliers: far from the median on a log scale (robust spread, at least ×1.8 either way).
  let excluded = 0;
  if (points.length >= 3) {
    const logs = points.map((point) => Math.log(point.value));
    const center = plainMedian(logs);
    const mad = plainMedian(logs.map((value) => Math.abs(value - center))) * 1.4826;
    const limit = Math.max(3 * mad, Math.log(1.8));
    const kept = points.filter((point) => Math.abs(Math.log(point.value) - center) <= limit);
    excluded = points.length - kept.length;
    points = kept;
  }
  points.sort((a, b) => a.value - b.value);
  const keptSold = points.filter((point) => point.item.state === 'sold').length;
  const keptLive = points.length - keptSold;
  // Sales older than a year do not make a valuation certain.
  const freshSold = points.filter(
    (point) =>
      point.item.state === 'sold' && !(at - Date.parse(point.item.soldAt || '') > 365 * DAY),
  ).length;
  const onlyShop = points.every((point) => point.item.kind === 'new_shop');
  // Plenty of competing copies push the price down, a lone copy with sales behind it holds it.
  const centre = supply === 'plentiful' ? 0.4 : supply === 'scarce' && keptSold ? 0.6 : 0.5;
  let estimate = quantile(points, centre);
  let low = quantile(points, 0.25);
  let high = quantile(points, 0.75);
  // Few data → a wider range, never narrower than the uncertainty of the count.
  const minSpread =
    keptSold >= 3 ? 0.1 : points.length >= 4 ? 0.15 : points.length >= 2 ? 0.2 : 0.3;
  low = Math.min(low, estimate * (1 - minSpread));
  high = Math.max(high, estimate * (1 + minSpread));
  const spread = high / low;
  const confidence = onlyShop
    ? 'low'
    : freshSold >= 3 && spread <= 1.6
      ? 'high'
      : (keptSold >= 1 && points.length >= 3 && spread <= 2.2) ||
          (points.length >= 5 && spread <= 1.8)
        ? 'medium'
        : 'low';

  if (keptSold)
    reasons.push(
      `${keptSold} ${plural(keptSold, 'potwierdzona sprzedaż', 'potwierdzone sprzedaże', 'potwierdzonych sprzedaży')} (waga ×3)` +
        (keptLive
          ? ` i ${keptLive} ${plural(keptLive, 'oferta', 'oferty', 'ofert')} (cena ofertowa −10%)`
          : '') +
        '.',
    );
  else
    reasons.push(
      `Tylko ceny ofertowe (${keptLive}), brak potwierdzonej sprzedaży — oferty liczone 10% niżej, bo cena wystawienia to nie cena transakcji.`,
    );
  if (points.some((point) => point.item.kind === 'new_shop'))
    reasons.push(
      onlyShop
        ? 'Są tylko ceny nowych książek w sklepach — używany egzemplarz wyceniono na ok. 60% ceny sklepowej; to szacunek, nie rynek wtórny.'
        : 'Ceny nowych książek ze sklepów liczą się słabo (ok. 60% ceny, mała waga).',
    );
  const adjusted = Object.keys(CONDITION_NOTE).filter((condition) =>
    points.some((point) => point.item.kind !== 'new_shop' && point.item.condition === condition),
  );
  if (adjusted.length)
    reasons.push(
      `Ceny sprowadzone do egzemplarza w dobrym stanie: ${adjusted.map((condition) => CONDITION_NOTE[condition]).join(', ')}.`,
    );
  if (excluded)
    reasons.push(
      `Pominięto ${excluded} ${plural(excluded, 'nietypową cenę', 'nietypowe ceny', 'nietypowych cen')} (daleko od reszty).`,
    );
  if (supply === 'plentiful')
    reasons.push(
      `Duża podaż: ${usedLive.length} ${plural(usedLive.length, 'używany egzemplarz', 'używane egzemplarze', 'używanych egzemplarzy')} w sprzedaży — wycena bliżej dolnej części cen.`,
    );
  else if (supply === 'scarce')
    reasons.push(
      usedLive.length
        ? 'Rzadko dostępna: tylko 1 używany egzemplarz w sprzedaży.'
        : live.length
          ? 'Brak używanych egzemplarzy w sprzedaży — są tylko nowe w sklepach.'
          : 'Brak dostępnych ofert — wycena z cen archiwalnych.',
    );
  // Trend: sold prices of the last 90 days against older ones, else asking-price changes.
  let trend = null;
  const recent = sold.filter((item) => at - Date.parse(item.soldAt || '') <= 90 * DAY);
  const older = sold.filter((item) => at - Date.parse(item.soldAt || '') > 90 * DAY);
  if (recent.length >= 2 && older.length >= 2) {
    const change =
      plainMedian(recent.map((i) => i.price)) / plainMedian(older.map((i) => i.price)) - 1;
    trend = { percent: Math.round(change * 100), basis: 'sold' };
  } else {
    // Asking prices: only used copies (a shop's price change is a promotion), and only when a
    // real share of the sellers moved — a few changed offers say nothing about the rest.
    const changed = usedLive.filter((item) => item.firstPrice && item.firstPrice !== item.price);
    if (changed.length >= 3 && changed.length / usedLive.length >= 0.25) {
      const change = plainMedian(changed.map((item) => item.price / Number(item.firstPrice))) - 1;
      trend = {
        percent: Math.round(change * 100),
        basis: 'asking',
        changed: changed.length,
        of: usedLive.length,
      };
    }
  }
  if (trend && Math.abs(trend.percent) >= 5)
    reasons.push(
      trend.basis === 'sold'
        ? `Ceny sprzedaży z ostatnich 90 dni ${trend.percent > 0 ? 'wyższe' : 'niższe'} o ${Math.abs(trend.percent)}% niż wcześniej.`
        : `${trend.changed} z ${trend.of} ofert zmieniło cenę, zwykle o ${trend.percent > 0 ? '+' : '−'}${Math.abs(trend.percent)}%.`,
    );
  const newListings = live.filter(
    (item) => at - Date.parse(item.firstSeenAt || '') <= 30 * DAY,
  ).length;
  if (newListings >= 3 && trackedSince != null && at - trackedSince >= 60 * DAY)
    reasons.push(
      `${newListings} ${plural(newListings, 'nowa oferta', 'nowe oferty', 'nowych ofert')} w ostatnich 30 dniach.`,
    );
  if (confidence === 'low')
    reasons.push('Mało lub rozbieżne dane — traktuj wycenę jako orientacyjną.');
  return {
    estimate: roundPrice(estimate),
    low: roundPrice(low),
    high: Math.max(roundPrice(high), roundPrice(estimate)),
    confidence,
    confidenceLabel: CONFIDENCE_LABELS[confidence],
    basis: keptSold ? (keptLive ? 'mixed' : 'sold') : 'asking',
    sold: keptSold,
    live: keptLive,
    excluded,
    trend,
    supply,
    reasons,
  };
}

/** One line for a list: "70–95 zł · wiarygodność średnia". */
export function valuationSummary(valuation) {
  if (!valuation || valuation.estimate == null) return 'brak danych do wyceny';
  return `${Math.round(valuation.low / 100)}–${zl(valuation.high)} · wiarygodność ${valuation.confidenceLabel}`;
}

/**
 * Valuations of many works or editions at once: Map id → estimateValue result. One query for all
 * ids (a list page), with the first recorded price of each offer for the trend.
 * @param {import('node:sqlite').DatabaseSync} database
 * @param {'work'|'edition'} by
 * @param {string[]} ids
 */
export function marketValuations(database, by, ids, at = Date.now()) {
  const out = new Map();
  if (!ids.length) return out;
  const first = database.prepare('SELECT min(first_seen_at) AS first FROM offers').get()?.first;
  const options = { trackedSince: first ? Date.parse(String(first)) : null };
  const key = by === 'work' ? 'e.work_id' : 'm.edition_id';
  const rows = database
    .prepare(
      `SELECT ${key} AS k, m.edition_id AS editionId, o.current_price AS price, o.availability AS availability,
         coalesce(o.condition_class,'unknown') AS condition, ${offerKindSql('o')} AS kind,
         o.first_seen_at AS firstSeenAt, o.availability_changed_at AS changedAt,
         (SELECT h.price FROM offer_price_history h WHERE h.offer_id=o.id ORDER BY h.observed_at LIMIT 1) AS firstPrice
       FROM offer_matches m JOIN editions e ON e.id=m.edition_id JOIN offers o ON o.id=m.offer_id
       WHERE m.status='active' AND o.currency='PLN' AND o.current_price>0
         AND ${key} IN (SELECT value FROM json_each(?))`,
    )
    .all(JSON.stringify(ids));
  const grouped = new Map(ids.map((id) => [id, []]));
  for (const row of rows) {
    const availability = String(row.availability);
    grouped.get(String(row.k))?.push({
      editionId: String(row.editionId),
      price: Number(row.price),
      state:
        availability === 'sold'
          ? 'sold'
          : ['unavailable', 'reserved'].includes(availability)
            ? 'gone'
            : 'live',
      kind: String(row.kind),
      condition: String(row.condition),
      firstSeenAt: /** @type {string|null} */ (row.firstSeenAt),
      soldAt: availability === 'sold' ? /** @type {string|null} */ (row.changedAt) : null,
      firstPrice: row.firstPrice == null ? null : Number(row.firstPrice),
    });
  }
  for (const [id, observations] of grouped) {
    const valuation = estimateValue(observations, at, options);
    if (by === 'work') Object.assign(valuation, editionSpread(observations, at, options));
    out.set(id, valuation);
  }
  return out;
}

/**
 * Editions of one work priced apart (hardcover against paperback, a sought-after first edition):
 * one amount for the book would blend them, so the book gets the range of its editions' values.
 * Counts editions with at least two prices; apart means ×1.5 or more between their estimates.
 */
function editionSpread(observations, at, options) {
  const byEdition = new Map();
  for (const item of observations)
    (byEdition.get(item.editionId) ?? byEdition.set(item.editionId, []).get(item.editionId)).push(
      item,
    );
  if (byEdition.size < 2) return {};
  const estimates = [];
  for (const list of byEdition.values()) {
    const value = estimateValue(list, at, options);
    if (value.estimate != null && value.sold + value.live >= 2) estimates.push(value.estimate);
  }
  if (estimates.length < 2) return {};
  const low = Math.min(...estimates),
    high = Math.max(...estimates);
  if (high / low < 1.5) return {};
  return { editionRange: { low, high, editions: estimates.length } };
}
