import assert from 'node:assert/strict';
import test from 'node:test';

import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';
import { decideIdentificationJob, getCatalogWork, listCatalogWorks, localWorkCandidates } from './catalog-api.mjs';
import { reassignOffer } from './offer-assignment.mjs';
import {
  bindingClass,
  chooseEditionForOffer,
  computeVariants,
  ensureUnknownEdition,
  listingHints,
  mergeVariants,
  publisherKey,
  setEditionVariant,
  workPriceOverview,
} from './edition-variants.mjs';

const ISBN = '9780306406157';

function discworld() {
  const repository = new SqliteCatalogRepository(':memory:');
  repository.createWork({ id: 'w', title: 'Kolor magii', authors: ['Pratchett, Terry'] });
  const editions = [
    ['e1994', 'Fantastyka', 1994, null],
    ['e2001', 'Prószyński i S-ka', 2001, null],
    ['e2010', 'Prószyński Media', 2010, null],
    ['e2022', 'Prószyński i S-ka', 2022, 'oprawa twarda'],
    ['e2025', 'Prószyński i S-ka', 2025, 'twarda'],
  ];
  for (const [id, publisher, publicationYear, binding] of editions)
    repository.createEdition({ id, workId: 'w', title: 'Kolor magii', publisher, publicationYear, binding, language: 'polski' });
  repository.createEdition({ id: 'omni', workId: 'w', title: 'Kolor magii : Blask fantastyczny ; Czarodzicielstwo', publisher: 'Prószyński i S-ka', publicationYear: 2025, binding: 'oprawa twarda' });
  repository.attachIdentifier('e2022', 'isbn13', ISBN, { verificationStatus: 'verified' });
  return repository;
}

function offer(repository, id, title, { isbn = null, price = 3000, edition = null, availability } = {}) {
  repository.upsertOffer({ id, source: 'fixture', normalizedUrl: `https://example.test/${id}`, originalTitle: title, observedIsbn: isbn, currentPrice: price, availability });
  repository.appendPriceObservation(id, price, '2026-10-01T10:00:00.000Z');
  if (edition) repository.assignOfferToEdition(id, edition, { id: `m_${id}`, method: 'manual', status: 'active' });
  repository.putIdentificationJob({ id: `j_${id}`, offerId: id, status: 'review_required' });
}

test('binding and publisher keys fold spellings of the same thing', () => {
  assert.equal(bindingClass('oprawa twarda'), 'hard');
  assert.equal(bindingClass('Hardcover'), 'hard');
  assert.equal(bindingClass('oprawa miękka'), 'soft');
  assert.equal(bindingClass('perfect paperback'), 'soft');
  assert.equal(bindingClass(null), null);
  assert.equal(publisherKey('Prószyński i S-ka'), publisherKey('Prószyński Media'));
  assert.equal(publisherKey('Dom Wydawniczy Rebis'), 'rebis');
  assert.notEqual(publisherKey('Dom Wydawniczy Rebis'), publisherKey('Dom Wydawniczy REA'));
});

test('editions group into price variants: publisher + binding; omnibus and foreign apart; unknown binding never joins a known one', () => {
  const variants = computeVariants(
    [
      { id: 'a', title: 'Kolor magii', publisher: 'Prószyński i S-ka', binding: null, language: 'polski' },
      { id: 'b', title: 'Kolor magii', publisher: 'Prószyński Media', binding: null, language: 'pol' },
      { id: 'c', title: 'Kolor magii', publisher: 'Prószyński i S-ka', binding: 'oprawa twarda' },
      { id: 'd', title: 'Kolor magii', publisher: 'Prószyński', binding: 'hardcover' },
      { id: 'e', title: 'Kolor magii : Blask fantastyczny ; Czarodzicielstwo', publisher: 'Prószyński i S-ka', binding: 'oprawa twarda' },
      { id: 'f', title: 'The colour of magic', publisher: 'Corgi', language: 'eng' },
      { id: 'u', title: 'Kolor magii', isUnknown: true },
    ],
    { workTitle: 'Kolor magii' },
  );
  const of = (id) => variants.find((variant) => variant.editionIds.includes(id));
  assert.equal(of('a'), of('b'));
  assert.equal(of('c'), of('d'));
  assert.notEqual(of('a'), of('c'));
  assert.match(of('a').label, /oprawa nieznana/);
  assert.match(of('c').label, /oprawa twarda/);
  assert.match(of('e').label, /zbiorcze/);
  assert.match(of('f').label, /język: eng/);
  assert.equal(of('u'), undefined, 'the unknown edition is in no variant');
});

