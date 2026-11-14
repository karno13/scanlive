import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { createLocalAppServer } from './local-app.mjs';
import { styleFiles } from './app-styles.mjs';

function get(port, path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: '127.0.0.1', port, path, headers }, (response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(chunk));
      response.on('end', () =>
        resolve({
          status: response.statusCode,
          headers: response.headers,
          body: Buffer.concat(chunks),
        }),
      );
    });
    request.on('error', reject);
    request.end();
  });
}

test('every stylesheet linked from index.html is served with gzip, an ETag and 304', async () => {
  const server = createLocalAppServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const port = server.address().port;
  try {
    const files = await styleFiles();
    assert.ok(files.length > 1, 'the styles are split into several files');
    for (const file of files) {
      assert.match(file, /^styles\/[a-z0-9-]+\.css$/);
      const first = await get(port, '/' + file, { 'accept-encoding': 'gzip' });
      assert.equal(first.status, 200, file);
      assert.match(first.headers['content-type'], /^text\/css/, file);
      assert.equal(first.headers['content-encoding'], 'gzip', file);
      assert.match(first.headers.etag, /^"[\w-]+"$/, file);
      const again = await get(port, '/' + file, {
        'accept-encoding': 'gzip',
        'if-none-match': first.headers.etag,
      });
      assert.equal(again.status, 304, file);
    }
    assert.equal((await get(port, '/styles/missing.css')).status, 404);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('frontend module routes work and server does not expose arbitrary files', async () => {
  const server = createLocalAppServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const base = 'http://127.0.0.1:' + server.address().port;
  try {
    for (const route of [
      '/app.js',
      '/views/scanner.js',
      '/views/settings.js',
      '/core/formatters.js',
      '/views/review.js',
      '/views/catalog.js',
      '/views/offers.js',
    ]) {
      const response = await fetch(base + route);
      assert.equal(response.status, 200, route);
      assert.match(response.headers.get('content-type'), /javascript/);
    }
    const forbidden = await fetch(base + '/package.json');
    assert.equal(forbidden.status, 404);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
