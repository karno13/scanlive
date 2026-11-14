// Stage 0 of the 11.2026 review: one primary action, Odrzuć and Pomiń next to it, the rest in
// "Więcej"; the listing photo zooms and stands next to the chosen proposal's cover.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fullSizeSrc } from '../app/views/review-photo.js';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('the review bar: primary action, Odrzuć, Pomiń, then "Więcej" with the rest', async () => {
  const review = await read('../app/views/review.js');
  const bar = review.match(
    /<div class="lean-review-primary-actions">([\s\S]*?)<\/details><\/div>/,
  )?.[1];
  assert.ok(bar, 'the bar is rendered');
  const order = [...bar.matchAll(/id="(\w+)"/g)].map((match) => match[1]);
  assert.deepEqual(order, [
    'approveReview',
    'createOfferEdition',
    'rejectReview',
    'reviewSkip',
    // Stage 2: reject with an "odrzucaj takie zawsze" rule (key R).
    'rejectWithRule',
    'approveBook',
    'markAsSet',
    'reviewAddEdition',
    'reviewFocusToggle',
  ]);
  const [visible, menu] = bar.split('<details class="rv-more">');
  assert.match(visible, /class="button primary" id="approveReview"/);
  assert.match(visible, /class="button secondary" id="rejectReview"/);
  assert.match(visible, /class="button secondary" id="reviewSkip"/);
  assert.match(menu, /<summary class="button ghost" aria-label="Więcej akcji">Więcej<\/summary>/);
  for (const id of [
    'rejectWithRule',
    'approveBook',
    'markAsSet',
    'reviewAddEdition',
    'reviewFocusToggle',
  ])
    assert.match(menu, new RegExp(`class="rv-more-item" id="${id}"`), id);
  // Shortcuts press the same buttons, also when the menu is closed.
  for (const shortcut of [
    "x: () => press('#rejectReview')",
    "z: () => press('#markAsSet')",
    "n: () => press('#approveBook')",
    's: () => skipReview()',
    'f: () => toggleReviewFocus()',
  ])
    assert.ok(review.includes(shortcut), shortcut);
  assert.doesNotMatch(
    review,
    /lean-review-secondary-actions"><button class="button ghost" id="markAsSet"/,
  );
});

test('the listing photo zooms; the chosen proposal cover is shown beside it', async () => {
  const review = await read('../app/views/review.js');
  assert.match(
    review,
    /reviewPhotoMarkup\(\{ photoMarkup: coverMarkup\(photo, offerTitle, \{ size: 'xl', escapeHtml \}\)/,
  );
  assert.match(review, /installPhotoZoom\(\$\('#reviewDetail'\)\)/);
  assert.match(
    review,
    /showCoverComparison\(\$\('#reviewDetail \.rv-photo'\), proposalCoverSrc\(button\), \{ title \}\)/,
  );
  assert.doesNotMatch(
    review,
    /box\.querySelectorAll\('\.rv-cand'\)\.forEach\(\(other\) => other\.classList\.toggle\('is-chosen', other === button\)\);\n\s+(?:chooseCatalogEdition|pendingRecordId|useProposal)/,
  );
});

test('zoom and comparison use the full-size image', () => {
  assert.equal(fullSizeSrc('/api/image?u=x&thumb=1'), '/api/image?u=x');
  assert.equal(fullSizeSrc('/api/offers/a/image?thumb=1'), '/api/offers/a/image');
  assert.equal(
    fullSizeSrc('/api/cover?isbn=9788375780641&size=S&thumb=1'),
    '/api/cover?isbn=9788375780641&size=L',
  );
  assert.equal(fullSizeSrc('/api/image?thumb=1&u=x'), '/api/image?u=x');
});
