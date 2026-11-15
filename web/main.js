// App entry point: boots the manager, wires hash routing between the army
// manager (landing) and a list's print preview, and builds the renderer-ready
// army model when a list is opened. The heavy typst engine loads lazily on the
// first preview (see web/app.js).

import { onRoute } from './router.js';
import { initManager, refreshList } from './manager.js';
import { showArmy } from './app.js';
import { armyStore } from './storage.js';
import { armyFromRecord } from './build-army.js';
import { getDB, invalidateDB } from './data.js';
import { syncWahapedia, isDevHost } from './wahapedia-store.js';

const views = {
  manager: document.getElementById('manager'),
  preview: document.getElementById('preview-view'),
};
const appEl = document.getElementById('app');
const loadingEl = document.getElementById('loading');

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

onRoute((route) => {
  if (route.view === 'army') openArmy(route.id);
  else showManager();
});

function showManager() {
  views.preview.hidden = true;
  views.manager.hidden = false;
  refreshList();
}

async function openArmy(id) {
  views.manager.hidden = true;
  views.preview.hidden = false;

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
