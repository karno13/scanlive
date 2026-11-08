// Scan → identification → review → catalogue: the gaps closed on 2026-11-08.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createProductionCatalog } from './catalog-production.mjs';
import { enrichOffers, pendingEnrichment } from './offer-enrichment.mjs';
import { requeueReviewsWithKnownIsbn } from './identification-retry.mjs';
import { chooseAmongRecords } from './catalog-resolver.mjs';
import { listIdentificationJobs, sureReviewPlan } from './catalog-api.mjs';
import { offerEditionDraft, createEditionFromOffer, upgradeOfferEdition, titleFromListing } from './offer-editions.mjs';
import { createSqliteBook } from './sqlite-single-store.mjs';
import { notCatalogueMaterial } from './game-material.mjs';

const offline = async () => {
  throw new Error('NETWORK_NOT_EXPECTED');
};
const at = new Date('2026-11-08T10:00:00Z');

function catalogue() {
  return createProductionCatalog({ databasePath: ':memory:', fetcher: offline, now: () => at });
}
function review(repo, offerId, reason) {
  repo.database
    .prepare("UPDATE identification_jobs SET status='review_required', result_json=? WHERE offer_id=?")
    .run(JSON.stringify({ decision: 'review_required', reason: [reason] }), offerId);
  return repo.database.prepare('SELECT id FROM identification_jobs WHERE offer_id=?').get(offerId).id;
}
const offerId = (repo, url) => repo.database.prepare('SELECT id FROM offers WHERE normalized_url=?').get(url).id;
const jobStatus = (repo, id) => repo.database.prepare('SELECT status FROM identification_jobs WHERE id=?').get(id).status;

test('HTTP 429 pauses the source without using up the offer attempts; other sources go on', async () => {
  const catalog = catalogue();
  const repo = catalog.repository;
  try {
    for (const [n, source] of [[1, 'Allegro Lokalnie'], [2, 'Allegro Lokalnie'], [3, 'Tezeusz.pl']]) {
      const offer = repo.upsertOffer({ source, normalizedUrl: `https://example.test/${n}`, originalTitle: 'T' + n, currentPrice: 1000 });
      repo.putIdentificationJob({ offerId: offer.id, status: 'review_required' });
    }
    let now = new Date('2026-11-08T10:00:00Z');
    const asked = [];
    const throttled = async (url, source) => {
      asked.push(source);
      if (source === 'Allegro Lokalnie') throw Object.assign(new Error('SOURCE_HTTP_429'), { status: 429 });
      return '<html></html>';
    };
    for (let round = 0; round < 5; round++) {
      const report = await enrichOffers(repo, { fetchHtml: throttled, now: () => now });
      if (round === 0) {
        assert.deepEqual(report.paused, ['Allegro Lokalnie']);
        assert.equal(asked.filter((source) => source === 'Allegro Lokalnie').length, 1, 'one refused request, not one per offer');
        assert.ok(asked.includes('Tezeusz.pl'), 'the other source is still read');
      }
      now = new Date(now.getTime() + 2 * 3600_000);
    }
    const attempts = repo.database
      .prepare("SELECT max(attempts) AS attempts FROM offer_enrichment WHERE source='Allegro Lokalnie'")
      .get().attempts;
    assert.equal(attempts, 1, 'rate limits never count as attempts');
    assert.equal(pendingEnrichment(repo, { now: () => now }).filter((offer) => offer.source === 'Allegro Lokalnie').length, 2);
  } finally {
    catalog.close();
  }
});

test('an ISBN that appears on a later scan sends the review job back to the resolver', () => {
  const catalog = catalogue();
  const repo = catalog.repository;
  try {
    const listing = { source: 'Vinted', url: 'https://www.vinted.pl/items/1-ksiazka', title: 'Zabójca smoków', price: 2000 };
    catalog.ingestOffers([listing], at);
    const job = review(repo, offerId(repo, 'https://www.vinted.pl/items/1-ksiazka'), 'no_isbn_evidence');
    const report = catalog.ingestOffers([{ ...listing, isbn: '9788382320770' }], new Date('2026-11-09T10:00:00Z'));
    assert.equal(report.requeued, 1);
    assert.equal(jobStatus(repo, job), 'queued');
  } finally {
    catalog.close();
  }
});

