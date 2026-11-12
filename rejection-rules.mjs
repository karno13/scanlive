// @ts-check
// "Odrzucaj takie zawsze": rules made while rejecting an offer in review — by the seller, by a phrase
// in the title, or by a price threshold. A rule rejects matching offers waiting in review now and
// after every identification pass. Each rejection is its own review_decisions row
// (created_by 'rejection_rule:<id>'), shown in "Ostatnie decyzje" and undone there. Manual
// assignments and sets always win, and an offer whose rule rejection was undone is never rejected by
// a rule again.
import { randomUUID } from 'node:crypto';

export const RULE_KINDS = ['seller', 'phrase', 'price_above', 'price_below'];
export const RULE_AUTHOR_PREFIX = 'rejection_rule:';

/** Lower case, no diacritics, single spaces: phrases match regardless of "Ł/ł", "ę/e". */
export function foldPhrase(text) {
  return String(text ?? '')
    .toLocaleLowerCase('pl')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/ł/g, 'l')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** @param {any} message @param {number} status */
const fail = (message, status = 400) => {
  throw Object.assign(Error(message), { statusCode: status });
};

/** Polish description of a rule, e.g. „sprzedawca anna_k (Vinted)”, „cena powyżej 300,00 zł”. */
export function ruleLabel(rule) {
  const price = (value) => (Number(value) / 100).toFixed(2).replace('.', ',') + ' zł';
  if (rule.kind === 'seller')
    return `sprzedawca ${rule.label || rule.value}${rule.source ? ` (${rule.source})` : ''}`;
  if (rule.kind === 'phrase') return `tytuł zawiera „${rule.label || rule.value}”`;
  if (rule.kind === 'price_above') return `cena powyżej ${price(rule.value)}`;
  return `cena poniżej ${price(rule.value)}`;
}

/**
 * Does the rule match the offer? Prices compare in grosze and PLN only.
 * @param {{ kind: string, source?: string | null, value: string }} rule
 * @param {{ source: string, seller_id?: string | null, original_title?: string | null, current_price?: number | null, currency?: string | null }} offer
 */
export function ruleMatches(rule, offer) {
  if (rule.kind === 'seller')
    return (
      Boolean(offer.seller_id) && offer.seller_id === rule.value && offer.source === rule.source
    );
  if (rule.kind === 'phrase') {
    const title = ' ' + foldPhrase(offer.original_title) + ' ';
    return title.includes(' ' + rule.value + ' ');
  }
  const price = offer.current_price;
  if (price === null || price === undefined || (offer.currency && offer.currency !== 'PLN'))
    return false;
  return rule.kind === 'price_above' ? price > Number(rule.value) : price < Number(rule.value);
}

/** Live rules with how many offers each has rejected. @param {{ database: any }} repository */
export function listRejectionRules(repository) {
  return repository.database
    .prepare(
      `SELECT r.*, (SELECT count(*) FROM review_decisions d WHERE d.created_by=('${RULE_AUTHOR_PREFIX}'||r.id)) AS hits
       FROM rejection_rules r WHERE r.deleted_at IS NULL ORDER BY r.created_at DESC`,
    )
    .all()
    .map((/** @type {any} */ row) => ({
      id: row.id,
      kind: row.kind,
      source: row.source,
      value: row.value,
      label: row.label,
      text: ruleLabel(row),
      hits: Number(row.hits),
      createdAt: row.created_at,
      createdFromOfferId: row.created_from_offer_id,
    }));
}

/**
 * Creates a rule from what the operator chose while rejecting an offer.
 * seller: the offer's own seller (id and source come from the offer); phrase: a part of the title;
 * price_above / price_below: a threshold in zł.
 * @param {{ database: any, transaction: Function }} repository
 * @param {{ kind?: string, value?: unknown, offerId?: string | null }} input
 */
