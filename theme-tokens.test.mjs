import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Colours live in custom properties; the dark theme only gives them other values. A colour
// written into a rule is one the dark theme cannot change (white tiles under light text, 2026-11).
const css = (await readFile(new URL('./app/app.css', import.meta.url), 'utf8')).replace(
  /\/\*[\s\S]*?\*\//g,
  '',
);

/** Style rules with their at-rule context: [{ selector, at, declarations: [[prop, value]] }]. */
function rules(text) {
  const out = [];
  const stack = [];
  let buffer = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"' || c === "'") {
      const end = text.indexOf(c, i + 1);
      buffer += text.slice(i, end + 1);
      i = end;
    } else if (c === '{') {
      const prelude = buffer.trim();
      buffer = '';
      if (prelude.startsWith('@')) stack.push(prelude);
      else {
        let end = i + 1;
        // Skip quoted strings (data: URLs) when looking for the end of the block.
        for (let quote = null; end < text.length; end++) {
          if (quote) {
            if (text[end] === quote) quote = null;
          } else if (text[end] === '"' || text[end] === "'") quote = text[end];
          else if (text[end] === '}') break;
        }
        const declarations = text
          .slice(i + 1, end)
          .split(/;(?=(?:[^"']|"[^"]*"|'[^']*')*$)/)
          .map((d) => d.trim())
          .filter(Boolean)
          .map((d) => [d.slice(0, d.indexOf(':')).trim(), d.slice(d.indexOf(':') + 1).trim()]);
        out.push({ selector: prelude, at: stack.join(' '), declarations });
        i = end;
      }
    } else if (c === '}') {
      stack.pop();
      buffer = '';
    } else buffer += c;
  }
  return out;
}

const COLOR = /#[0-9a-f]{3,8}\b|\brgba?\(|\bhsla?\((?!\s*(?:var|calc)\()|\b(?:white|black)\b/i;

test('app.css: colours are custom properties, never written into a rule', () => {
  const offending = [];
  for (const rule of rules(css))
    for (const [prop, value] of rule.declarations) {
      if (prop.startsWith('--')) continue;
      const bare = value.replace(/url\((["'])[\s\S]*?\1\)|url\([^)]*\)/g, '');
      if (COLOR.test(bare)) offending.push(`${rule.selector} { ${prop}: ${value} }`);
    }
  assert.deepEqual(offending, []);
});

test('app.css: the dark theme only changes custom properties', () => {
  const offending = [];
  for (const rule of rules(css)) {
    const dark =
      /prefers-color-scheme:\s*dark/.test(rule.at) || /data-theme=['"]?dark/.test(rule.selector);
    if (!dark) continue;
    if (
      !/^:root(?::not\(\[data-theme=['"]light['"]\]\)|\[data-theme=['"]dark['"]\])?$/.test(
        rule.selector,
      )
    )
      offending.push(rule.selector);
    for (const [prop] of rule.declarations)
      if (!prop.startsWith('--') && prop !== 'color-scheme')
        offending.push(`${rule.selector} { ${prop} }`);
  }
  assert.deepEqual(offending, []);
});

test('every custom property the dark theme sets also has a light value', () => {
  const light = new Set();
  const dark = new Set();
  for (const rule of rules(css)) {
    const isDark =
      /prefers-color-scheme:\s*dark/.test(rule.at) || /data-theme=['"]?dark/.test(rule.selector);
    for (const [prop] of rule.declarations)
      if (prop.startsWith('--')) (isDark ? dark : light).add(prop);
  }
  assert.deepEqual(
    [...dark].filter((prop) => !light.has(prop)),
    [],
  );
});