test('offers waiting on an ISBN unknown to every source follow the edition once it is in the catalogue', () => {
  const catalog = catalogue();
  const repo = catalog.repository;
  try {
    const urls = ['https://www.vinted.pl/items/1-a', 'https://www.vinted.pl/items/2-b', 'https://www.vinted.pl/items/3-c'];
    catalog.ingestOffers(urls.map((url, i) => ({ source: 'Vinted', url, title: 'Zabójca Pentaków - Darius Hinks Warhammer ' + i, price: 2000, isbn: '9788382320770' })), at);
    const jobs = urls.map((url) => review(repo, offerId(repo, url), 'isbn_not_found_in_metadata_sources'));
    const bundle = review(repo, offerId(repo, urls[2]), 'possible_bundle');
    assert.equal(requeueReviewsWithKnownIsbn(repo), 0, 'nothing to match yet');
    // The operator adds the book by hand (both ISBN forms are stored).
    createSqliteBook(catalog, { title: 'Zabójca Pentaków', isbn: '978-83-8232-077-0' });
    assert.equal(requeueReviewsWithKnownIsbn(repo), 2);
    assert.equal(jobStatus(repo, jobs[0]), 'queued');
    assert.equal(jobStatus(repo, jobs[1]), 'queued');
    assert.equal(jobStatus(repo, bundle), 'review_required', 'a possible bundle still needs the operator');
  } finally {
    catalog.close();
  }
});

test('BN duplicates of one book are resolved; different books with one ISBN still need a choice', () => {
  const same = [
    { externalRecordId: '1', title: 'Klątwa demona / Darkblade, the deamon\'s curse Kroniki Malusa', publicationYear: 2021 },
    { externalRecordId: '2', title: 'Klątwa demona : kroniki Malusa / Darkblade Warhammer', publicationYear: 2020 },
  ];
  assert.equal(chooseAmongRecords(same, 'Klątwa demona Warhammer')?.externalRecordId, '2', 'earliest printing');
  const different = [
    { externalRecordId: 'a', title: 'Narodziny hordy', publicationYear: 2017 },
    { externalRecordId: 'b', title: 'Cień hordy', publicationYear: 2017 },
  ];
  assert.equal(chooseAmongRecords(different, 'Warcraft Cień hordy Christie Golden')?.externalRecordId, 'b', 'the one the listing names');
  assert.equal(chooseAmongRecords(different, 'Warcraft książka'), null);
  assert.equal(chooseAmongRecords(different, 'x', { recordId: 'a' })?.externalRecordId, 'a', 'operator choice');
});

test('a listing becomes an edition draft; creating it assigns the offer and the siblings follow', () => {
  const catalog = catalogue();
  const repo = catalog.repository;
  try {
    repo.createWork({ id: 'w1', title: 'Duchy Gaunta', authors: ['Abnett, Dan (1965- )'], verificationStatus: 'verified' });
    const urls = ['https://www.vinted.pl/items/11-a', 'https://www.vinted.pl/items/12-b'];
    catalog.ingestOffers([
      { source: 'Vinted', url: urls[0], title: 'Stacja Ocalenie - Dan Abnett Warhammer 40k Duchy Gaunta tom 13', price: 3000, isbn: '9788382320459' },
      { source: 'Vinted', url: urls[1], title: 'STACJA OCALENIE warhammer 40k', price: 3500, isbn: '9788382320459' },
    ], at);
    const [first, second] = urls.map((url) => review(repo, offerId(repo, url), 'isbn_not_found_in_metadata_sources'));
    const draft = offerEditionDraft(repo, first);
    assert.equal(draft.title, 'Stacja Ocalenie');
    assert.deepEqual(draft.authors, ['Dan Abnett']);
    assert.equal(draft.isbn, '9788382320459');
    assert.equal(draft.siblings, 1);
    assert.equal(draft.universe, 'Warhammer');

    const created = createEditionFromOffer(repo, first, { title: draft.title, authors: draft.authors, isbn: draft.isbn });
    assert.equal(created.created, true);
    assert.equal(jobStatus(repo, first), 'completed');
    const match = repo.database.prepare("SELECT method, edition_id FROM offer_matches WHERE offer_id=? AND status='active'").get(offerId(repo, urls[0]));
    assert.deepEqual({ ...match }, { method: 'manual', edition_id: created.editionId });
    assert.equal(repo.database.prepare('SELECT verification_status FROM editions WHERE id=?').get(created.editionId).verification_status, 'unverified');
    assert.equal(requeueReviewsWithKnownIsbn(repo), 1, 'the second listing goes back to the resolver');
    assert.equal(jobStatus(repo, second), 'queued');

    // BN finally knows the book: the edition and its (listing-made) work get the record.
    const upgraded = upgradeOfferEdition(repo, created.editionId, {
      bn: { status: 'found', records: [{
        source: 'bn', externalRecordId: '999', title: 'Stacja Ocalenie / Salvation\'s Reach', authors: ['Abnett, Dan (1965- )'],
        publisher: 'Copernicus Corporation', publicationYear: 2022, isbn13: '9788382320459', payload: { id: 999 }, payloadHash: 'h', fetchedAt: at.toISOString(),
      }] },
    }, { now: () => at });
    assert.equal(upgraded.upgraded, true);
    const edition = repo.database.prepare('SELECT * FROM editions WHERE id=?').get(created.editionId);
    assert.equal(edition.verification_status, 'verified');
    assert.equal(edition.publication_year, 2022);
    assert.ok(repo.database.prepare("SELECT 1 FROM edition_identifiers WHERE edition_id=? AND scheme='bn'").get(created.editionId));
  } finally {
    catalog.close();
  }
});

