// Background work that follows every identification pass: offer detail pages, title proposals,
// ISBN lookups, set compositions, offer lifecycle, edition gaps and series. Each job runs at most
// once at a time, has its own pacing and pauses a source that blocked it.
import { assignEmpikReferences } from './empik-references.mjs';
import { applyRejectionRules } from './rejection-rules.mjs';
import { rejectOffersOfRemovedWorks } from './catalog-removal.mjs';
import { enrichOffers } from './offer-enrichment.mjs';
import { DETAIL_SOURCES } from './source-details.mjs';
import { checkOfferLifecycle } from './offer-lifecycle.mjs';
import { fillSetsFromDescriptions } from './set-descriptions.mjs';
import { fillShippingCosts } from './shipping-backfill.mjs';
import { lookupUnknownIsbns } from './isbn-lookups.mjs';
import { rejectForeignEditions } from './language-policy.mjs';
import { refreshProposals } from './title-proposals.mjs';
import { offerEditionDraft, recheckOfferEditions } from './offer-editions.mjs';
import { fillEditionGaps } from './edition-gaps.mjs';
import { inferListingSeries } from './edition-series.mjs';
import { recordProgress } from './app-runtime.mjs';

// Reads detail pages of shops that publish the ISBN in structured data, in small paced batches,
// before the resolver runs so that new evidence is used in the same pass.
// A source that answered HTTP 429 or a challenge is left alone for half an hour. Without this the
// five-second scheduler kept it throttled and every poll used up another offer's attempt.
const enrichmentPausedUntil = new Map();
const ENRICHMENT_PAUSE_MS = 30 * 60_000;
async function enrichPendingOffers(catalogStore) {
  if (
    String(process.env.BOOKFLIP_DETAIL_ENRICHMENT ?? '1') === '0' ||
    !catalogStore.repository?.database
  )
    return null;
  try {
    const now = Date.now();
    const sources = [...DETAIL_SOURCES].filter(
      (source) => !(enrichmentPausedUntil.get(source) > now),
    );
    if (!sources.length) return null;
    const report = await enrichOffers(catalogStore.repository, { limit: 10, sources });
    for (const source of report.paused ?? [])
      enrichmentPausedUntil.set(source, Date.now() + ENRICHMENT_PAUSE_MS);
    if (report.checked) recordProgress({ type: 'detail_enrichment', ...report });
    return report;
  } catch (error) {
    recordProgress({
      type: 'detail_enrichment_error',
      code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'ENRICHMENT_ERROR',
    });
    return null;
  }
}

// Title proposals call the national catalogue (rate limited), so they run beside the resolver
// in small batches and never delay it.
let runningProposals = null;
let proposalsPausedUntil = 0;
function scheduleProposalRefresh(catalogStore) {
  if (runningProposals || String(process.env.BOOKFLIP_DETAIL_ENRICHMENT ?? '1') === '0') return;
  if (Date.now() < proposalsPausedUntil) return;
  if (typeof catalogStore.findIsbnsByTitle !== 'function' || !catalogStore.repository?.database)
    return;
  runningProposals = refreshProposals(catalogStore, { limit: 4 })
    .then((report) => {
      if (report.computed) recordProgress({ type: 'title_proposals', ...report });
      // The national catalogue is down or throttling: do not retry every few seconds.
      if (report.unavailable) proposalsPausedUntil = Date.now() + 10 * 60_000;
    })
    .catch((error) =>
      recordProgress({
        type: 'title_proposals_error',
        code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'PROPOSAL_ERROR',
      }),
    )
    .finally(() => {
      runningProposals = null;
    });
}

// Offers that scans stopped returning: their own page says sold / reserved / gone. A few per
// ten minutes, through the shared per-source pacing gate.
let runningLifecycle = null;
let lifecycleNextAt = 0;
// A source that answered a challenge or HTTP 429/403 to a page check is left alone for half an hour.
const lifecyclePausedUntil = new Map();
// ISBNs that BN, Open Library and e-ISBN do not know: searched by title on lubimyczytac.pl (two
// per two minutes, paced); a page with the same ISBN fills the "create edition" draft.
let runningIsbnLookups = null;
let isbnLookupsNextAt = 0;
function scheduleIsbnLookups(catalogStore) {
  if (
    runningIsbnLookups ||
    Date.now() < isbnLookupsNextAt ||
    String(process.env.BOOKFLIP_DETAIL_ENRICHMENT ?? '1') === '0'
  )
    return;
  if (!catalogStore.repository?.database) return;
  isbnLookupsNextAt = Date.now() + 2 * 60_000;
  const repository = catalogStore.repository;
  runningIsbnLookups = lookupUnknownIsbns(repository, {
    draftOf: (jobId) => offerEditionDraft(repository, jobId),
    limit: 2,
  })
    .then((report) => {
      if (report.paused) isbnLookupsNextAt = Date.now() + 30 * 60_000;
      if (report.checked) recordProgress({ type: 'isbn_lookups', ...report });
    })
    .catch((error) =>
      recordProgress({
        type: 'isbn_lookups_error',
        code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'ISBN_LOOKUP_ERROR',
      }),
    )
    .finally(() => {
      runningIsbnLookups = null;
    });
}

