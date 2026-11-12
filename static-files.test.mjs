import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request as httpRequest } from 'node:http';
import { mkdtemp, rm, writeFile, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { sendStaticFile } from './static-files.mjs';

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

async function withServer(file, run) {
  const server = createServer((request, response) =>
    sendStaticFile(request, response, file, {
      type: 'text/javascript; charset=utf-8',
      headers: { 'X-Content-Type-Options': 'nosniff' },
    }),
  );
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    await run(server.address().port);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test('static files are gzipped, carry an ETag and answer 304 when unchanged', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bookflip-static-'));
  const file = join(dir, 'app.js');
  const source = 'export const value = 1;\n'.repeat(400);
  await writeFile(file, source);
  try {
    await withServer(file, async (port) => {
      const first = await get(port, '/app.js', { 'accept-encoding': 'gzip, deflate' });
      assert.equal(first.status, 200);
      assert.equal(first.headers['content-encoding'], 'gzip');
      assert.equal(first.headers['cache-control'], 'no-cache');
      assert.equal(first.headers.vary, 'Accept-Encoding');
      assert.equal(first.headers['x-content-type-options'], 'nosniff');
      assert.ok(first.body.length < source.length / 10, 'gzip shrinks the file');
      assert.equal(String(gunzipSync(first.body)), source);
      const etag = first.headers.etag;
      assert.match(etag, /^"[\w-]+"$/);

      const again = await get(port, '/app.js', {
        'accept-encoding': 'gzip',
        'if-none-match': etag,
      });
      assert.equal(again.status, 304);
      assert.equal(again.body.length, 0);

      // A browser without gzip gets the plain file and the same ETag.
      const plain = await get(port, '/app.js');
      assert.equal(plain.headers['content-encoding'], undefined);
      assert.equal(String(plain.body), source);
      assert.equal(plain.headers.etag, etag);

      // A changed file is sent again on a normal reload (the old ETag no longer matches).
      await writeFile(file, source + '// changed\n');
      const later = new Date(Date.now() + 5000);
      await utimes(file, later, later);
      const changed = await get(port, '/app.js', { 'if-none-match': etag });
      assert.equal(changed.status, 200);
      assert.notEqual(changed.headers.etag, etag);
      assert.match(String(changed.body), /\/\/ changed/);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('tiny files are not gzipped', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bookflip-static-'));
  const file = join(dir, 'tiny.js');
  await writeFile(file, 'export {};\n');
  try {
    await withServer(file, async (port) => {
      const response = await get(port, '/tiny.js', { 'accept-encoding': 'gzip' });
      assert.equal(response.status, 200);
      assert.equal(response.headers['content-encoding'], undefined);
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
