// Data repairs at start-up. Most of them fix data saved before a rule existed: they run once and
// leave a flag in app_preferences (the pattern of `bibliography_upgrade_v1`); a job whose rules can
// change later carries a version in its key, so a new rule runs it once more. Only what has to run
// on every start does so, each with the reason.
import { upgradeCatalogBibliography } from './catalog-bibliography.mjs';
import { mergeWorkGroup } from './trading-api.mjs';
import { findDuplicateWorkGroups } from './work-grouping.mjs';
import { reviewAutomaticBundleMatches } from './bundle-detection.mjs';
import { ensureStarterProfiles } from './starter-profiles.mjs';
import {
  rejectRepeatsOfRejectedOffers,
  undoUnconfirmedRepeatRejections,
} from './rejected-offers.mjs';
import { rejectForeignEditions } from './language-policy.mjs';
import { normalizeStoredPublishers, PUBLISHER_RULES_VERSION } from './publisher-names.mjs';
import { applyNameAliases, loadNameAliases } from './name-aliases.mjs';
import { backfillConditionsFromEnrichment } from './offer-observations.mjs';
import { loadUniverses } from './universes.mjs';

/** Runs `job` once per `key`; the flag stores what it reported. */
export function runOnce(repository, key, job, { now = () => new Date() } = {}) {
  const db = repository.database;
  if (db.prepare('SELECT 1 FROM app_preferences WHERE key=?').get(key)) return { skipped: true };
  const report = job() ?? {};
  db.prepare(
    'INSERT INTO app_preferences(key,value_json,updated_at) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET value_json=excluded.value_json, updated_at=excluded.updated_at',
  ).run(key, JSON.stringify(report), now().toISOString());
  return report;
}

function mergeAutomaticDuplicates(repository) {
  const manual = new Set(
    repository.database
      .prepare("SELECT id FROM works WHERE verification_status='manual'")
      .all()
      .map((row) => row.id),
  );
  let merged = 0;
  for (const group of findDuplicateWorkGroups(repository)) {
    if (group.works.some((work) => manual.has(work.id))) continue;
    try {
      const sources = group.works.map((work) => work.id).filter((id) => id !== group.targetId);
      merged += mergeWorkGroup(repository, group.targetId, sources).merged.length;
    } catch (error) {
      console.error('AUTOMATIC_WORK_MERGE_SKIPPED', group.key, error?.message ?? error);
    }
  }
  return merged;
}

export function runStartupJobs(repository, { now = () => new Date(), env = process.env } = {}) {
  const report = {};
  // Every start — state held in memory: universe names and the operator's publisher / series merges
  // are read by title folding and by normalizePublisher on every write.
  loadUniverses(repository);
  loadNameAliases(repository);

  // Once (own flag inside): editions upgraded from their stored BN MARC records; the clean titles
  // reveal reprints that the glued BN titles hid, which are joined right after the upgrade.
  const upgrade = upgradeCatalogBibliography(repository, { now });
  if (!upgrade.skipped) report.merged = mergeAutomaticDuplicates(repository);
  // Once per rule version (own flags inside): automatic matches of set listings back to review.
  report.bundles = reviewAutomaticBundleMatches(repository, { now });
  // Once: automatic repeat-rejections of the first rule version (8.11) that the fixed rule does not
  // confirm go back to identification; then copies of rejected offers saved before the rule.
  // Afterwards new offers are checked when they are saved, existing ones after each rejection.
  report.repeatsUndone = runOnce(
    repository,
    'repeat_rejections_undo_v1',
    () => undoUnconfirmedRepeatRejections(repository, { now }),
    { now },
  );
  report.repeats = runOnce(
    repository,
    'repeat_rejections_v1',
    () => rejectRepeatsOfRejectedOffers(repository, { now }),
    { now },
  );
  // Once: foreign editions found before "Tylko polskie wydania"; afterwards every identification
  // pass and switching the option on do it.
  report.foreign = runOnce(
    repository,
    'foreign_editions_v1',
    () => rejectForeignEditions(repository, { now }),
    { now },
  );
  // Once per spelling-rule version: every write path normalizes publishers, so stored names need a
  // pass only when the rules in publisher-names.mjs change (bump PUBLISHER_RULES_VERSION).
  report.publishers = runOnce(
    repository,
    `publisher_names_v${PUBLISHER_RULES_VERSION}`,
    () => normalizeStoredPublishers(repository, { now }),
    { now },
  );
  // Every start — series names are written by BN reads and by the listing inference without the
  // alias table; this one pass applies the operator's merges to them (idempotent, one query each).
  report.aliases = applyNameAliases(repository, { now });
  // Once (own flag inside): starter scan profiles for an empty catalogue; deleted ones stay deleted.
  if (String(env.BOOKFLIP_STARTER_PROFILES ?? '1') !== '0') ensureStarterProfiles(repository);
  // Once (own flag inside): condition of offers whose page was read before migration 124.
  report.conditions = backfillConditionsFromEnrichment(repository, { now });
  // Not here any more: cycle and volume from listing titles (edition-series.mjs) are recomputed
  // every ten minutes by the server, the first time right after start.
  return report;
}
