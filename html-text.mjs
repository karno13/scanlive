// @ts-check
// Small helpers for reading text out of shop HTML without a DOM: entity decoding, visible text and
// one attribute of a tag. Shared by the marketplace and antiquarian-bookshop parsers.

/** @param {unknown} s */
export function decodeHtml(s) {
  return String(s || '')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&oacute;/gi, (m) => (m[1] === 'O' ? 'Ó' : 'ó'))
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Math.min(Number(n), 0x10ffff)))
    .replace(/&#x([\da-f]+);/gi, (_, n) =>
      String.fromCodePoint(Math.min(parseInt(n, 16), 0x10ffff)),
    );
}

/** Visible text of an HTML fragment, whitespace collapsed. @param {unknown} s */
export function textOnly(s) {
  return decodeHtml(
    String(s || '')
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** One attribute from the attribute text of a tag, decoded; '' when absent. @param {unknown} attrs @param {string} name */
export function attribute(attrs, name) {
  const match = String(attrs).match(
    new RegExp('\\b' + name + '\\s*=\\s*(?:"([^"]*)"|\\\'([^\\\']*)\\\')', 'i'),
  );
  return decodeHtml(match?.[1] ?? match?.[2] ?? '');
}
