// @ts-check
// The one way scanned offers enter the catalogue. Every source adapter, the scan and the tools hand
// over offers in one shape (ScannedOffer); this module turns them into offers, price observations,
// ISBN evidence, raw snapshots and identification jobs. Checked by `npm run typecheck`.
import { createHash } from 'node:crypto';

import { extractOfferISBN } from './isbn.mjs';
import { identifyOffer } from './offer-identity.mjs';
import { requeueForNewEvidence } from './offer-enrichment.mjs';
import { rejectRepeatsOfRejectedOffers } from './rejected-offers.mjs';
import { observationFields, saveRawSnapshot } from './offer-observations.mjs';
import { saveOfferDescription } from './set-descriptions.mjs';

/**
 * An offer as a scan found it. Prices in grosze (integers).
 * @typedef {object} ScannedOffer
 * @property {string} source            Marketplace name ("Vinted", "Empik", …).
 * @property {string} url               Listing address (normalized by identifyOffer).
 * @property {string} title             Listing title as written by the seller / shop.
 * @property {number} price             Price in grosze.
 * @property {string} [currency]        ISO code, PLN when omitted.
 * @property {string} [availability]    'unconfirmed' (seen in results) unless a check said more.
 * @property {string|null} [language]
 * @property {string|null} [isbn]       ISBN as the listing states it.
 * @property {string} [isbnEvidence]    Where that ISBN was read.
 * @property {string|null} [image]      Photo address.
 * @property {string[]} [matchedQueries] Scan phrases that found it.
 * @property {string} [firstSeenAt]
 * @property {string} [lastSeenAt]
 * @property {number} [seenCount]
 * @property {string} [conditionText]   Condition as the source writes it ("Bardzo dobry").
 * @property {'new'|'very_good'|'good'|'satisfactory'|'unknown'} [conditionClass]
 * @property {number} [buyerFee]        Buyer protection fee, grosze.
 * @property {number} [shippingCost]    Grosze.
 * @property {string} [sellerId]
 * @property {string} [sellerName]      Shops only.
 * @property {boolean} [sellerBusiness]
 * @property {number} [photoCount]
 * @property {string} [listedAt]        ISO; approximate when only an age was given.
 * @property {string} [listedAtText]    The age as written ("3 godz.").
 * @property {number} [favouriteCount]
 * @property {number} [viewCount]
 * @property {string} [sourceAvailability] The shop's own availability code ("IN_24_H").
 * @property {object} [rawListing]      The listing object from the result list.
 * @property {object} [rawDetail]       The listing object from its page.
 * @property {string} [listingDescription] The seller's description, read with the page.
 */

/**
 * @typedef {object} IngestReport
 * @property {number} offers
 * @property {number} evidence
 * @property {number} jobs
 * @property {number} skipped
 * @property {number} [requeued]
 * @property {number} [autoRejected]
 * @property {number} [snapshots]
 */

// Marketplaces show joke / placeholder prices (e.g. 10 000 zł for a paperback); such a value is
// unknown, not a real price, and would distort every statistic.
export const MAX_PLAUSIBLE_PRICE_GROSZE = 1_000_000;
/** @param {unknown} value */
function integerPrice(value) {
  const price = Number(value);
  return Number.isFinite(price) && price > 0 && price < MAX_PLAUSIBLE_PRICE_GROSZE
    ? Math.round(price)
    : null;
}

/** @param {string} prefix @param {...unknown} values */
function stableId(prefix, ...values) {
  return `${prefix}_${createHash('sha256').update(JSON.stringify(values)).digest('hex').slice(0, 32)}`;
}

/**
 * Saves scanned offers. A scan summary, when given, is stored for the same moment.
 * @param {import('./sqlite-catalog-repository.mjs').SqliteCatalogRepository} repository
 * @param {ScannedOffer[]} offers
 * @param {Date|string} observedAt
 * @param {{ scanSummary?: { at: string } & Record<string, unknown> | null, now?: () => Date }} [options]
 * @returns {IngestReport}
 */