test('listing titles lose universe names, authors, initials and volume numbers', () => {
  assert.equal(titleFromListing('Warhammer Tropiciel Czarownic C.L. Werner', ['C. L. Werner']), 'Tropiciel Czarownic');
  assert.equal(titleFromListing('Zabójca smoków - William King warhammer', ['William King']), 'Zabójca smoków');
  assert.equal(titleFromListing('HONOR WILKA tom VI Warhammer 40k'), 'Honor wilka');
});

test('queue tabs cover the whole queue and the sure plan only takes unambiguous decisions', () => {
  const catalog = catalogue();
  const repo = catalog.repository;
  try {
    const work = repo.createWork({ id: 'w-illidan', title: 'Illidan', authors: ['Knaak, Richard A.'], verificationStatus: 'verified' });
    const edition = repo.createEdition({ id: 'e-illidan', workId: work.id, title: 'Illidan', verificationStatus: 'verified' });
    repo.attachIdentifier(edition.id, 'isbn13', '9788365315014');
    catalog.ingestOffers([
      { source: 'Empik', url: 'https://www.empik.com/illidan,p1,ksiazka-p', title: 'Illidan', price: 3999 },
      { source: 'Empik', url: 'https://www.empik.com/inna,p2,ksiazka-p', title: 'Zupełnie inna książka', price: 3999 },
      { source: 'Vinted', url: 'https://www.vinted.pl/items/21-x', title: 'Zabójca Ludzi', price: 2000, isbn: '9788361656197' },
      { source: 'Vinted', url: 'https://www.vinted.pl/items/22-y', title: 'Trylogia 3 tomy', price: 2000, isbn: '9788361656586' },
    ], at);
    const quick = review(repo, offerId(repo, 'https://www.empik.com/illidan,p1,ksiazka-p'), 'no_isbn_evidence');
    review(repo, offerId(repo, 'https://www.empik.com/inna,p2,ksiazka-p'), 'no_isbn_evidence');
    review(repo, offerId(repo, 'https://www.vinted.pl/items/21-x'), 'isbn_not_found_in_metadata_sources');
    review(repo, offerId(repo, 'https://www.vinted.pl/items/22-y'), 'possible_bundle');
    const all = listIdentificationJobs(repo, { status: 'review_required' });
    assert.deepEqual(all.buckets, { quick: 1, add: 1, noisbn: 1, bundle: 1, games: 0, other: 0 });
    const tab = listIdentificationJobs(repo, { status: 'review_required', bucket: 'quick' });
    assert.deepEqual(tab.items.map((item) => item.id), [quick]);
    assert.equal(listIdentificationJobs(repo, { status: 'review_required', isbn: 'catalog' }).total, 1);
    const plan = sureReviewPlan(repo);
    assert.deepEqual(plan.items.map((item) => [item.jobId, item.kind, item.editionId]), [[quick, 'edition', 'e-illidan']]);
  } finally {
    catalog.close();
  }
});

test('game rulebooks and foreign editions get their own review reason, Polish RPG books do not', async () => {
  assert.equal(notCatalogueMaterial('Codex Tyranids, Warhammer 40000'), 'game_rulebook');
  assert.equal(notCatalogueMaterial("Warhammer age of sigmar General's handbook 2021"), 'game_rulebook');
  assert.equal(notCatalogueMaterial('Duchy Gaunta (ENG)'), 'foreign_edition');
  assert.equal(notCatalogueMaterial('Warhammer Fantasy Roleplay. Podręcznik podstawowy'), null);
  assert.equal(notCatalogueMaterial('Kosmiczny Wilk. Tom 1'), null);
  const catalog = catalogue();
  const repo = catalog.repository;
  try {
    catalog.ingestOffers([{ source: 'Empik', url: 'https://www.empik.com/codex,p9,ksiazka-p', title: 'Codex: Death Guard, Warhammer 40000', price: 18990 }], at);
    const result = await catalog.resolver.resolve({ offerId: offerId(repo, 'https://www.empik.com/codex,p9,ksiazka-p') });
    assert.deepEqual([result.decision, result.reason], ['review_required', ['game_rulebook']]);
    review(repo, offerId(repo, 'https://www.empik.com/codex,p9,ksiazka-p'), 'game_rulebook');
    assert.equal(listIdentificationJobs(repo, { status: 'review_required' }).buckets.games, 1);
  } finally {
    catalog.close();
  }
});

