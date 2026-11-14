// Persistence for saved army lists. The public surface is a tiny async document
// store (list / get / put / remove) deliberately shaped like a Firestore
// collection, so this IndexedDB backing can later be swapped for Firebase with
// no change to callers.
//
// An army RECORD holds the ORIGINAL export (New Recruit JSON, or GW app text)
// plus cached display metadata — but NEVER the cross-referenced datasheets. For
// a GW list in particular, stats/weapons/abilities are recomputed from Wahapedia
// at view time, so a data refresh keeps every saved list current. Wahapedia data
// itself lives in a separate store (web/wahapedia-store.js) and is intentionally
// NOT part of this (Firebase-bound) layer — it is Games Workshop IP.
//
// Record shape:
//   {
//     id, name, format: 'newrecruit' | 'gw',
//     faction, detachment, points, unitCount,   // cached for the manager list
//     createdAt, updatedAt,                      // ISO strings
//     source: { format, data }                   // data: NR = JSON object; GW = raw text
//   }

import { openDB, idbGet, idbGetAll, idbPut, idbDelete } from './idb.js';

const DB_NAME = '40k-roster-pdf/armies';
const DB_VERSION = 1;
const STORE = 'armies';

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, (d) => {
      if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE, { keyPath: 'id' });
    });
  }
  return dbPromise;
}

function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'a' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export const armyStore = {
  // All records, newest-updated first. Records are small (metadata + one export)
  // so loading them all is fine; a Firestore backing would page instead.
  async list() {
    const all = await idbGetAll(await db(), STORE);
    return all.sort((a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''));
  },

  async get(id) {
    return (await idbGet(await db(), STORE, id)) || null;
  },

  // Create or update. Assigns id/createdAt on first save and always bumps
  // updatedAt. Returns the stored record.
  async put(record, now = new Date().toISOString()) {
    const rec = { ...record };
    if (!rec.id) rec.id = uuid();
    if (!rec.createdAt) rec.createdAt = now;
    rec.updatedAt = now;
    await idbPut(await db(), STORE, rec);
    return rec;
  },

  async remove(id) {
    await idbDelete(await db(), STORE, id);
  },

  // Convenience: rename, returning the updated record (or null if missing).
  async rename(id, name) {
    const rec = await this.get(id);
    if (!rec) return null;
    rec.name = name;
    return this.put(rec);
  },
};