export function ingestScannedOffers(
  repository,
  offers,
  observedAt,
  { scanSummary = null, now = () => new Date() } = {},
) {
  /** @type {IngestReport} */
  const report = { offers: 0, evidence: 0, jobs: 0, skipped: 0 };
  const at = observedAt instanceof Date ? observedAt.toISOString() : String(observedAt);
  /** @type {string[]} */
  const newJobOffers = [];
  repository.transaction(() => {
    for (const offer of offers ?? []) {
      let identity;
      try {
        identity = identifyOffer(offer);
      } catch {
        report.skipped += 1;
        continue;
      }
      const price = integerPrice(offer.price);
      const stored = repository.upsertOffer({
        id: identity.id,
        source: identity.source,
        externalOfferId: identity.externalId,
        normalizedUrl: identity.url,
        originalTitle: offer.title ?? '',
        currentPrice: price,
        currency: offer.currency ?? 'PLN',
        availability: offer.availability ?? 'unconfirmed',
        language: offer.language ?? null,
        observedIsbn: offer.isbn ?? null,
        imageUrl: offer.image ?? null,
        ...observationFields(offer),
        matchedQueries: offer.matchedQueries ?? [],
        firstSeenAt: offer.firstSeenAt ?? at,
        lastSeenAt: offer.lastSeenAt ?? at,
        seenCount:
          Number.isSafeInteger(offer.seenCount) && Number(offer.seenCount) > 0
            ? offer.seenCount
            : undefined,
        at: observedAt,
      });
      if (price != null) repository.appendPriceObservation(stored.id, price, observedAt);
      report.offers += 1;
      // The raw listing objects (result list, listing page) at first sight and when they change.
      if (
        offer.rawListing &&
        saveRawSnapshot(repository, stored.id, 'listing', offer.rawListing, at)
      )
        report.snapshots = (report.snapshots || 0) + 1;
      if (offer.rawDetail && saveRawSnapshot(repository, stored.id, 'detail', offer.rawDetail, at))
        report.snapshots = (report.snapshots || 0) + 1;
      // The description read with the listing page also serves sets (no second read of the page).
      if (typeof offer.listingDescription === 'string' && offer.listingDescription.trim())
        saveOfferDescription(
          repository,
          stored.id,
          { text: offer.listingDescription.trim().slice(0, 8000), status: 'found' },
          at,
        );

      const evidence = extractOfferISBN(offer);
      let newEvidence = false;
      for (const observation of evidence.observations.filter((row) => row.valid)) {
        const value = observation.value;
        const saved = repository.putMetadataEvidence({
          id: stableId('scan_isbn', stored.id, value, observation.classification),
          offerId: stored.id,
          fieldName: 'isbn',
          value,
          classification: observation.classification,
          sourceType: `scanner:${identity.source}`,
          verificationStatus: 'unverified',
          observedAt,
          at: observedAt,
        });
        if (saved.created) {
          report.evidence += 1;
          newEvidence = true;
        }
      }
      const job = repository.putIdentificationJob({
        offerId: stored.id,
        status: 'queued',
        at: observedAt,
      });
      if (job.created) {
        report.jobs += 1;
        newJobOffers.push(stored.id);
      }
      // The seller added or corrected the ISBN since the last scan: the offer waiting in review
      // with the old answer ("no ISBN") goes back to the resolver.
      else if (newEvidence && requeueForNewEvidence(repository, stored.id, at))
        report.requeued = (report.requeued || 0) + 1;
    }
    // A re-listed or duplicate copy of a rejected offer is rejected before the resolver sees it.
    if (newJobOffers.length) {
      const { rejected } = rejectRepeatsOfRejectedOffers(repository, {
        now,
        offerIds: newJobOffers,
      });
      if (rejected) report.autoRejected = rejected;
    }
    if (scanSummary) {
      if (scanSummary.at !== at) throw Error('INVALID_SCAN_SUMMARY_TIME');
      repository.database
        .prepare(
          'INSERT OR REPLACE INTO scan_runs(scanned_at,summary_json,created_at) VALUES(?,?,?)',
        )
        .run(at, JSON.stringify(scanSummary), at);
    }
  });
  return report;
}
