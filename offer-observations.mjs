// @ts-check
// Everything a source tells about one listing besides title and price: the copy's condition, the
// buyer's fee, the seller, the description and photos, when it was listed and how many people
// liked it. A listing that disappears cannot be read again, so these are saved at first sight and
// whenever they change, together with the raw listing object (for fields not foreseen today).
import { createHash } from 'node:crypto';

export const CONDITION_CLASSES = ['new', 'very_good', 'good', 'satisfactory', 'unknown'];

const fold = (value) =>
  String(value ?? '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Class of a condition text as sources write it: Vinted "Nowy z metką" / "Bardzo dobry" / "Dobry" /
 * "Zadowalający", Tezeusz "bardzo dobry" / "dostateczny", schema.org NewCondition. "Używany" says
 * only that it is not new, so it stays unknown.
 */
export function conditionClass(text) {
  const t = fold(text);
  if (!t) return 'unknown';
  if (/jak now|bardzo dobr|very good|idealn|doskonal|excellent|like new/.test(t)) return 'very_good';
  if (/zadowalaj|satisfactory|dostateczn|sredni|slab|uszkodz|poor|acceptable/.test(t)) return 'satisfactory';
  // Vinted's own definition of "Dobry": used, with signs of wear (Tezeusz: "Ze śladami użytkowania").
  if (/\bdobr|\bgood\b|slad(?:y|ami) uzytk/.test(t)) return 'good';
  if (/\bnow[yaei]|\bnew\b|newcondition|nieuzywan|w folii/.test(t)) return 'new';
  return 'unknown';
}

/** @type {Array<[RegExp, number]>} */
const AGE_UNITS = [
  [/^(?:sek|s\b)/, 1000],
  [/^min/, 60_000],
  [/^(?:godz|h\b)/, 3_600_000],
  [/^(?:dzien|dni|dnia|d\b)/, 86_400_000],
  [/^(?:tydz|tyg)/, 7 * 86_400_000],
  [/^mies/, 30 * 86_400_000],
  [/^(?:rok|lat)/, 365 * 86_400_000],
];

/**
 * Vinted shows only how long ago a listing was added ("3 godz.", "2 dni", "1 tydz.", "przed
 * chwilą"). Returns the approximate moment, or null for text it does not understand.
 */
export function listedAtFromAge(text, now = new Date()) {
  const t = fold(text);
  if (!t) return null;
  const base = now instanceof Date ? now.getTime() : Date.parse(now);
  if (!Number.isFinite(base)) return null;
  if (/^(?:teraz|przed chwila|just now)/.test(t)) return new Date(base).toISOString();
  const match = t.match(/^(\d{1,4})\s*(.*)$/) || t.match(/^(?:(?:a|an|one)\s+)?()(.*)$/);
  if (!match) return null;
  const count = match[1] === '' ? 1 : Number(match[1]);
  const unit = AGE_UNITS.find(([pattern]) => pattern.test(match[2]));
  if (!unit || !Number.isFinite(count)) return null;
  return new Date(base - count * unit[1]).toISOString();
}

/** Złote from a source ("4.45", 4.45, "4,45 zł") to grosze; null when it is not a sane amount. */
export function grosze(value) {
  if (value == null || value === '') return null;
  const amount = Number(String(value).replace(/\s|zł|PLN/gi, '').replace(',', '.'));
  if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return null;
  return Math.round(amount * 100);
}

const RAW_LIMIT = 16_000;
// Values that change on every visit without the listing changing; they do not start a new snapshot.
const VOLATILE_KEYS = new Set([
  'favouriteCount', 'favourite_count', 'isFavourite', 'is_favourite', 'viewCount', 'view_count',
  'accessibilityLabel', 'exposure', 'exposures', 'ffExposures', 'upload_date', 'listedAge', 'hates_you', 'is_hated',
]);
// Copies of the same photo in other sizes: the original is enough.
const DROPPED_KEYS = new Set(['thumbnails', 'thumbnailUrls', 'dominantColor', 'dominant_color_opaque']);

function compact(value, depth = 0) {
  if (depth > 12) return null;
  if (Array.isArray(value)) return value.slice(0, 50).map((entry) => compact(entry, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, entry] of Object.entries(value)) {
      if (DROPPED_KEYS.has(key) || entry === undefined || entry === '$undefined') continue;
      out[key] = compact(entry, depth + 1);
    }
    return out;
  }
  if (typeof value === 'string') return value.slice(0, 4000);
  return value;
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.keys(value)
        .filter((key) => !VOLATILE_KEYS.has(key))
        .sort()
        .map((key) => [key, stable(value[key])]),
    );
  // Signed image addresses change their token; the photo is the same.
  if (typeof value === 'string' && /^https:\/\/[^/]*(?:vinted\.net|img|image)/i.test(value)) return value.replace(/\?.*$/, '');
  return value;
}

