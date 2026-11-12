// Static files of the app (app/*): gzip when the browser accepts it and an ETag so a reload
// answers 304 instead of sending the file again. `Cache-Control: no-cache` makes the browser
// revalidate every time, so a changed file is visible after a normal page refresh.
import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

const MIN_GZIP_BYTES = 1024;
const cache = new Map();

/** Body, gzipped body and ETag of a file; cached in memory until its size or mtime changes. */
async function loadFile(path) {
  const info = await stat(path);
  const stamp = info.size + ':' + info.mtimeMs;
  const known = cache.get(path);
  if (known?.stamp === stamp) return known;
  const body = await readFile(path);
  const etag = '"' + createHash('sha1').update(body).digest('base64url').slice(0, 20) + '"';
  const gzip = body.length >= MIN_GZIP_BYTES ? gzipSync(body, { level: 9 }) : null;
  const entry = { stamp, body, gzip: gzip && gzip.length < body.length ? gzip : null, etag };
  cache.set(path, entry);
  return entry;
}

function acceptsGzip(request) {
  return /\bgzip\b/i.test(String(request.headers['accept-encoding'] || ''));
}

function etagMatches(request, etag) {
  const header = String(request.headers['if-none-match'] || '');
  if (!header) return false;
  if (header.trim() === '*') return true;
  // Some proxies add W/ or the -gzip suffix; compare the opaque part.
  return header
    .split(',')
    .map((tag) =>
      tag
        .trim()
        .replace(/^W\//, '')
        .replace(/-gzip"$/, '"'),
    )
    .includes(etag);
}

/**
 * Sends one static file. `headers` are the security headers every response carries.
 * @returns {Promise<{ status: number, bytes: number }>}
 */
export async function sendStaticFile(request, response, path, { type, headers = {} }) {
  const file = await loadFile(path);
  const base = {
    ...headers,
    'Content-Type': type,
    'Cache-Control': 'no-cache',
    ETag: file.etag,
    Vary: 'Accept-Encoding',
  };
  if (etagMatches(request, file.etag)) {
    response.writeHead(304, base);
    response.end();
    return { status: 304, bytes: 0 };
  }
  const gzip = file.gzip && acceptsGzip(request);
  const body = gzip ? file.gzip : file.body;
  response.writeHead(200, {
    ...base,
    ...(gzip ? { 'Content-Encoding': 'gzip' } : {}),
    'Content-Length': body.length,
  });
  response.end(request.method === 'HEAD' ? undefined : body);
  return { status: 200, bytes: body.length };
}
