// Universe names (Świat Dysku, Warhammer, Warcraft, Dragonlance, Forgotten Realms) and their
// variant spellings, in one place. They are on every cover and in every listing, so many parts of
// the app need them: to strip branding from titles, to tell a universe from a story cycle, to widen
// a search. Each list below is the one a module used before; their users are named.

// bn-marc.mjs: series statements that name a universe or a franchise rather than a story cycle.
export const UNIVERSE_SERIES =
  /^(?:discworld(?: series)?|swiat dysku|warhammer(?: 40 ?000| fantasy| chronicles| age of sigmar)?(?: black library)?|age of sigmar|world of warcraft|warcraft|blizzard legends|dragonlance(?: saga)?|forgotten realms|zapomniane krainy)$/;

// catalog-series.mjs: universe names that appear on covers / in BN series statements, with the label shown.
export const SERIES_UNIVERSES = [
  [/\b(?:discworld|swiat dysku)\b/, 'Świat Dysku'],
  [/\bwarcraft\b/, 'Warcraft'],
  [/\bwarhammer\b|\bage of sigmar\b|\bherezja horusa\b|\bczarna biblioteka\b/, 'Warhammer'],
  [/\bdragonlance\b/, 'Dragonlance'],
  [/\bforgotten realms\b|\bdrizzt/, 'Forgotten Realms'],
];
// catalog-series.mjs: brand words that are not a cycle on their own ("Discworld series t. 14").
export const BRAND_ONLY = /^(?:discworld(?: series)?|swiat dysku|warhammer(?: 40[ .,]?000| fantasy| chronicles)?|world of warcraft|warcraft|dragonlance(?: saga)?|forgotten realms)$/;

// edition-series.mjs: universe names that sit next to the cycle in listings (folded, word lists).
export const LISTING_UNIVERSE_PHRASES = [
  'warhammer 40 000', 'warhammer 40000', 'warhammer 40k', 'warhammer fantasy', 'warhammer', 'wh40k', 'w40k', '40k', '40000', '40 000',
  'world of warcraft', 'warcraft', 'diablo', 'starcraft', 'dragonlance', 'forgotten realms', 'swiat dysku', 'discworld', 'black library',
];

// offer-editions.mjs: universe names in listing text (regex sources, matched as whole words).
export const LISTING_UNIVERSE_PATTERNS = [
  'warhammer(?:\\s*(?:40\\s*[.,]?\\s*000|40\\s*k|40k|fantasy|age of sigmar|horus heresy))?',
  '40\\s*k',
  '40[.,]?000',
  'w40k',
  'world of warcraft',
  'warcraft',
  'dragonlance',
  'forgotten realms',
  'świat dysku',
  'swiat dysku',
  'discworld',
];

// rejected-offers.mjs: universe words that never tell one product from another.
export const UNIVERSE_WORDS = 'world of the warcraft warhammer 40k 40000 000 fantasy dragonlance forgotten realms swiat dysku discworld star wars'.split(' ');

// search-policy.mjs: names a search for one also finds (retrieval only, never identity).
export const SEARCH_FAMILIES = [
  ['Warhammer', 'Warhammer 40,000', 'WH40K', 'Warhammer 40K'],
  ['Herezja Horusa', 'Horus Heresy'],
  ['Warcraft', 'World of Warcraft'],
  ['Forgotten Realms', 'Zapomniane Krainy'],
];
// search-policy.mjs: words a discovery phrase of a universe accepts in listing titles.
export function topicTerms(category) {
  return category.includes('warcraft')
    ? ['Warcraft', 'World of Warcraft']
    : category.includes('warhammer') || category.includes('horus') || category.includes('herezja')
      ? ['Warhammer', 'Warhammer 40,000', 'WH40K', 'Warhammer 40K', 'Horus', 'Horus Heresy', 'Herezja Horusa']
      : [];
}

// title-consistency.mjs: the same universe written two ways on covers and in BN records.
export const UNIVERSE_SYNONYMS = [
  ['discworld', 'swiat dysku'],
  ['warhammer', '40000 40k'],
  ['horus heresy', 'herezja horusa'],
  ['forgotten realms', 'drizzt'],
];

// title-proposals.mjs: brand words that appear on the cover but rarely in the catalogued title.
export const BRAND_WORDS = ['warhammer', '40000', '40k', 'warcraft', 'world', 'dragonlance', 'forgotten', 'realms', 'swiat', 'dysku', 'discworld'];

// work-grouping.mjs: a universe before ":" / "." or in brackets after the title is cover branding.
export const UNIVERSE_PREFIX =
  /^\s*(?:world of warcraft|warcraft|warhammer(?: 40[ ,.]?000| 40k)?|dragonlance|forgotten realms|świat dysku)\s*[:.]\s+/i;
export const UNIVERSE_SUFFIX =
  /\s*[([](?:world of warcraft|warcraft|warhammer(?: 40[ ,.]?000| 40k)?|dragonlance|forgotten realms|świat dysku|swiat dysku|discworld)[)\]]\s*$/i;
// work-grouping.mjs: an original title that is only a universe name names no single work.
export const BRAND_ONLY_ORIGINAL = /^(?:world of warcraft|warcraft|warhammer(?: 40 ?000)?|discworld(?: series)?|dragonlance|forgotten realms)$/;
