import test from 'node:test';
import assert from 'node:assert/strict';
import { appStyleRules } from '../app-styles.mjs';

// Views are switched with the hidden attribute. A layout rule that sets display on a view must not
// be able to show a hidden one; the browser smoke test checks that only one view is visible.
const rules = await appStyleRules();

test('review layout cannot override the hidden state of an inactive tab', () => {
  const display = (rule) =>
    rule.declarations.find(
      ({ property, value }) => property === 'display' && /^(?:flex|grid|block)$/.test(value),
    );
  for (const rule of rules) {
    assert.ok(
      !rule.declarations.some(
        ({ property, value }) => property === 'display' && value === 'contents',
      ),
      'review children retain their semantic layout: ' + rule.selector,
    );
    if (!display(rule)) continue;
    for (const selector of rule.selectors)
      if (/(?:^|[\s>+~])#view-review[^\s>+~]*$/.test(selector))
        assert.ok(
          selector.includes(':not([hidden])'),
          'inactive review must not receive visible layout: ' + selector,
        );
  }
});

test('a stylesheet enforces hidden visibility for every tab and control', () => {
  assert.ok(
    rules.some(
      (rule) =>
        rule.selector === '[hidden]' &&
        !rule.at &&
        rule.declarations.some(
          ({ property, value, important }) =>
            property === 'display' && value === 'none' && important,
        ),
    ),
    '[hidden] { display: none !important }',
  );
});