// Set listings: their description is read (a few every three minutes, paced per source) and an
// empty set gets the books it names. A throttled or blocked source is left alone for half an hour.
let runningSetDescriptions = null;
let setDescriptionsNextAt = 0;
function scheduleSetDescriptions(catalogStore) {
  if (
    runningSetDescriptions ||
    Date.now() < setDescriptionsNextAt ||
    String(process.env.BOOKFLIP_DETAIL_ENRICHMENT ?? '1') === '0'
  )
    return;
  if (!catalogStore.repository?.database) return;
  setDescriptionsNextAt = Date.now() + 3 * 60_000;
  runningSetDescriptions = fillSetsFromDescriptions(catalogStore.repository, { limit: 4 })
    .then((report) => {
      if (report.paused) setDescriptionsNextAt = Date.now() + 30 * 60_000;
      if (report.checked) recordProgress({ type: 'set_descriptions', ...report });
    })
    .catch((error) =>
      recordProgress({
        type: 'set_descriptions_error',
        code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'SET_DESCRIPTION_ERROR',
      }),
    )
    .finally(() => {
      runningSetDescriptions = null;
    });
}

// Vinted offers saved before the delivery price was read: a few listing pages every three minutes.
let runningShipping = null;
let shippingNextAt = 0;
function scheduleShippingBackfill(catalogStore) {
  if (
    runningShipping ||
    Date.now() < shippingNextAt ||
    String(process.env.BOOKFLIP_DETAIL_ENRICHMENT ?? '1') === '0' ||
    !catalogStore.repository?.database
  )
    return;
  shippingNextAt = Date.now() + 3 * 60_000;
  runningShipping = fillShippingCosts(catalogStore.repository, { limit: 6 })
    .then((report) => {
      if (report.paused) shippingNextAt = Date.now() + 30 * 60_000;
      if (report.checked) recordProgress({ type: 'shipping_backfill', ...report });
    })
    .catch((error) =>
      recordProgress({
        type: 'shipping_backfill_error',
        code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'SHIPPING_BACKFILL_ERROR',
      }),
    )
    .finally(() => {
      runningShipping = null;
    });
}

function scheduleLifecycleCheck(catalogStore) {
  if (
    runningLifecycle ||
    Date.now() < lifecycleNextAt ||
    String(process.env.BOOKFLIP_OFFER_LIFECYCLE ?? '1') === '0'
  )
    return;
  if (!catalogStore.repository?.database) return;
  lifecycleNextAt = Date.now() + 10 * 60_000;
  runningLifecycle = checkOfferLifecycle(catalogStore.repository, {
    limit: 20,
    skipSources: [...lifecyclePausedUntil]
      .filter(([, until]) => until > Date.now())
      .map(([source]) => source),
  })
    .then((report) => {
      for (const source of report.blockedSources ?? [])
        lifecyclePausedUntil.set(source, Date.now() + 30 * 60_000);
      // Catch up on a backlog of due "left the scans" offers: next round in 2 minutes, not 10.
      if (report.backlog) lifecycleNextAt = Math.min(lifecycleNextAt, Date.now() + 2 * 60_000);
      if (report.checked || report.errors || report.listingConfirmed)
        recordProgress({ type: 'offer_lifecycle', ...report });
    })
    .catch((error) =>
      recordProgress({
        type: 'offer_lifecycle_error',
        code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'LIFECYCLE_ERROR',
      }),
    )
    .finally(() => {
      runningLifecycle = null;
    });
}

