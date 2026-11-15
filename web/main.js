// App entry point: boots the manager, wires hash routing between the army
// manager (landing) and a list's print preview, and builds the renderer-ready
// army model when a list is opened. The heavy typst engine loads lazily on the
// first preview (see web/app.js).

import { onRoute, parseRoute } from './router.js';
import { initManager, refreshList, showMigration, hideMigration, showListLoading } from './manager.js';
import { showArmy } from './app.js';
import { armyStore, localArmyStore, setActiveStore } from './storage.js';
import { armyFromRecord } from './build-army.js';
import { getDB, invalidateDB } from './data.js';
import { syncWahapedia, isDevHost } from './wahapedia-store.js';

const $ = (id) => document.getElementById(id);
const views = { manager: $('manager'), preview: $('preview-view') };
const appEl = $('app');
const loadingEl = $('loading');

// Bundled core-keyword definitions (shared by both formats' glossaries). Absent
// file → stays {} and the glossary falls back to export-embedded definitions.
let coreGlossary = {};
(async () => {
  try {
    const res = await fetch('src/keywords.json');
    if (res.ok) coreGlossary = (await res.json()).keywords || {};
  } catch { /* feature simply off */ }
})();

initManager();

// --- auth (optional) --------------------------------------------------------
// Firebase loads lazily; if its CDN is unreachable the app stays local-only.
// `authReady` lets openArmy wait for the first auth result before choosing a
// backend, so a deep link to a cloud army resolves against the right store.
let resolveAuthReady;
let authSettled = false;
const authReady = new Promise((r) => { resolveAuthReady = r; });
authReady.then(() => { authSettled = true; });
initAuth();

async function initAuth() {
  let fb;
  try { fb = await import('./firebase.js'); }
  catch { resolveAuthReady(); return; } // local-only

  const authEl = $('auth');
  const signInBtn = $('sign-in');
  const signOutBtn = $('sign-out');
  const userEl = $('auth-user');
  const avatar = $('auth-avatar');
  const nameEl = $('auth-name');
  authEl.hidden = false;
  signInBtn.addEventListener('click', () => { signInBtn.disabled = true; fb.signIn().catch(() => {}).finally(() => { signInBtn.disabled = false; }); });
  signOutBtn.addEventListener('click', () => fb.signOutUser());

  let first = true;
  fb.onAuthChange(async (user) => {
    setActiveStore(user ? fb.makeFirestoreStore(user.uid) : localArmyStore);
    // top-right UI
    signInBtn.hidden = !!user;
    userEl.hidden = !user;
    if (user) { avatar.src = user.photoURL || ''; nameEl.textContent = user.displayName || user.email || 'Signed in'; }
    hideMigration();
    if (user) await offerMigration(); // compare local vs cloud, offer to move
    if (first) { first = false; resolveAuthReady(); }
    if (parseRoute().view === 'manager') refreshList();
  });
}

// After sign-in, offer to move browser-stored armies that aren't in the account
// yet up to the cloud (moving deletes the local copy).
async function offerMigration() {
  let cloud;
  try { cloud = await armyStore.list(); } catch { return; }
  const cloudIds = new Set(cloud.map((a) => a.id));
  const locals = (await localArmyStore.list()).filter((a) => !cloudIds.has(a.id));
  if (!locals.length) return;
  showMigration(locals.length, async () => {
    for (const rec of locals) { await armyStore.put(rec); await localArmyStore.remove(rec.id); }
    hideMigration();
    await refreshList();
  });
}

onRoute((route) => {
  if (route.view === 'army') openArmy(route.id);
  else showManager();
});

function showManager() {
  views.preview.hidden = true;
  views.manager.hidden = false;
  // On first load, wait for auth to settle before rendering the list, so the
  // empty-state welcome doesn't flash before signed-in cloud armies arrive.
  if (authSettled) { refreshList(); return; }
  showListLoading();
  authReady.then(() => { if (parseRoute().view === 'manager') refreshList(); });
}

async function openArmy(id) {
  views.manager.hidden = true;
  views.preview.hidden = false;

  await authReady; // ensure the right backend (local vs cloud) is active first
  const record = await armyStore.get(id);
  if (!record) { location.hash = '#/'; return; }

  let db = null;
  if (record.format === 'gw') {
    try { db = await getDB(); } catch { /* fall through to auto-load */ }
    // A GW list needs the Wahapedia data; if it isn't cached yet, pull it now on
    // the loading screen (rather than sending the user back to the manager).
    if (!db) {
      db = await autoLoadData();
      if (!db) return; // autoLoadData rendered an error with a way back
    }
  }

  let model;
  try {
    model = armyFromRecord(record, { db, coreGlossary });
  } catch (err) {
    previewMessage(err.message, true);
    return;
  }

  try { await showArmy(model); }
  catch { /* engine error already rendered by showArmy */ }
}

// Download + cache the Wahapedia data onto the loading screen, then return the
// built DB (or null, having shown an error). Shares the preview loading area so
// it flows straight into the engine-loading spinner.
async function autoLoadData() {
  showLoading('Loading datasheet data…');
  try {
    await syncWahapedia({
      onProgress: (done, total) => showLoading(`Loading datasheet data… (${done}/${total})`),
    });
    invalidateDB();
    const db = await getDB();
    if (!db) { previewMessage('Datasheet data could not be loaded.', true); return null; }
    return db;
  } catch (err) {
    previewMessage(
      `Couldn't load datasheet data: ${err.message}` +
      (isDevHost() ? '' : ' The datasheet-data service isn’t available yet.'),
      true,
    );
    return null;
  }
}

// Spinner + message in the preview loading area (same screen as engine loading).
function showLoading(msg) {
  appEl.hidden = true;
  loadingEl.hidden = false;
  loadingEl.innerHTML = `<div class="spinner" aria-hidden="true"></div><p>${msg}</p>`;
}

// Show a standalone message in the preview area (e.g. "load the data first"),
// with a way back to the manager.
function previewMessage(msg, isError = false) {
  appEl.hidden = true;
  loadingEl.hidden = false;
  loadingEl.innerHTML =
    `<p class="${isError ? 'error' : ''}">${msg}</p><p><a class="link" href="#/">← Back to armies</a></p>`;
}
