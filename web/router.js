// Tiny hash router so the browser back/forward buttons move between the army
// manager and a list's print preview (and deep-link to a specific list).
//   #/            -> { view: 'manager' }
//   #/army/<id>   -> { view: 'army', id }

export function parseRoute(hash = location.hash) {
  const m = /^#\/army\/(.+)$/.exec(hash);
  if (m) return { view: 'army', id: decodeURIComponent(m[1]) };
  return { view: 'manager' };
}

// Register a handler fired on load and on every hash change.
export function onRoute(handler) {
  const fire = () => handler(parseRoute());
  window.addEventListener('hashchange', fire);
  fire();
}

// Navigation helpers (push a new history entry).
export function goManager() { location.hash = '#/'; }
export function goArmy(id) { location.hash = `#/army/${encodeURIComponent(id)}`; }