// Editions without publisher or year: e-ISBN is asked about a few per ten minutes (paced by its
// own limiter); empty fields only, never a hand-edited edition, undone as a batch.
let runningEditionGaps = null;
let editionGapsNextAt = 0;
function scheduleEditionGaps(catalogStore) {
  if (
    runningEditionGaps ||
    Date.now() < editionGapsNextAt ||
    String(process.env.BOOKFLIP_EDITION_GAPS ?? '1') === '0' ||
    typeof catalogStore.lookupGapRecords !== 'function' ||
    !catalogStore.repository?.database
  )
    return;
  editionGapsNextAt = Date.now() + 10 * 60_000;
  runningEditionGaps = fillEditionGaps(catalogStore, { limit: 6 })
    .then((report) => {
      if (report.checked) recordProgress({ type: 'edition_gaps', ...report });
    })
    .catch((error) =>
      recordProgress({
        type: 'edition_gaps_error',
        code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'EDITION_GAPS_ERROR',
      }),
    )
    .finally(() => {
      runningEditionGaps = null;
    });
}

// Cycle and volume read from listing titles, recomputed every ten minutes (local SQL only).
let listingSeriesNextAt = 0;
function scheduleListingSeries(catalogStore) {
  if (Date.now() < listingSeriesNextAt || !catalogStore.repository?.database) return;
  listingSeriesNextAt = Date.now() + 10 * 60_000;
  try {
    const report = inferListingSeries(catalogStore.repository);
    if (report.works) recordProgress({ type: 'listing_series', ...report });
  } catch (error) {
    recordProgress({
      type: 'listing_series_error',
      code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'LISTING_SERIES_ERROR',
    });
  }
}

// Editions created from listings: BN is asked again about once a week (a few per hour).
let runningOfferEditions = null;
let offerEditionsNextAt = 0;
function scheduleOfferEditionRecheck(catalogStore) {
  if (
    runningOfferEditions ||
    Date.now() < offerEditionsNextAt ||
    typeof catalogStore.lookupIsbn !== 'function'
  )
    return;
  if (!catalogStore.repository?.database) return;
  offerEditionsNextAt = Date.now() + 60 * 60_000;
  runningOfferEditions = recheckOfferEditions(catalogStore, { limit: 5 })
    .then((report) => {
      if (report.checked) recordProgress({ type: 'offer_editions_recheck', ...report });
    })
    .catch((error) =>
      recordProgress({
        type: 'offer_editions_recheck_error',
        code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'RECHECK_ERROR',
      }),
    )
    .finally(() => {
      runningOfferEditions = null;
    });
}

let runningCatalogResolution = null;
export function scheduleCatalogResolution(catalogStore) {
  if (runningCatalogResolution) return runningCatalogResolution;
  const startedAt = performance.now();
  runningCatalogResolution = new Promise((resolve) => setImmediate(resolve))
    .then(() => enrichPendingOffers(catalogStore))
    .then(() => catalogStore.processQueued())
    .then((result) => {
      // Foreign editions found by this pass leave review at once while "Tylko polskie wydania" is on.
      if (catalogStore.repository?.database) {
        rejectForeignEditions(catalogStore.repository);
        // "Odrzucaj takie zawsze" rules (rejection-rules.mjs), on the offers this pass left in review.
        applyRejectionRules(catalogStore.repository);
        // New offers of a work the operator removed from the catalogue leave at once.
        rejectOffersOfRemovedWorks(catalogStore.repository);
        assignEmpikReferences(catalogStore.repository);
      }
      return result;
    })
    .then((result) => {
      // An idle poll every few seconds must not grow the log: record only real work.
      if (result.processed || result.failed)
        recordProgress({
          type: 'catalog_resolution',
          processed: result.processed,
          failed: result.failed || 0,
          durationMs: Math.round(performance.now() - startedAt),
        });
      return result;
    })
    .catch((error) => {
      recordProgress({
        type: 'catalog_resolution_error',
        code: /^[A-Z0-9_]+$/.test(error?.message) ? error.message : 'CATALOG_INTEGRATION_ERROR',
      });
      return null;
    })
    .finally(() => {
      runningCatalogResolution = null;
      scheduleProposalRefresh(catalogStore);
      scheduleLifecycleCheck(catalogStore);
      scheduleSetDescriptions(catalogStore);
      scheduleShippingBackfill(catalogStore);
      scheduleIsbnLookups(catalogStore);
      scheduleOfferEditionRecheck(catalogStore);
      scheduleListingSeries(catalogStore);
      scheduleEditionGaps(catalogStore);
    });
  return runningCatalogResolution;
}
