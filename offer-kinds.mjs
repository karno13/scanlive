// What kind of offer a listing is, from where it is sold: a new book in a shop, a second-hand copy
// from an antiquarian bookshop, or a private person's copy. Prices of these three do not compare:
// a new Empik book, an antiquarian copy and a Vinted copy of the same edition differ by design.
// One rule table gives both the JavaScript answer and the SQL expression used by price statistics.

export const OFFER_KINDS = ['new_shop', 'antiquarian', 'private'];
export const OFFER_KIND_LABELS = {
  new_shop: 'Nowe w sklepie',
  antiquarian: 'Antykwariat',
  private: 'Prywatne egzemplarze',
};

// Order matters: the first matching rule wins. `seller` is matched against the shop's name (Empik
// Marketplace sellers such as "Antykwariat i Księgarnia Tezeusz").
const RULES = [
  { sources: ['Tezeusz.pl'], kind: 'antiquarian' },
  { sources: ['Empik'], seller: 'antykw', kind: 'antiquarian' },
  { sources: ['Empik', 'Dedalus.pl'], kind: 'new_shop' },
  { sources: ['Vinted', 'OLX', 'Allegro Lokalnie', 'Allegro'], kind: 'private' },
];

/** Kind of one offer; unknown sources count as private copies (marketplaces are added more often). */
export function offerKind({ source, sellerName = null } = {}) {
  const seller = String(sellerName ?? '').toLowerCase();
  for (const rule of RULES)
    if (rule.sources.includes(source) && (!rule.seller || seller.includes(rule.seller)))
      return rule.kind;
  return 'private';
}

const quote = (text) => `'${String(text).replace(/'/g, "''")}'`;
/** The same rules as an SQL CASE over an offers row aliased `alias`. */
export function offerKindSql(alias = 'o') {
  const cases = RULES.map((rule) => {
    const source = `${alias}.source IN (${rule.sources.map(quote).join(',')})`;
    const seller = rule.seller
      ? ` AND lower(coalesce(${alias}.seller_name,'')) LIKE ${quote('%' + rule.seller + '%')}`
      : '';
    return `WHEN ${source}${seller} THEN ${quote(rule.kind)}`;
  });
  return `(CASE ${cases.join(' ')} ELSE 'private' END)`;
}
