import test from 'node:test';
import assert from 'node:assert/strict';
import { appStyleRules } from '../app-styles.mjs';

// Colours live in custom properties; the dark theme only gives them other values. A colour
// written into a rule is one the dark theme cannot change (white tiles under light text, 2026-11).
// The checks read every stylesheet linked from index.html.
const rules = await appStyleRules();

const COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\((?!\s*(?:var|calc)\()|\b(?:white|black)\b/i;
const isDark = (rule) =>
  /prefers-color-scheme:dark/.test(rule.at) || /data-theme=['"]?dark/.test(rule.selector);

test('stylesheets: colours are custom properties, never written into a rule', () => {
  const offending = [];
  for (const rule of rules)
    for (const { property, value } of rule.declarations) {
      if (property.startsWith('--')) continue;
      const bare = value.replace(/url\((["'])[\s\S]*?\1\)|url\([^)]*\)/g, '');
      if (COLOR.test(bare))
        offending.push(`${rule.file}: ${rule.selector} { ${property}: ${value} }`);
    }
  assert.deepEqual(offending, []);
});

test('stylesheets: the dark theme only changes custom properties', () => {
  const offending = [];
  for (const rule of rules) {
    if (!isDark(rule)) continue;
    if (
      !/^:root(?::not\(\[data-theme=['"]light['"]\]\)|\[data-theme=['"]dark['"]\])?$/.test(
        rule.selector,
      )
    )
      offending.push(rule.selector);
    for (const { property } of rule.declarations)
      if (!property.startsWith('--') && property !== 'color-scheme')
        offending.push(`${rule.selector} { ${property} }`);
  }
  assert.deepEqual(offending, []);
});

test('every custom property the dark theme sets also has a light value', () => {
  const light = new Set();
  const dark = new Set();
  for (const rule of rules)
    for (const { property } of rule.declarations)
      if (property.startsWith('--')) (isDark(rule) ? dark : light).add(property);
  assert.deepEqual(
    [...dark].filter((property) => !light.has(property)),
    [],
  );
});