test('the edition is chosen from the listing only when it is clear', () => {
  const repository = discworld();
  try {
    offer(repository, 'isbn', 'Kolor magii Pratchett', { isbn: ISBN });
    offer(repository, 'year', 'Kolor magii Pratchett wyd. 1994');
    offer(repository, 'hard', 'Kolor magii Pratchett 2025 twarda oprawa');
    offer(repository, 'vague', 'Kolor magii Terry Pratchett Świat Dysku tom 1');
    assert.deepEqual(chooseEditionForOffer(repository, 'w', 'isbn'), { editionId: 'e2022', reason: 'isbn' });
    assert.deepEqual(chooseEditionForOffer(repository, 'w', 'year'), { editionId: 'e1994', reason: 'listing:year' });
    // 2025 fits two editions (single and omnibus), both hardcover: still ambiguous.
    assert.equal(chooseEditionForOffer(repository, 'w', 'hard').editionId, null);
    assert.equal(chooseEditionForOffer(repository, 'w', 'vague').editionId, null);
    assert.deepEqual(listingHints('Twarda oprawa, 2010').years, [2010]);
    assert.equal(listingHints('Twarda oprawa, 2010').binding, 'hard');
  } finally {
    repository.close();
  }
});

test('approving a book without an edition puts the offer on the book’s unknown edition, kept out of edition lists', () => {
  const repository = discworld();
  try {
    offer(repository, 'o1', 'Kolor magii Pratchett Świat Dysku');
    offer(repository, 'o2', 'Kolor magii Terry Pratchett');
    const first = decideIdentificationJob(repository, 'j_o1', { action: 'approved', workId: 'w' });
    assert.equal(first.decision.unknownEdition, true);
    const second = decideIdentificationJob(repository, 'j_o2', { action: 'approved', workId: 'w' });
    assert.equal(second.decision.editionId, first.decision.editionId, 'one unknown edition per book');
    const work = getCatalogWork(repository, 'w');
    assert.equal(work.editions.length, 6);
    assert.ok(work.editions.every((edition) => edition.variantKey));
    assert.equal(work.unknownEdition.activeOfferCount, 2);
    const listed = listCatalogWorks(repository, {}).items.find((item) => item.id === 'w');
    assert.equal(listed.editionCount, 6);
    assert.equal(listed.offerCount, 2);
    assert.equal(ensureUnknownEdition(repository, 'w'), first.decision.editionId);
    // Naming the edition later is an ordinary reassignment.
    reassignOffer(repository, 'o1', 'e2001');
    assert.equal(getCatalogWork(repository, 'w').unknownEdition.activeOfferCount, 1);
  } finally {
    repository.close();
  }
});

test('catalogue candidates in review are books; the edition is named only when the listing shows it', () => {
  const repository = discworld();
  try {
    offer(repository, 'o1', 'Kolor magii Pratchett');
    offer(repository, 'o2', 'Kolor magii Pratchett wydanie 1994');
    const [vague] = localWorkCandidates(repository, 'Kolor magii Pratchett', { offerId: 'o1' });
    assert.equal(vague.workId, 'w');
    assert.equal(vague.editionId, null);
    assert.equal(vague.editionCount, 6);
    const [named] = localWorkCandidates(repository, 'Kolor magii Pratchett wydanie 1994', { offerId: 'o2' });
    assert.equal(named.editionId, 'e1994');
  } finally {
    repository.close();
  }
});

test('book prices add up all editions; per variant and unknown apart; variants can be merged and editions moved', () => {
  const repository = discworld();
  try {
    offer(repository, 'a', 'Kolor magii', { edition: 'e2001', price: 2000 });
    offer(repository, 'b', 'Kolor magii', { edition: 'e2010', price: 2400 });
    offer(repository, 'c', 'Kolor magii', { edition: 'e2022', price: 6000 });
    offer(repository, 'd', 'Kolor magii', { edition: 'e2022', price: 5000, availability: 'sold' });
    offer(repository, 'e', 'Kolor magii', { price: 3000 });
    decideIdentificationJob(repository, 'j_e', { action: 'approved', workId: 'w' });
    const overview = workPriceOverview(repository, 'w');
    assert.equal(overview.overall.offers, 5);
    assert.equal(overview.overall.live, 4);
    assert.equal(overview.overall.median, 2700);
    assert.equal(overview.overall.sold, 1);
    const old = overview.variants.find((variant) => variant.editionIds.includes('e2001'));
    assert.ok(old.editionIds.includes('e2010'));
    assert.equal(old.median, 2200);
    const hard = overview.variants.find((variant) => variant.editionIds.includes('e2022'));
    assert.equal(hard.median, 6000);
    assert.equal(hard.soldMedian, 5000);
    assert.equal(overview.unknown.offers, 1);
    assert.equal(overview.points.length, 5);

    const merged = mergeVariants(repository, 'w', old.key, hard.key);
    const joined = merged.variants.find((variant) => variant.editionIds.includes('e2001'));
    assert.ok(joined.editionIds.includes('e2022'));
    assert.ok(joined.manual);
    const moved = setEditionVariant(repository, 'e2001', 'own');
    assert.equal(moved.variants.find((variant) => variant.editionIds.includes('e2001')).editionIds.length, 1);
    const back = setEditionVariant(repository, 'e2001', null);
    // Back to its computed variant (e2010 stays pinned in the merged one).
    assert.equal(back.variants.find((variant) => variant.editionIds.includes('e2001')).key, old.key);
    assert.throws(() => setEditionVariant(repository, 'e2001', 'pub:nowhere:any'), /VARIANT_NOT_FOUND/);
  } finally {
    repository.close();
  }
});
