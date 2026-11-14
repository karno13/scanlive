// @ts-check
// The app's stylesheets as data, for tests that guard rules of structure (colour tokens, the dark
// theme, hidden views). The files are the <link rel=stylesheet> entries of app/index.html, in
// order; rules are parsed, so the checks do not depend on formatting or on the order of rules.
import { readFile } from 'node:fs/promises';

const appDirectory = new URL('./app/', import.meta.url);

/** Paths (relative to app/) of the stylesheets linked from index.html, in cascade order. */
export async function styleFiles() {
  const html = await readFile(new URL('index.html', appDirectory), 'utf8');
  return [...html.matchAll(/<link\b[^>]*\brel=["']?stylesheet["']?[^>]*>/g)].map((match) => {
    const href = match[0].match(/\bhref=["']?([^"'\s>]+)/)[1];
    return href.replace(/^\//, '').replace(/\?.*$/, '');
  });
}

/** [{ file, text }] of every linked stylesheet. */
export async function readAppStyles() {
  return Promise.all(
    (await styleFiles()).map(async (file) => ({
      file,
      text: await readFile(new URL(file, appDirectory), 'utf8'),
    })),
  );
}

/** Selector with whitespace normalised (`.a > .b,.c` and `.a>.b, .c` compare equal). */
export function normalizeSelector(selector) {
  return selector
    .replace(/\s+/g, ' ')
    .replace(/\s*([>+~,])\s*/g, '$1')
    .trim();
}

/**
 * Style rules of a stylesheet with their at-rule context:
 * [{ selector, selectors, at, declarations: [{ property, value, important }] }].
 * `at` joins the enclosing at-rule preludes with spaces removed, e.g. "@media(max-width:900px)".
 */
export function styleRules(css) {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, '');
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
      if (prelude.startsWith('@')) {
        stack.push(prelude.replace(/\s+/g, ''));
        // Keyframes and font faces hold no style rules: skip their block.
        if (/^@(?:-webkit-)?(?:keyframes|font-face)/.test(prelude)) {
          let depth = 1;
          while (depth && ++i < text.length) {
            if (text[i] === '{') depth++;
            else if (text[i] === '}') depth--;
          }
          stack.pop();
        }
        continue;
      }
      let end = i + 1;
      for (let quote = null; end < text.length; end++) {
        if (quote) {
          if (text[end] === quote) quote = null;
        } else if (text[end] === '"' || text[end] === "'") quote = text[end];
        else if (text[end] === '}') break;
      }
      const declarations = text
        .slice(i + 1, end)
        .split(/;(?=(?:[^"']|"[^"]*"|'[^']*')*$)/)
        .map((declaration) => declaration.trim())
        .filter(Boolean)
        .map((declaration) => {
          const colon = declaration.indexOf(':');
          const raw = declaration.slice(colon + 1).trim();
          return {
            property: declaration.slice(0, colon).trim().toLowerCase(),
            value: raw.replace(/\s*!\s*important$/i, ''),
            important: /!\s*important$/i.test(raw),
          };
        });
      const selector = normalizeSelector(prelude);
      out.push({
        selector,
        selectors: splitSelectors(selector),
        at: stack.join(' '),
        declarations,
      });
      i = end;
    } else if (c === '}') {
      stack.pop();
      buffer = '';
    } else if (c === ';' && !stack.length) buffer = '';
    else buffer += c;
  }
  return out;
}

/** Splits a selector list at top-level commas. */
export function splitSelectors(selector) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < selector.length; i++) {
    const c = selector[i];
    if (c === '(' || c === '[') depth++;
    else if (c === ')' || c === ']') depth--;
    else if (c === ',' && !depth) {
      parts.push(selector.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(selector.slice(start).trim());
  return parts.filter(Boolean);
}

/** All style rules of all linked stylesheets, each with its file. */
export async function appStyleRules() {
  return (await readAppStyles()).flatMap(({ file, text }) =>
    styleRules(text).map((rule) => ({ ...rule, file })),
  );
}
