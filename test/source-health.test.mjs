import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createProductionCatalog } from '../catalog-production.mjs';
import { persistSqliteScan } from '../sqlite-single-store.mjs';
import { sourceHealthNote } from '../app/core/formatters.js';

const catalog = () =>
  createProductionCatalog({
    databasePath: ':memory:',
    fetcher: async () => {
      throw Error('NETWORK_NOT_ALLOWED');
    },
  });
const health = (c, source) =>
  c.repository.database.prepare('SELECT * FROM source_health WHERE source=?').get(source);
const limited = { status: 'unavailable', diagnostic: { code: 'SOURCE_HTTP_429', retryable: true } };

test('a source answering only HTTP 429 is rate limited, not dead; a CAPTCHA is dead', () => {
  const c = catalog();
  try {
    persistSqliteScan(c, {
      offers: [],
      searchedAt: '2026-11-08T14:00:00.000Z',
      scanContext: {
        queries: ['Warcraft', 'Dragonlance'],
        sources: ['Allegro Lokalnie', 'Allegro'],
        results: [
          { source: 'Allegro Lokalnie', query: 'Warcraft', ...limited },
          { source: 'Allegro Lokalnie', query: 'Dragonlance', ...limited },
          {
            source: 'Allegro',
            query: 'Warcraft',
            status: 'unavailable',
            diagnostic: { code: 'SOURCE_CAPTCHA', blocked: true },
          },
        ],
      },
    });
    assert.equal(health(c, 'Allegro Lokalnie').status, 'limited');
    assert.equal(health(c, 'Allegro').status, 'failed');
    assert.equal(
      sourceHealthNote(health(c, 'Allegro Lokalnie'), { short: true }),
      'ogranicza tempo',
    );
    assert.match(sourceHealthNote(health(c, 'Allegro Lokalnie')), /za dużo zapytań \(429\)/);
    assert.match(sourceHealthNote(health(c, 'Allegro')), /wymaga CAPTCHA/);
    assert.doesNotMatch(sourceHealthNote(health(c, 'Allegro')), /SOURCE_/);
  } finally {
    c.close();
  }
});

test('migration 119 restores the last success of sources that only ever answered some phrases', () => {
  const c = catalog();
  try {
    const db = c.repository.database;
    db.prepare('DELETE FROM source_health').run();
    db.prepare('INSERT INTO source_health VALUES(?,?,?,?,?,?)').run(
      'Allegro Lokalnie',
      '2026-11-08T14:00:00.000Z',
      null,
      '2026-11-08T14:00:00.000Z',
      'SOURCE_HTTP_429',
      'failed',
    );
    db.prepare('INSERT INTO source_health VALUES(?,?,?,?,?,?)').run(
      'OLX',
      '2026-11-08T14:00:00.000Z',
      null,
      '2026-11-08T14:00:00.000Z',
      'SOURCE_HTTP_403',
      'failed',
    );
    const summary = {
      context: {
        results: [
          { source: 'Allegro Lokalnie', status: 'ok' },
          { source: 'Allegro Lokalnie', status: 'unavailable' },
          { source: 'OLX', status: 'unavailable' },
        ],
      },
    };
    db.prepare('INSERT INTO scan_runs(scanned_at,summary_json,created_at) VALUES(?,?,?)').run(
      '2026-11-07T19:30:00.000Z',
      JSON.stringify(summary),
      '2026-11-07T19:30:00.000Z',
    );
    db.exec(
      readFileSync(
        new URL('../migrations/119_source_health_backfill.sql', import.meta.url),
        'utf8',
      ),
    );
    assert.deepEqual(
      { ...health(c, 'Allegro Lokalnie') },
      {
        source: 'Allegro Lokalnie',
        last_checked_at: '2026-11-08T14:00:00.000Z',
        last_success_at: '2026-11-07T19:30:00.000Z',
        last_error_at: '2026-11-08T14:00:00.000Z',
        last_error: 'SOURCE_HTTP_429',
        status: 'limited',
      },
    );
    assert.equal(health(c, 'OLX').last_success_at, null);
    assert.equal(health(c, 'OLX').status, 'failed');
  } finally {
    c.close();
  }
});
