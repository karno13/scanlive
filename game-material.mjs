// Listings that are not books for the Polish catalogue: Games Workshop rules and campaign books
// (Codex, Battletome, Arcane Journal…) and editions explicitly in another language. No Polish
// bibliographic source describes them, so they would wait in review forever. The resolver files
// them under their own tab, where the operator rejects them in bulk (or keeps one by hand).
// Polish RPG handbooks ("Warhammer Fantasy Roleplay. Podręcznik podstawowy") are real Polish
// books that BN knows: they are not matched here.
import { fold } from './title-proposals.mjs';

const RULEBOOK =
  /(?:^|\s)(?:codex|battletome|rulebook|rule book|arcane journal|general s handbook|generals handbook|getting started|chapter approved|datacards?|index cards|campaign book|boarding actions|white dwarf|dawnbringers|crusade campaign|grand tournament|core rules)(?:\s|$)/;
const FOREIGN = /(?:^|\s)(?:english|angielski|angielska|angielskim|po angielsku|wersja angielska|deutsch|german)(?:\s|$)|\((?:eng|en)\)|\[(?:eng|en)\]/;

/** 'game_rulebook', 'foreign_edition' or null. */
export function notCatalogueMaterial(title) {
  const text = String(title ?? '');
  const folded = ` ${fold(text)} `;
  if (RULEBOOK.test(folded)) return 'game_rulebook';
  if (FOREIGN.test(folded) || /\((?:eng|en)\)|\[(?:eng|en)\]/i.test(text)) return 'foreign_edition';
  return null;
}
