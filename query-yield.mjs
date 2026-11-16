// @ts-check
// Offline phrase analysis on saved scan results: how much each query brings
// (offers, offers no other query found, identified offers) and which phrases,
// derived from identified editions, would cover saved offers the current
// queries do not. Read-only; never sends a request.
import { normalizeSearch, searchAliases } from './search-policy.mjs';

const tokens = (s) => normalizeSearch(s).split(' ').filter(Boolean);
/** True when every token of `phrase` occurs as a whole word in `title`. */
export function phraseCovers(phrase, title) {
  const p = tokens(phrase);
  if (!p.length) return false;
  const t = ' ' + normalizeSearch(title) + ' ';
  return p.every((x) => t.includes(' ' + x + ' '));
}
/** Title without a subtitle: cut at ':', ' - ', ' – ', '.', '(' or '/'. */
export function titleCore(title) {
  const core = String(title || '')
    .split(/\s*[:(/]\s*|\s+[-–—]\s+|\.\s+/)[0]
    .trim();
  return core.length >= 3 ? core : String(title || '').trim();
}
const surname = (name) => {
  const n = String(name || '').trim();
  if (n.includes(',')) return n.split(',')[0].trim();
  const parts = n.split(/\s+/);
  return parts[parts.length - 1] || '';
};

/**
 * @param {import('node:sqlite').DatabaseSync} db
 * @param {{ queries?: string[], minOffers?: number, limit?: number }} [options]
 */
export function queryYieldReport(db, { queries, minOffers = 5, limit = 40 } = {}) {
  const rows = /** @type {any[]} */ (
    db
      .prepare(
        `SELECT q.query, o.id offer_id, o.original_title title, m.edition_id
         FROM offer_queries q JOIN offers o ON o.id = q.offer_id
         LEFT JOIN offer_matches m ON m.offer_id = o.id AND m.status = 'active'`,
      )
      .all()
  );
  const queryKey = (q) => normalizeSearch(q);
  const allQueries = new Map();
  for (const r of rows)
    if (!allQueries.has(queryKey(r.query))) allQueries.set(queryKey(r.query), r.query);
  const current = (queries?.length ? queries : [...allQueries.values()]).filter(Boolean);
  const currentKeys = new Set(current.map(queryKey));

  /** @type {Map<string, { title: string, edition: string | null, queries: Set<string> }>} */
  const offers = new Map();
  for (const r of rows) {
    if (!currentKeys.has(queryKey(r.query))) continue;
    const o = offers.get(r.offer_id) || {
      title: r.title,
      edition: r.edition_id,
      queries: new Set(),
    };
    o.queries.add(queryKey(r.query));
    offers.set(r.offer_id, o);
  }

  const perQuery = current.map((query) => {
    const key = queryKey(query);
    let found = 0,
      unique = 0,
      identified = 0,
      uniqueIdentified = 0;
    const editions = new Set();
    for (const o of offers.values()) {
      if (!o.queries.has(key)) continue;
      found++;
      const only = o.queries.size === 1;
      if (only) unique++;
      if (o.edition) {
        identified++;
        editions.add(o.edition);
        if (only) uniqueIdentified++;
      }
    }
    return {
      query,
      offers: found,
      unique,
      identified,
      uniqueIdentified,
      editions: editions.size,
      duplicateShare: found ? Math.round((1 - unique / found) * 100) / 100 : 0,
    };
  });
  const drop = perQuery.filter((q) => q.offers >= minOffers && q.unique === 0).map((q) => q.query);
  // Many offers, almost none identified: the phrase mostly pulls in noise.
  const noisy = perQuery
    .filter((q) => q.offers >= minOffers * 4 && q.identified / q.offers < 0.05)
    .map((q) => q.query);

  // Candidates come from identified editions only (ISBN-backed facts).
  const editionIds = [...new Set([...offers.values()].map((o) => o.edition).filter(Boolean))];
  /** @type {Map<string, { phrase: string, kind: string, from: Set<string> }>} */
  const candidates = new Map();
  const add = (phrase, kind, query) => {
    const p = String(phrase || '')
      .replace(/\s+/g, ' ')
      .trim();
    const key = normalizeSearch(p);
    if (key.length < 3 || p.length > 120 || currentKeys.has(key)) return;
    const c = candidates.get(key) || { phrase: p, kind, from: new Set() };
    c.from.add(query);
    candidates.set(key, c);
  };
  const editionStmt = db.prepare('SELECT title, subtitle FROM editions WHERE id = ?');
  const authorStmt = db.prepare(
    `SELECT p.name FROM edition_contributors c JOIN persons p ON p.id = c.person_id
     WHERE c.edition_id = ? AND c.role = 'author' ORDER BY c.position LIMIT 1`,
  );
  const seriesStmt = db.prepare(
    `SELECT name, volume FROM edition_series WHERE edition_id = ? AND kind IN ('universe','cycle')`,
  );
  for (const id of editionIds) {
    const e = /** @type {any} */ (editionStmt.get(id));
    if (!e) continue;
    const via = [...offers.values()].find((o) => o.edition === id);
    const from = via ? allQueries.get([...via.queries][0]) || '' : '';
    const core = titleCore(e.title);
    if (core !== e.title.trim() || e.subtitle) add(core, 'bez podtytułu', from);
    const author = /** @type {any} */ (authorStmt.get(id));
    const last = author ? surname(author.name) : '';
    if (last.length >= 3) add(`${last} ${core}`, 'autor + tytuł', from);
    for (const s of /** @type {any[]} */ (seriesStmt.all(id))) {
      add(s.name, 'seria / uniwersum', from);
      if (s.volume != null) add(`${s.name} tom ${s.volume}`, 'konkretny tom', from);
    }
  }
  for (const q of current) for (const alias of searchAliases(q)) add(alias, 'inna nazwa', q);

  const identifiedOffers = [...offers.values()].filter((o) => o.edition);
  const suggestions = [...candidates.values()]
    .map((c) => {
      let covers = 0,
        beyond = 0;
      const editions = new Set();
      for (const o of identifiedOffers) {
        if (!phraseCovers(c.phrase, o.title)) continue;
        covers++;
        editions.add(o.edition);
        if (!current.some((q) => phraseCovers(q, o.title))) beyond++;
      }
      return {
        phrase: c.phrase,
        kind: c.kind,
        from: [...c.from].slice(0, 3),
        covers,
        beyond,
        editions: editions.size,
      };
    })
    .filter((s) => s.covers > 0 || s.kind === 'inna nazwa')
    .sort((a, b) => b.beyond - a.beyond || b.covers - a.covers || a.phrase.localeCompare(b.phrase))
    .slice(0, limit);

  return {
    totals: {
      queries: current.length,
      offers: offers.size,
      identified: identifiedOffers.length,
      foundByMoreThanOne: [...offers.values()].filter((o) => o.queries.size > 1).length,
    },
    perQuery: perQuery.sort(
      (a, b) => b.uniqueIdentified - a.uniqueIdentified || b.offers - a.offers,
    ),
    drop,
    noisy,
    suggestions,
  };
}
