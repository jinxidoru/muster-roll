// Shared, memoized access to the Wahapedia cross-reference DB so the manager
// and the preview don't each rebuild it. Invalidated after a data sync.

import { loadDB } from './wahapedia-store.js';

let cached = null;
let pending = null;

export async function getDB() {
  if (cached) return cached;
  if (!pending) pending = loadDB().then((db) => { cached = db; pending = null; return db; });
  return pending;
}

export function invalidateDB() { cached = null; pending = null; }
