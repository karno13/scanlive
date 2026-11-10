// One per-source request-start gate shared by listing pages, detail pages, lifecycle checks and
// set descriptions: every request to a marketplace goes through readSourceHtml and this gate.
// - Each source has a base gap between requests (2 s; longer for sources known to throttle).
// - A provider Retry-After delays ALL subsequent requests to that source, not just the operation
//   which received the response.
// - Adaptive pace: a throttle or block (HTTP 429, 403, challenge) doubles the source's gap, up to
//   30 s; each successful answer shortens it by a tenth, back to the base. A new source needs no
//   special case: it slows itself down when it starts refusing.
// No CAPTCHA bypass or extra retries.
export const SOURCE_INTERVAL_MS = { 'Allegro Lokalnie': 8000 };
export const MAX_INTERVAL_MS = 30_000;

export function createMarketplaceGate({
  intervalMs = 2000,
  perSource = SOURCE_INTERVAL_MS,
  maxIntervalMs = MAX_INTERVAL_MS,
} = {}) {
  const states = new Map();
  const base = (source) => perSource[source] ?? intervalMs;
  const get = (source) => {
    if (!states.has(source))
      states.set(source, {
        nextAt: 0,
        cooldownUntil: 0,
        interval: base(source),
        queue: Promise.resolve(),
      });
    return states.get(source);
  };
  return {
    async acquire(source, { now = Date.now, pause, signal } = {}) {
      if (typeof pause !== 'function') throw TypeError('MARKETPLACE_PAUSE_REQUIRED');
      const state = get(source);
      const turn = state.queue.then(async () => {
        if (signal?.aborted) throw signal.reason || Error('ABORTED');
        const delay = Math.max(0, state.nextAt - now(), state.cooldownUntil - now());
        if (delay) await pause(delay, undefined, signal ? { signal } : undefined);
        if (signal?.aborted) throw signal.reason || Error('ABORTED');
        state.nextAt = Math.max(state.nextAt, state.cooldownUntil, now()) + state.interval;
      });
      state.queue = turn.catch(() => {});
      return turn;
    },
    cooldown(source, seconds, { now = Date.now } = {}) {
      if (!Number.isFinite(seconds) || seconds < 0) return;
      const state = get(source);
      state.cooldownUntil = Math.max(state.cooldownUntil, now() + Math.min(86400, seconds) * 1000);
    },
    /** The source refused (429, 403, challenge): twice the gap, at most `maxIntervalMs`. */
    slowDown(source) {
      const state = get(source);
      state.interval = Math.min(maxIntervalMs, Math.max(base(source), state.interval) * 2);
      return state.interval;
    },
    /** The source answered: a tenth shorter gap, never below its base. */
    speedUp(source) {
      const state = get(source);
      state.interval = Math.max(base(source), Math.round(state.interval * 0.9));
      return state.interval;
    },
    snapshot(source) {
      const state = get(source);
      return {
        nextAt: state.nextAt,
        cooldownUntil: state.cooldownUntil,
        intervalMs: state.interval,
        baseIntervalMs: base(source),
      };
    },
  };
}
export const sharedMarketplaceGate = createMarketplaceGate();
