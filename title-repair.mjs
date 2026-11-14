// @ts-check
// Catalogue titles that came in shouted or without Polish letters ("PROSPERO W PLOMIENIACH",
// "VULKAN ZYJE" from Open Library) are rewritten from a listing assigned to the same edition,
// but only when the listing contains exactly the same words once diacritics and case are
// ignored. Nothing is guessed: no listing with the same words, no change.
import { fold } from './title-proposals.mjs';

const hasLetters = (text) => /\p{L}/u.test(text);
const isShouted = (text) =>
  hasLetters(text) && text === text.toLocaleUpperCase('pl') && /\p{Lu}{3}/u.test(text);
const lacksPolish = (text) => !/[ąćęłńóśźżĄĆĘŁŃÓŚŹŻ]/.test(text);

/**
 * `title` with the letters of the same words in `listing` (Polish diacritics), keeping the
 * title's own punctuation and spacing; null when the listing does not have those words in a row.
 */
export function titleFromListing(title, listing) {
  const own = [...String(title).matchAll(/[\p{L}\p{N}]+/gu)];
  if (!own.length) return null;
  const wanted = own.map((match) => fold(match[0]));
  const words = String(listing ?? '').match(/[\p{L}\p{N}]+/gu) || [];
  const folded = words.map((word) => fold(word));
  const shouted = isShouted(title);
  for (let start = 0; start + wanted.length <= words.length; start++) {
    if (!wanted.every((word, index) => folded[start + index] === word)) continue;
    let out = '';
    let last = 0;
    own.forEach((match, index) => {
      const source = words[start + index];
      const mine = match[0];
      let word;
      if (shouted)
        word = source.length > 1 && isShouted(source) ? source.toLocaleLowerCase('pl') : source;
      else if (source.length === mine.length)
        // Same letters: keep the stored case, take the listing's diacritics.
        word = [...source]
          .map((char, i) =>
            mine[i] === mine[i].toLocaleUpperCase('pl')
              ? char.toLocaleUpperCase('pl')
              : char.toLocaleLowerCase('pl'),
          )
          .join('');
      else word = mine;
      out += String(title).slice(last, match.index) + word;
      last = match.index + mine.length;
    });
    out += String(title).slice(last);
    return out.charAt(0).toLocaleUpperCase('pl') + out.slice(1);
  }
  return null;
}

/** Better title for a stored one, from its listings, or null when there is nothing safe. */
export function repairedTitle(title, listings = []) {
  const text = String(title ?? '').trim();
  if (!text || !(isShouted(text) || lacksPolish(text))) return null;
  for (const listing of listings) {
    const candidate = titleFromListing(text, listing);
    if (!candidate || candidate === text) continue;
    // Only an improvement: Polish letters gained, or a shouted title calmed down.
    if (
      (lacksPolish(text) && !lacksPolish(candidate)) ||
      (isShouted(text) && !isShouted(candidate))
    )
      return candidate;
  }
  // No listing helps: at least stop shouting.
  if (isShouted(text)) return text.charAt(0) + text.slice(1).toLocaleLowerCase('pl');
  return null;
}

/** Rewrites such work and edition titles; returns how many rows changed. */
export function repairCatalogTitles(repository, now = () => new Date()) {
  const { database } = repository;
  const listingsOf = database.prepare(
    `SELECT DISTINCT o.original_title FROM offer_matches m JOIN offers o ON o.id=m.offer_id
     JOIN editions e ON e.id=m.edition_id WHERE m.status='active' AND (e.id=? OR e.work_id=?)`,
  );
  let changed = 0;
  const at = now().toISOString();
  for (const edition of database.prepare('SELECT id, work_id, title FROM editions').all()) {
    const better = repairedTitle(
      edition.title,
      listingsOf.all(edition.id, '').map((row) => row.original_title),
    );
    if (!better) continue;
    database
      .prepare('UPDATE editions SET title=?, updated_at=? WHERE id=?')
      .run(better, at, edition.id);
    changed += 1;
  }
  for (const work of database.prepare('SELECT id, title FROM works').all()) {
    const better = repairedTitle(
      work.title,
      listingsOf.all('', work.id).map((row) => row.original_title),
    );
    if (!better) continue;
    database.prepare('UPDATE works SET title=?, updated_at=? WHERE id=?').run(better, at, work.id);
    changed += 1;
  }
  return changed;
}
