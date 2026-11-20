// One live channel from the server (/api/events, server-sent events) instead of timers. Events:
// scan (scan state or progress), queue (review queue / identification), source (a source started
// or stopped working), deals (a new deal was announced: deal-alerts.mjs). EventSource reconnects by itself; after every reconnection the page reads
// its state again (onReconnect), because events sent while it was away are lost.
export const LIVE_EVENTS = ['scan', 'queue', 'source', 'deals'];

export function connectLive({ onEvent, onReconnect = () => {}, onState = () => {}, url = '/api/events', EventSourceImpl = globalThis.EventSource } = {}) {
  if (typeof EventSourceImpl !== 'function') return { close() {} };
  let source = null;
  let opened = false;
  let closed = false;
  let retry = null;
  function connect() {
    source = new EventSourceImpl(url);
    source.addEventListener('hello', () => {
      onState('online');
      // The first connection comes with the page's own start-up reads.
      if (opened) onReconnect();
      opened = true;
    });
    for (const kind of LIVE_EVENTS)
      source.addEventListener(kind, (event) => {
        let data = {};
        try {
          data = JSON.parse(event.data || '{}');
        } catch {}
        onEvent(kind, data);
      });
    source.addEventListener('error', () => {
      if (closed) return;
      onState('reconnecting');
      // A closed stream (server restarted and refused, or HTTP error) is not retried by the
      // browser: open a new one ourselves.
      if (source.readyState === 2 && !retry)
        retry = setTimeout(() => {
          retry = null;
          if (!closed) connect();
        }, 3000);
    });
  }
  connect();
  return {
    close() {
      closed = true;
      clearTimeout(retry);
      source?.close();
    },
  };
}
