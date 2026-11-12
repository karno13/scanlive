// @ts-check
// One server-sent event stream (/api/events) instead of every open tab polling. The server reads
// a few cheap fingerprints (scan state, review queue, sources) every couple of seconds while at
// least one client listens, and sends an event only when one of them changed. A route that knows it
// changed something calls notify() for an immediate event. Clients reconnect on their own
// (EventSource) and read the full state again after every (re)connection.

/**
 * @typedef {{ write: (chunk: string) => any, writeHead: Function, end: Function, on: Function, writableEnded?: boolean }} EventResponse
 * @typedef {Record<string, () => unknown>} Probes
 */

/**
 * @param {{ probes: Probes, intervalMs?: number, heartbeatMs?: number, headers?: Record<string, string> }} options
 */
export function createLiveEvents({
  probes,
  intervalMs = 2000,
  heartbeatMs = 25_000,
  headers = {},
}) {
  /** @type {Set<EventResponse>} */
  const clients = new Set();
  /** @type {Map<string, string>} */
  const last = new Map();
  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null;
  /** @type {ReturnType<typeof setInterval> | null} */
  let heartbeat = null;
  let sequence = 0;

  /** @param {string} kind */
  function fingerprint(kind) {
    try {
      return JSON.stringify(probes[kind]());
    } catch {
      return 'error';
    }
  }

  /** @param {string} kind @param {unknown} [data] */
  function broadcast(kind, data = {}) {
    const frame = `id: ${++sequence}\nevent: ${kind}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      if (client.writableEnded) clients.delete(client);
      else client.write(frame);
    }
  }

  function tick() {
    for (const kind of Object.keys(probes)) {
      const value = fingerprint(kind);
      if (last.get(kind) === value) continue;
      const known = last.has(kind);
      last.set(kind, value);
      // The first reading only sets the baseline: a fresh client reads the state itself.
      if (known) broadcast(kind, safeParse(value));
    }
  }

  function start() {
    if (timer) return;
    for (const kind of Object.keys(probes)) last.set(kind, fingerprint(kind));
    timer = setInterval(tick, intervalMs);
    heartbeat = setInterval(() => {
      for (const client of clients) client.write(': keep-alive\n\n');
    }, heartbeatMs);
    timer.unref?.();
    heartbeat.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    if (heartbeat) clearInterval(heartbeat);
    timer = heartbeat = null;
    last.clear();
  }

  return {
    /** Opens the stream for one client. @param {any} request @param {EventResponse} response */
    handle(request, response) {
      response.writeHead(200, {
        ...headers,
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      // Reconnect after 3 s when the connection drops (server restart, sleep, network).
      response.write(`retry: 3000\nevent: hello\ndata: {}\n\n`);
      clients.add(response);
      start();
      const leave = () => {
        clients.delete(response);
        if (!clients.size) stop();
      };
      request.on('close', leave);
      response.on('close', leave);
    },
    /** Sends an event now (a route changed the state), and re-reads the baselines. @param {string} kind */
    notify(kind, data = {}) {
      if (!clients.size) return;
      if (probes[kind]) last.set(kind, fingerprint(kind));
      broadcast(kind, data);
    },
    /** Checks the probes once (tests; the timer does this while clients listen). */
    tick,
    clients: () => clients.size,
    close() {
      for (const client of clients) client.end();
      clients.clear();
      stop();
    },
  };
}

/** @param {string} value */
function safeParse(value) {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
