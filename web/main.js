// App entry point: boots the manager, wires hash routing between the army
// manager (landing) and a list's print preview, and builds the renderer-ready
// army model when a list is opened. The heavy typst engine loads lazily on the
// first preview (see web/app.js).

import { onRoute } from './router.js';
import { initManager, refreshList } from './manager.js';
import { showArmy } from './app.js';
import { armyStore } from './storage.js';
import { armyFromRecord } from './build-army.js';
import { getDB } from './data.js';

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
    try { db = await getDB(); } catch { /* handled below as missing data */ }
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

// Show a standalone message in the preview area (e.g. "load the data first"),
// with a way back to the manager.
function previewMessage(msg, isError = false) {
  appEl.hidden = true;
  loadingEl.hidden = false;
  loadingEl.innerHTML =
    `<p class="${isError ? 'error' : ''}">${msg}</p><p><a class="link" href="#/">← Back to armies</a></p>`;
}