/** The raw object of one listing, bounded in size, with a digest that ignores volatile fields. */
export function rawSnapshot(value) {
  if (!value || typeof value !== 'object') return null;
  const compacted = compact(value);
  let payload = JSON.stringify(compacted);
  const truncated = payload.length > RAW_LIMIT;
  if (truncated) payload = payload.slice(0, RAW_LIMIT);
  const digest = createHash('sha256').update(JSON.stringify(stable(compacted))).digest('hex').slice(0, 32);
  return { payload, digest, truncated };
}

const TEXT_LIMITS = { conditionText: 200, sellerId: 100, sellerName: 200, listedAtText: 60, sourceAvailability: 100 };
const COUNT_FIELDS = ['photoCount', 'favouriteCount', 'viewCount'];
const MONEY_FIELDS = ['buyerFee', 'shippingCost'];

/**
 * The observation fields of an offer in the one shape `ingestOffers` accepts. Unknown or malformed
 * values are dropped (null), never guessed.
 */
export function observationFields(offer = {}) {
  const out = {};
  for (const [field, limit] of Object.entries(TEXT_LIMITS)) {
    const value = offer[field];
    if (value == null || value === '') continue;
    const text = String(value).trim();
    if (text && text.length <= limit) out[field] = text;
  }
  if (out.conditionText || CONDITION_CLASSES.includes(offer.conditionClass))
    out.conditionClass = CONDITION_CLASSES.includes(offer.conditionClass) ? offer.conditionClass : conditionClass(out.conditionText);
  for (const field of COUNT_FIELDS) {
    const value = Number(offer[field]);
    if (offer[field] != null && Number.isSafeInteger(value) && value >= 0 && value < 1e9) out[field] = value;
  }
  for (const field of MONEY_FIELDS) {
    const value = Number(offer[field]);
    if (offer[field] != null && Number.isSafeInteger(value) && value >= 0 && value <= 10_000_000) out[field] = value;
  }
  if (typeof offer.sellerBusiness === 'boolean') out.sellerBusiness = offer.sellerBusiness;
  if (offer.listedAt && !Number.isNaN(Date.parse(offer.listedAt))) out.listedAt = new Date(offer.listedAt).toISOString();
  return out;
}

/** Saves a raw snapshot when this listing (of this kind: list or detail) looks different from the last one. */
export function saveRawSnapshot(repository, offerId, kind, raw, at) {
  const snapshot = raw && typeof raw === 'object' && 'payload' in raw && 'digest' in raw ? raw : rawSnapshot(raw);
  if (!snapshot) return false;
  const db = repository.database;
  const last = db
    .prepare('SELECT digest FROM offer_raw_snapshots WHERE offer_id=? AND kind=? ORDER BY observed_at DESC, id DESC LIMIT 1')
    .get(offerId, kind);
  if (last?.digest === snapshot.digest) return false;
  db.prepare(
    'INSERT INTO offer_raw_snapshots(offer_id,kind,digest,payload,truncated,observed_at) VALUES(?,?,?,?,?,?)',
  ).run(offerId, kind, snapshot.digest, snapshot.payload, Number(snapshot.truncated), at);
  return true;
}

const BACKFILL_KEY = 'offer_condition_backfill_v1';

/**
 * One-time job: condition of offers whose detail page was read before migration 124 (Allegro
 * Lokalnie, Tezeusz; `offer_enrichment.facts_json.condition`).
 */
export function backfillConditionsFromEnrichment(repository, { now = () => new Date() } = {}) {
  const db = repository.database;
  if (db.prepare('SELECT 1 FROM app_preferences WHERE key=?').get(BACKFILL_KEY)) return { skipped: true };
  const rows = db
    .prepare(
      `SELECT o.id, json_extract(e.facts_json,'$.condition') AS condition FROM offers o JOIN offer_enrichment e ON e.offer_id=o.id
       WHERE o.condition_text IS NULL AND json_valid(e.facts_json) AND json_type(e.facts_json,'$.condition')='text'`,
    )
    .all();
  let updated = 0;
  repository.transaction(() => {
    const update = db.prepare('UPDATE offers SET condition_text=?, condition_class=? WHERE id=? AND condition_text IS NULL');
    for (const row of rows) {
      const text = String(row.condition).trim().slice(0, 200);
      if (!text) continue;
      updated += Number(update.run(text, conditionClass(text), row.id).changes);
    }
    db.prepare(
      'INSERT INTO app_preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at',
    ).run(BACKFILL_KEY, JSON.stringify({ updated }), now().toISOString());
  });
  return { skipped: false, updated };
}
