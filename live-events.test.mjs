// Stage 1 of the 11.2026 review: one server-sent event stream replaces the two client timers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { readFile } from 'node:fs/promises';
import { request as httpRequest } from 'node:http';
import { createLiveEvents } from './live-events.mjs';
import { createLocalAppServer } from './local-app.mjs';
import { connectLive } from './app/core/live.js';

function fakeClient() {
  const request = new EventEmitter();
  const response = new EventEmitter();
  response.frames = [];
  response.writableEnded = false;
  response.writeHead = (status, headers) => {
    response.status = status;
    response.headers = headers;
  };
  response.write = (chunk) => response.frames.push(chunk);
  response.end = () => {
    response.writableEnded = true;
  };
  return { request, response };
}

test('an event is sent only when its fingerprint changed; the first reading is the baseline', () => {
  let queue = { decisions: 240 };
  let scan = { status: 'idle' };
  const live = createLiveEvents({
    probes: { queue: () => queue, scan: () => scan, source: () => [] },
    intervalMs: 60_000,
    headers: { 'X-Content-Type-Options': 'nosniff' },
  });
  const { request, response } = fakeClient();
  live.handle(request, response);
  try {
    assert.equal(response.status, 200);
    assert.equal(response.headers['Content-Type'], 'text/event-stream; charset=utf-8');
    assert.equal(response.headers['X-Content-Type-Options'], 'nosniff');
    assert.match(response.frames[0], /^retry: 3000\nevent: hello\n/);
    live.tick();
    assert.equal(response.frames.length, 1, 'nothing changed, nothing sent');
    queue = { decisions: 239 };
    live.tick();
    assert.equal(response.frames.length, 2);
    assert.match(response.frames[1], /^id: \d+\nevent: queue\ndata: \{"decisions":239\}\n\n$/);
    scan = { status: 'running' };
    live.tick();
    assert.match(response.frames[2], /event: scan\ndata: \{"status":"running"\}/);
    live.notify('source', { changed: true });
    assert.match(response.frames[3], /event: source\n/);
    assert.equal(live.clients(), 1);
    request.emit('close');
    assert.equal(live.clients(), 0, 'a closed tab leaves; the timer stops with the last one');
  } finally {
    live.close();
  }
});

test('a broken probe does not stop the others', () => {
  let count = 1;
  const live = createLiveEvents({
    probes: {
      scan: () => {
        throw Error('boom');
      },
      queue: () => ({ count }),
    },
    intervalMs: 60_000,
  });
  const { request, response } = fakeClient();
  live.handle(request, response);
  try {
    count = 2;
    live.tick();
    assert.ok(response.frames.some((frame) => frame.includes('event: queue')));
  } finally {
    live.close();
  }
});

test('GET /api/events streams from the app server and closing the server ends the stream', async () => {
  const server = createLocalAppServer({ catalogProvider: () => null });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const first = await new Promise((resolve, reject) => {
    const request = httpRequest(
      { host: '127.0.0.1', port, path: '/api/events', headers: { Host: `127.0.0.1:${port}` } },
      (response) => {
        response.setEncoding('utf8');
        response.once('data', (chunk) => resolve({ response, chunk, request }));
      },
    );
    request.on('error', reject);
    request.end();
  });
  assert.equal(first.response.statusCode, 200);
  assert.equal(first.response.headers['content-type'], 'text/event-stream; charset=utf-8');
  assert.match(first.chunk, /event: hello/);
  const ended = new Promise((resolve) => first.response.on('end', resolve));
  await new Promise((resolve) => server.close(resolve));
  await ended;
});

class FakeEventSource {
  static instances = [];
  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.listeners = new Map();
    FakeEventSource.instances.push(this);
  }
  addEventListener(type, listener) {
    this.listeners.set(type, [...(this.listeners.get(type) || []), listener]);
  }
  emit(type, data) {
    for (const listener of this.listeners.get(type) || []) listener({ data });
  }
  close() {
    this.readyState = 2;
  }
}

test('the page re-reads its state after a reconnection, not after the first connection', () => {
  FakeEventSource.instances = [];
  const events = [];
  let reconnects = 0;
  const states = [];
  const live = connectLive({
    EventSourceImpl: FakeEventSource,
    onEvent: (kind, data) => events.push([kind, data]),
    onReconnect: () => reconnects++,
    onState: (value) => states.push(value),
  });
  const source = FakeEventSource.instances[0];
  assert.equal(source.url, '/api/events');
  source.emit('hello', '{}');
  assert.equal(reconnects, 0);
  source.emit('queue', '{"decisions":3}');
  source.emit('scan', 'not json');
  assert.deepEqual(events, [
    ['queue', { decisions: 3 }],
    ['scan', {}],
  ]);
  source.emit('error');
  source.emit('hello', '{}');
  assert.equal(reconnects, 1);
  assert.deepEqual(states, ['online', 'reconnecting', 'online']);
  live.close();
});

test('the app has no polling timers left and no "Odśwież" button', async () => {
  const app = await readFile(new URL('./app/app.js', import.meta.url), 'utf8');
  const run = await readFile(new URL('./app/views/scan-run.js', import.meta.url), 'utf8');
  assert.doesNotMatch(app, /setInterval\(/);
  assert.doesNotMatch(run, /setTimeout\(refresh, (?:1500|5000)\)/);
  for (const handler of [
    "kind === 'queue' ? onQueueChange()",
    "kind === 'scan' ? onScanChange()",
    'onSourceChange()',
  ])
    assert.ok(app.includes(handler), handler);
});
