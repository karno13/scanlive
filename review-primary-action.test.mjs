import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('the pinned review button follows the case: create the edition, approve, or say what is missing', async () => {
  const review = await read('./app/views/review.js');
  const css = await read('./app/app.css');
  assert.match(
    review,
    /id="createOfferEdition" type="button" hidden>Utwórz wydanie i przypisz <kbd>Enter<\/kbd>/,
  );
  assert.match(review, /id="reviewApproveHint" role="status" hidden/);
  // The create button submits the listing form, so its validation and pending guard still apply.
  assert.match(
    review,
    /\$\('#createOfferEdition'\)\.addEventListener\('click', \(\) => \$\('#reviewProposals \.rv-offer-edition-form'\)\?\.requestSubmit\(\)\)/,
  );
  assert.match(
    review,
    /const useCreate = approve\.disabled && Boolean\(\$\('#reviewProposals \.rv-offer-edition-form'\)\)/,
  );
  // Enter presses whichever primary button is shown.
  assert.match(
    review,
    /press\(\$\('#createOfferEdition:not\(\[hidden\]\)'\) \? '#createOfferEdition' : '#approveReview'\)/,
  );
  assert.match(
    css,
    /#reviewDetail #approveReview\[hidden\], #reviewDetail #createOfferEdition\[hidden\]/,
  );
});

test('one name for an offer state in the table, the phone list and the drawer', async () => {
  const offers = await read('./app/views/offers.js');
  const html = await read('./app/index.html');
  assert.doesNotMatch(offers, /Do sprawdzenia/);
  assert.match(offers, /function offerState\(item, matched\)/);
  // Stage 0.7 of the 11.2026 review: the most common state is quiet; warning is for exceptions.
  assert.match(offers, /return \{ label: 'Wymaga decyzji', tone: 'pending' \}/);
  assert.match(
    offers,
    /\['retry_wait', 'failed'\]\.includes\(job\)\) return \{ label: statusLabel\(job\), tone: 'warning' \}/,
  );
  assert.match(html, /<th>Przypisanie<\/th><th>Stan<\/th>/);
});

test('queue and set rows do not repeat the state every row shares', async () => {
  const review = await read('./app/views/review.js');
  const sets = await read('./app/views/sets.js');
  assert.match(
    review,
    /job\.status === 'review_required' \? '' : escapeHtml\(statusLabel\(job\.status\)\)/,
  );
  assert.match(sets, /status === 'empty' \? '' : `<span class="proposal-chip/);
});
