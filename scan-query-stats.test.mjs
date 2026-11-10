import assert from 'node:assert/strict';
import test from 'node:test';
import { scanQueryStats } from './trading-api.mjs';
import { SqliteCatalogRepository } from './sqlite-catalog-repository.mjs';

test('query stats count offers, catalogue matches and waiting jobs per phrase and source', () => {
  const repo = new SqliteCatalogRepository(':memory:');
  const offer = (n, queries, isbn = null) =>
    repo.upsertOffer({
      source: 'Vinted',
      normalizedUrl: `https://www.vinted.pl/items/${n}`,
      originalTitle: 'T' + n,
      currentPrice: 1000,
      observedIsbn: isbn,
      matchedQueries: queries,
    });
  const a = offer(1, ['Warcraft'], '9788388916014');
  const b = offer(2, ['Warcraft']);
  offer(3, ['Warcraft', 'Warhammer']);
  repo.putIdentificationJob({ offerId: b.id, status: 'review_required' });
  repo.createWork({ id: 'w', title: 'W', authors: ['A'], at: '2026-01-01T00:00:00Z' });
  repo.createEdition({ id: 'e', workId: 'w', title: 'W', at: '2026-01-01T00:00:00Z' });
  repo.assignOfferToEdition(a.id, 'e', { id: 'm', method: 'structured_isbn', status: 'active', createdBy: 't', at: '2026-01-01T00:00:00Z' });
  const rows = Object.fromEntries(scanQueryStats(repo).items.map((r) => [r.query, r]));
  assert.deepEqual(
    { offers: rows.Warcraft.offers, matched: rows.Warcraft.matched, waiting: rows.Warcraft.waiting, withoutIsbn: rows.Warcraft.withoutIsbn },
    { offers: 3, matched: 1, waiting: 1, withoutIsbn: 2 },
  );
  assert.equal(rows.Warhammer.offers, 1);
});

test('niche measures: sold within 14 days of offers old enough, median sold price, offers over 50 zł, per profile', async () => {
  const { putScanProfile } = await import('./scan-profiles-api.mjs');
  const repo = new SqliteCatalogRepository(':memory:');
  const at = Date.parse('2026-11-30T12:00:00.000Z');
  const offer = (n, query, price, firstSeen, soldAt = null) => {
    const row = repo.upsertOffer({ source: 'Vinted', normalizedUrl: `https://www.vinted.pl/items/${n}0-x`, originalTitle: 'T' + n, currentPrice: price, matchedQueries: [query], firstSeenAt: firstSeen, lastSeenAt: firstSeen });
    if (soldAt) {
      repo.database.prepare("UPDATE offers SET availability='sold', availability_changed_at=? WHERE id=?").run(soldAt, row.id);
      repo.database.prepare("INSERT INTO offer_status_history(offer_id,status,via,observed_at) VALUES(?,'sold','check',?)").run(row.id, soldAt);
    }
  };
  offer(1, 'Dragonlance', 6000, '2026-11-01T00:00:00Z', '2026-11-05T00:00:00Z'); // sold in 4 days
  offer(2, 'Dragonlance', 4000, '2026-11-01T00:00:00Z', '2026-11-25T00:00:00Z'); // sold, but after 24 days
  offer(3, 'Dragonlance', 8000, '2026-11-02T00:00:00Z');
  offer(4, 'Dragonlance', 3000, '2026-11-28T00:00:00Z'); // too new to judge
  offer(5, 'Warcraft', 2000, '2026-11-01T00:00:00Z');
  putScanProfile(repo, 'Krynn', { queries: ['Dragonlance'], sources: ['Vinted'] });
  const stats = scanQueryStats(repo, at);
  const row = stats.items.find((item) => item.query === 'Dragonlance');
  assert.deepEqual(
    [row.soldWithin14, row.soldWithin14Base, row.sold, row.soldMedian, row.over50],
    [1, 3, 2, 5000, 2],
  );
  assert.equal(Math.round(row.soldWithin14Share * 100), 33);
  const profile = stats.profiles.find((item) => item.name === 'Krynn');
  assert.deepEqual([profile.offers, profile.soldWithin14, profile.soldWithin14Base, profile.soldMedian, profile.over50, profile.liveMedian], [4, 1, 3, 5000, 2, 5500]);
  repo.close();
});
