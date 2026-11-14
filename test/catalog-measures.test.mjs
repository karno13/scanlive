import assert from 'node:assert/strict';
import test from 'node:test';
import { SqliteCatalogRepository } from '../sqlite-catalog-repository.mjs';
import { measureValues, todayMeasures } from '../catalog-measures.mjs';
import { measureCards } from '../app/views/today.js';

function seed() {
  const repository = new SqliteCatalogRepository(':memory:');
  repository.createWork({
    id: 'w',
    title: 'Książka',
    authors: ['A'],
    verificationStatus: 'verified',
  });
  for (const [id, extra] of [
    ['e1', { publisher: 'Zysk', publicationYear: 2020 }],
    ['e2', { publicationYear: 2019 }],
  ])
    repository.createEdition({
      id,
      workId: 'w',
      title: id,
      verificationStatus: 'verified',
      ...extra,
    });
  const seen = '2026-11-12T08:00:00.000Z';
  const offer = (id, source = 'Vinted') =>
    repository.upsertOffer({
      id,
      source,
      normalizedUrl: `https://example.test/${id}`,
      originalTitle: id,
      currentPrice: 1000,
      lastSeenAt: seen,
      firstSeenAt: seen,
    });
  for (const id of ['auto', 'manual', 'queue', 'excluded', 'empik-queue'])
    offer(id, id === 'empik-queue' ? 'Empik' : 'Vinted');
  const db = repository.database;
  const match = db.prepare(
    'INSERT INTO offer_matches (id, offer_id, edition_id, method, status, created_by, valid_from, created_at) VALUES (?,?,?,?,?,?,?,?)',
  );
  match.run('m1', 'auto', 'e1', 'structured_isbn', 'active', 'catalog_resolver', seen, seen);
  match.run('m2', 'manual', 'e1', 'manual', 'active', 'local_user', seen, seen);
  db.prepare("UPDATE offers SET availability='available' WHERE id='auto'").run();
  const job = db.prepare(
    'INSERT INTO identification_jobs (id, offer_id, status, created_at, updated_at) VALUES (?,?,?,?,?)',
  );
  job.run('j1', 'queue', 'review_required', '2026-11-02T00:00:00.000Z', '2026-11-09T12:00:00.000Z');
  job.run(
    'j2',
    'empik-queue',
    'review_required',
    '2026-11-01T00:00:00.000Z',
    '2026-11-01T00:00:00.000Z',
  );
  db.prepare(
    "INSERT INTO review_decisions (id, offer_id, action, created_by, created_at) VALUES ('d1','excluded','not_book','local_user',?)",
  ).run(seen);
  return repository;
}

test('the four measures are computed from SQL', () => {
  const repository = seed();
  try {
    const at = new Date('2026-11-12T12:00:00.000Z');
    const m = measureValues(repository, at);
    // 5 offers, one excluded as "not a book": 1 of 4 recognised without a human.
    assert.deepEqual(
      { part: m.recognition.part, total: m.recognition.total, value: m.recognition.value },
      { part: 1, total: 4, value: 25 },
    );
    // The Empik job is reference enrichment: only the queue of the operator counts.
    assert.equal(m.oldestDecisionDays.value, 3);
    assert.equal(m.oldestDecisionDays.total, 1);
    assert.equal(m.completeEditions.value, 50);
    assert.deepEqual(
      { part: m.confirmedAvailability.part, total: m.confirmedAvailability.total },
      { part: 1, total: 5 },
    );
  } finally {
    repository.close();
  }
});

test('trend: none on the first day, then the change against the oldest snapshot of the week', () => {
  const repository = seed();
  try {
    const day = (iso) => () => new Date(iso);
    assert.equal(todayMeasures(repository, { now: day('2026-11-05T10:00:00Z') })[0].trend, null);
    repository.database
      .prepare("UPDATE offers SET availability='available' WHERE id='manual'")
      .run();
    const later = todayMeasures(repository, { now: day('2026-11-12T10:00:00Z') });
    const availability = later.find((item) => item.id === 'confirmedAvailability');
    assert.deepEqual({ ...availability.trend }, { delta: 20, since: '2026-11-05' });
    // Today's own snapshot is not a "before"; another call the same day keeps one row per day.
    assert.equal(
      todayMeasures(repository, { now: day('2026-11-12T11:00:00Z') })[0].trend.since,
      '2026-11-05',
    );
    assert.equal(
      repository.database
        .prepare("SELECT count(*) n FROM metric_snapshots WHERE key='recognition'")
        .get().n,
      2,
    );
    // Older than a week is not a trend either.
    assert.equal(todayMeasures(repository, { now: day('2026-11-20T10:00:00Z') })[0].trend, null);
  } finally {
    repository.close();
  }
});

test('cards: wording, the direction that is good, "trend od jutra" without history', () => {
  const cards = measureCards([
    {
      id: 'recognition',
      value: 70.2,
      part: 1796,
      total: 2558,
      trend: { delta: 1.5, since: '2026-11-05' },
    },
    { id: 'oldestDecisionDays', value: 4, total: 111, trend: { delta: 2, since: '2026-11-05' } },
    { id: 'completeEditions', value: 89.6, part: 493, total: 550, trend: null },
    {
      id: 'confirmedAvailability',
      value: 24.8,
      part: 660,
      total: 2660,
      trend: { delta: 0, since: '2026-11-05' },
    },
    { id: 'unknown', value: 1 },
  ]);
  assert.equal(cards.length, 4);
  assert.deepEqual(
    { value: cards[0].value, trend: cards[0].trend, tone: cards[0].tone },
    { value: '70,2%', trend: '▲ +1,5 pp od 05.11', tone: 'good' },
  );
  assert.deepEqual(
    { value: cards[1].value, trend: cards[1].trend, tone: cards[1].tone },
    { value: '4 d', trend: '▲ +2 d od 05.11', tone: 'bad' },
  );
  assert.deepEqual(
    { trend: cards[2].trend, tone: cards[2].tone, note: cards[2].note },
    { trend: 'trend od jutra', tone: 'none', note: '493 z 550 (wydawca i rok)' },
  );
  assert.equal(cards[3].trend, '= bez zmian od 05.11');
});
