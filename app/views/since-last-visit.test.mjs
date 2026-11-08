import test from 'node:test';
import assert from 'node:assert/strict';
import { visitBaseline } from './since-last-visit.js';

const store = () => {
  const data = new Map();
  return { getItem: (key) => (data.has(key) ? data.get(key) : null), setItem: (key, value) => data.set(key, String(value)) };
};

test('the previous visit stays the baseline for the whole session; the next session sees this one', () => {
  const local = store();
  assert.equal(visitBaseline(new Date('2026-11-07T10:00:00Z'), local, store()), null, 'first visit ever');
  const session = store();
  assert.equal(visitBaseline(new Date('2026-11-08T09:00:00Z'), local, session), '2026-11-07T10:00:00.000Z');
  assert.equal(visitBaseline(new Date('2026-11-08T09:30:00Z'), local, session), '2026-11-07T10:00:00.000Z', 'reload keeps it');
  assert.equal(visitBaseline(new Date('2026-11-09T08:00:00Z'), local, store()), '2026-11-08T09:30:00.000Z');
});
