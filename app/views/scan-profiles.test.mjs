import assert from 'node:assert/strict';
import test from 'node:test';

import { missingSources } from './scan-profiles.js';

test('missingSources lists working sources a saved profile does not scan, in form order', () => {
  const profile = { sources: ['Vinted', 'Empik', 'Dedalus.pl'] };
  const working = ['Empik', 'Vinted', 'Skupszop.pl', 'Antykwariat Toruń'];
  assert.deepEqual(missingSources(profile, working), ['Skupszop.pl', 'Antykwariat Toruń']);
});

test('missingSources is empty for a profile that already scans every working source', () => {
  assert.deepEqual(missingSources({ sources: ['Vinted', 'Empik'] }, ['Vinted']), []);
  assert.deepEqual(missingSources(null, []), []);
});
