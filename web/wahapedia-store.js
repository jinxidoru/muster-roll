// Fetch, cache, and build the Wahapedia cross-reference data on-device.
//
// Source resolution:
//   • Dev (localhost / private-LAN): load the CSVs the fetch script dropped in
//     data/wahapedia/ (served by the local dev server). Fast, offline, and lets
//     us iterate without hitting wahapedia.ru.
//   • Production: fetch through a configurable pass-through base URL. A browser
//     on the live site CANNOT fetch wahapedia.ru directly — it sends no CORS
//     headers — so a user-supplied pass-through (set once, stored locally) is
//     required. Direct-origin remains the documented default for when/if CORS
//     ever allows it.
//
// The cached CSV text lives in its OWN IndexedDB database, deliberately separate
// from the army store (web/storage.js) and never Firebase-bound: it is Games
// Workshop IP mirrored by Wahapedia, kept only on the user's device.

import { openDB, idbGet, idbPut, idbClear } from './idb.js';
import { WAHAPEDIA_BASE } from '../src/wahapedia.js';
import { buildWahapediaDB, USED_FILES } from '../src/wahapedia-index.js';

const DB_NAME = 'muster-roll/wahapedia';
const DB_VERSION = 1;
const FILES_STORE = 'files'; // key = csv name, value = text
const META_STORE = 'meta';   // key 'meta' -> { lastUpdate, syncedAt, base }

// The browser only needs the cross-ref subset plus the sync sentinel.
const SYNC_FILES = [...USED_FILES, 'Last_update'];

let dbPromise = null;
function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, (d) => {
      if (!d.objectStoreNames.contains(FILES_STORE)) d.createObjectStore(FILES_STORE);
      if (!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE);
    });
  }
  return dbPromise;
}

// --- source base URL --------------------------------------------------------
// Production pass-through base URL. A browser can't fetch wahapedia.ru directly
// (no CORS headers), so production fetches go through a pass-through we stand up
// and set here internally (see README). Empty until configured — while empty,
// prod falls back to the direct base and sync surfaces a clear CORS error.
const PASS_THROUGH_BASE = '';

export function isDevHost() {
  const h = location.hostname;
  return (
    /^(localhost|127\.|0\.0\.0\.0|::1|\[::1\])/.test(h) ||
    /^10\./.test(h) || /^192\.168\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h.endsWith('.local') || location.protocol === 'file:'
  );
}

// Where CSVs are fetched from this run. Dev: the local files the fetch script
// wrote under data/wahapedia/. Prod: the internal pass-through base.
export function sourceBase() {
  if (isDevHost()) return new URL('data/wahapedia', document.baseURI).href;
  return PASS_THROUGH_BASE || WAHAPEDIA_BASE;
}

async function fetchCsv(base, name) {
  const res = await fetch(`${base}/${name}.csv`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`${name}.csv → HTTP ${res.status}`);
  return res.text();
}

// --- meta / cache state -----------------------------------------------------
export async function getMeta() {
  return (await idbGet(await db(), META_STORE, 'meta')) || null;
}

export async function isCached() {
  const d = await db();
  for (const name of USED_FILES) {
    if ((await idbGet(d, FILES_STORE, name)) == null) return false;
  }
  return true;
}

// Parse "YYYY-MM-DD HH:MM:SS" out of Last_update.csv text.
function parseLastUpdate(text) {
  const m = String(text).replace(/^﻿/, '').match(/\d{4}-\d{2}-\d{2}[ T][\d:]+/);
  return m ? m[0] : '';
}

// Peek the remote Last_update without touching the cache. Returns '' on failure
// (e.g. CORS / no pass-through configured) so the caller can still offer a sync.
export async function remoteLastUpdate() {
  try { return parseLastUpdate(await fetchCsv(sourceBase(), 'Last_update')); }
  catch { return ''; }
}

// Download the data set and cache it. Skips work when already current unless
// `force`. onProgress(done, total, label) drives a UI. Returns { updated, lastUpdate }.
export async function syncWahapedia({ force = false, onProgress } = {}) {
  const base = sourceBase();
  const d = await db();

  const lastUpdate = parseLastUpdate(await fetchCsv(base, 'Last_update'));
  const meta = await getMeta();
  if (!force && meta && meta.lastUpdate && meta.lastUpdate === lastUpdate && (await isCached())) {
    return { updated: false, lastUpdate };
  }

  const total = USED_FILES.length;
  let done = 0;
  for (const name of USED_FILES) {
    const text = await fetchCsv(base, name);
    await idbPut(d, FILES_STORE, text, name);
    done += 1;
    if (onProgress) onProgress(done, total, name);
  }
  await idbPut(d, META_STORE, { lastUpdate, syncedAt: new Date().toISOString(), base }, 'meta');
  return { updated: true, lastUpdate };
}

// Build the cross-reference DB from the cached CSVs, or null if not cached.
export async function loadDB() {
  const d = await db();
  const files = {};
  for (const name of USED_FILES) {
    const text = await idbGet(d, FILES_STORE, name);
    if (text == null) return null;
    files[name] = text;
  }
  return buildWahapediaDB(files);
}

export async function clearWahapedia() {
  const d = await db();
  await idbClear(d, FILES_STORE);
  await idbClear(d, META_STORE);
}