test('an Empik import from "Książki obcojęzyczne" is marked foreign and leaves the no-ISBN queue', async () => {
  const catalog = catalogue();
  const repo = catalog.repository;
  try {
    const url = 'https://www.empik.com/words-of-war,p1631256233,ksiazka-p';
    catalog.ingestOffers([{ source: 'Empik', url, title: 'Warhammer 40,000 Words of War', price: 9999 }], at);
    const job = review(repo, offerId(repo, url), 'no_isbn_evidence');
    const page = '<script>{"categoryInfo":{"__typename":"CategoryInfo","categories":[{"__typename":"Category","id":"20","name":"Ksi\u0105\u017cki obcoj\u0119zyczne","url":"x"},{"__typename":"Category","id":"2021","name":"Books","url":"y"}]}}</script>';
    const report = await enrichOffers(repo, { fetchHtml: async () => page, sources: ['Empik'], now: () => at });
    assert.equal(report.foreign, 1);
    assert.equal(jobStatus(repo, job), 'queued');
    const result = await catalog.resolver.resolve({ offerId: offerId(repo, url) });
    assert.deepEqual(result.reason, ['foreign_edition']);
  } finally {
    catalog.close();
  }
});

test('e-ISBN (national ISBN registry) supplies a record when BN and Open Library do not know the ISBN', async () => {
  const onix = '<?xml version="1.0"?><ONIXMessage release="3.0"><Header/><Product><RecordReference>pl-eisbn-10641160</RecordReference>' +
    '<ProductIdentifier><ProductIDType>15</ProductIDType><IDValue>9788383520698</IDValue></ProductIdentifier><DescriptiveDetail>' +
    '<ProductForm>BC</ProductForm><TitleDetail><TitleType>01</TitleType><TitleElement><TitleElementLevel>01</TitleElementLevel><TitleText>Mort</TitleText></TitleElement></TitleDetail>' +
    '<Contributor><SequenceNumber>1</SequenceNumber><ContributorRole>A01</ContributorRole><PersonNameInverted>Pratchett, Terry</PersonNameInverted></Contributor>' +
    '<Language><LanguageRole>01</LanguageRole><LanguageCode>pol</LanguageCode></Language></DescriptiveDetail><PublishingDetail><Imprint><ImprintName>Prószyński i S-ka</ImprintName></Imprint>' +
    '<Publisher><PublishingRole>01</PublishingRole><PublisherName>PRÓSZYŃSKI MEDIA</PublisherName></Publisher><PublishingDate><PublishingDateRole>01</PublishingDateRole><Date>20230710</Date></PublishingDate></PublishingDetail></Product></ONIXMessage>';
  const fetcher = async (url) => {
    const href = String(url);
    if (href.includes('e-isbn.pl')) return new Response(onix, { headers: { 'content-type': 'text/xml' } });
    if (href.includes('data.bn.org.pl')) return Response.json({ nextPage: '', bibs: [] });
    if (href.includes('openlibrary.org')) return new Response('not found', { status: 404 });
    throw new Error('UNEXPECTED_' + href);
  };
  const catalog = createProductionCatalog({ databasePath: ':memory:', fetcher, now: () => at });
  const repo = catalog.repository;
  try {
    const url = 'https://www.vinted.pl/items/31-mort';
    catalog.ingestOffers([{ source: 'Vinted', url, title: 'Mort Terry Pratchett Świat Dysku', price: 2500, isbn: '9788383520698' }], at);
    const result = await catalog.resolver.resolve({ offerId: offerId(repo, url) });
    assert.equal(result.decision, 'created_work_and_edition');
    const edition = repo.database.prepare('SELECT * FROM editions WHERE id=?').get(result.editionId);
    assert.deepEqual([edition.title, edition.publisher, edition.publication_year, edition.language, edition.binding], ['Mort', 'Prószyński i S-ka', 2023, 'polski', 'miękka']);
    assert.deepEqual(JSON.parse(repo.database.prepare('SELECT authors_json FROM works WHERE id=?').get(result.workId).authors_json), ['Pratchett, Terry']);
  } finally {
    catalog.close();
  }
});
