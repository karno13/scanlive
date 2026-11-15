import assert from 'node:assert/strict';
import test from 'node:test';

import { valuationLineMarkup, valuationPanelMarkup, valuationRange } from './valuation.js';

const escapeHtml = (value) => String(value).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);
const value = {
  estimate: 8000,
  low: 7000,
  high: 9500,
  confidence: 'medium',
  confidenceLabel: 'średnia',
  sold: 2,
  live: 3,
  reasons: ['2 potwierdzone sprzedaże.', 'Pominięto 1 nietypową cenę.'],
};

test('the list line shows the value, range, confidence and basis', () => {
  assert.equal(valuationRange(value), '70–95 zł');
  const line = valuationLineMarkup(value, escapeHtml);
  assert.match(line, /~80 zł/);
  assert.match(line, /wiarygodność średnia/);
  assert.match(line, /2 sprzedaże, 3 oferty/);
  assert.match(line, /title="2 potwierdzone/);
  assert.match(valuationLineMarkup({ estimate: null }, escapeHtml), /brak danych/);
  assert.equal(valuationLineMarkup(null, escapeHtml), '');
});

test('the book page box lists every reason', () => {
  const box = valuationPanelMarkup(value, escapeHtml);
  assert.match(box, /Szacowana wartość rynkowa/);
  assert.equal(box.match(/<li>/g).length, 2);
});