export function createRejectionRule(
  repository,
  input = {},
  { now = () => new Date(), idFactory = randomUUID } = {},
) {
  const kind = String(input.kind ?? '');
  if (!RULE_KINDS.includes(kind)) fail('INVALID_RULE_KIND');
  const db = repository.database;
  const offer = input.offerId
    ? db
        .prepare('SELECT id, source, seller_id, seller_name, original_title FROM offers WHERE id=?')
        .get(String(input.offerId))
    : null;
  if (input.offerId && !offer) fail('OFFER_NOT_FOUND', 404);
  let value;
  let label = null;
  let source = null;
  if (kind === 'seller') {
    if (!offer?.seller_id) fail('SELLER_UNKNOWN', 409);
    value = String(offer.seller_id);
    source = offer.source;
    label = offer.seller_name || String(input.value ?? '').trim() || null;
  } else if (kind === 'phrase') {
    const typed = String(input.value ?? '').trim();
    value = foldPhrase(typed);
    if (value.length < 3) fail('PHRASE_TOO_SHORT');
    if (value.length > 120) fail('PHRASE_TOO_LONG');
    label = typed.slice(0, 200);
  } else {
    const zloty = Number(String(input.value ?? '').replace(',', '.'));
    if (!Number.isFinite(zloty) || zloty <= 0 || zloty > 1_000_000) fail('INVALID_PRICE');
    value = String(Math.round(zloty * 100));
  }
  const id = idFactory();
  const at = now().toISOString();
  return repository.transaction(() => {
    const existing = db
      .prepare(
        "SELECT id FROM rejection_rules WHERE kind=? AND coalesce(source,'')=coalesce(?,'') AND value=? AND deleted_at IS NULL",
      )
      .get(kind, source, value);
    if (existing) return { id: existing.id, created: false };
    db.prepare(
      'INSERT INTO rejection_rules(id,kind,source,value,label,created_from_offer_id,created_at) VALUES(?,?,?,?,?,?,?)',
    ).run(id, kind, source, value, label, offer?.id ?? null, at);
    return { id, created: true };
  });
}

/** Removes a rule (offers it already rejected stay rejected; each can be undone in "Ostatnie decyzje"). */
export function deleteRejectionRule(repository, id, { now = () => new Date() } = {}) {
  const result = repository.database
    .prepare('UPDATE rejection_rules SET deleted_at=? WHERE id=? AND deleted_at IS NULL')
    .run(now().toISOString(), String(id));
  if (!result.changes) fail('RULE_NOT_FOUND', 404);
  return { deleted: true };
}

/**
 * Rejects the offers waiting in review that a live rule matches. Skipped: offers with a manual
 * assignment, offers marked as sets, and offers whose earlier rule rejection the operator undid.
 * @param {{ database: any, transaction: Function }} repository
 * @returns {{ rejected: number, byRule: Record<string, number> }}
 */
export function applyRejectionRules(repository, { now = () => new Date(), ruleIds = null } = {}) {
  const db = repository.database;
  const rules = db
    .prepare('SELECT * FROM rejection_rules WHERE deleted_at IS NULL ORDER BY created_at')
    .all()
    .filter((/** @type {any} */ rule) => !ruleIds || ruleIds.includes(rule.id));
  /** @type {Record<string, number>} */
  const byRule = {};
  if (!rules.length) return { rejected: 0, byRule };
  const rows = db
    .prepare(
      `SELECT j.id AS job_id, o.id AS offer_id, o.source, o.seller_id, o.original_title, o.current_price, o.currency
       FROM identification_jobs j JOIN offers o ON o.id=j.offer_id
       WHERE j.status='review_required'
         AND NOT EXISTS (SELECT 1 FROM offer_matches m WHERE m.offer_id=o.id AND m.status='active' AND m.method IN ('manual','legacy_manual'))
         AND NOT EXISTS (SELECT 1 FROM offer_sets s WHERE s.offer_id=o.id)
         AND NOT EXISTS (SELECT 1 FROM review_decisions d JOIN review_revisions r ON r.decision_id=d.id
                         WHERE d.offer_id=o.id AND d.created_by LIKE '${RULE_AUTHOR_PREFIX}%')`,
    )
    .all();
  const at = now().toISOString();
  const insert = db.prepare(
    `INSERT INTO review_decisions(id,job_id,offer_id,edition_id,action,reason,created_by,created_at) VALUES(?,?,?,NULL,'excluded',?,?,?)`,
  );
  const close = db.prepare(
    `UPDATE identification_jobs SET status='completed', run_after=NULL, lease_token=NULL, lease_expires_at=NULL,
       last_error=NULL, result_json=?, updated_at=? WHERE id=? AND status='review_required'`,
  );
  let rejected = 0;
  repository.transaction(() => {
    for (const row of rows) {
      const rule = rules.find((/** @type {any} */ candidate) => ruleMatches(candidate, row));
      if (!rule) continue;
      const reason = 'Reguła odrzucania: ' + ruleLabel(rule) + '.';
      if (
        !close.run(
          JSON.stringify({
            manualDecision: 'excluded',
            automatic: true,
            rule: rule.id,
            reason,
            decidedAt: at,
          }),
          at,
          row.job_id,
        ).changes
      )
        continue;
      insert.run(
        `rule_${rule.id}_${row.job_id}_${at}`,
        row.job_id,
        row.offer_id,
        reason,
        RULE_AUTHOR_PREFIX + rule.id,
        at,
      );
      byRule[rule.id] = (byRule[rule.id] || 0) + 1;
      rejected++;
    }
  });
  return { rejected, byRule };
}
