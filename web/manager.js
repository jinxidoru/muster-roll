// The army-list manager: the landing view. Lists saved armies (with format,
// faction, points, and when they were added), lets you rename/delete them, and
// hosts the Wahapedia datasheet-data controls (load / refresh / sync status).
// Uploading parses a dropped export just enough to show a summary and stores the
// ORIGINAL export — no cross-referenced data is persisted (see web/storage.js).

import { armyStore } from './storage.js';
import { detectSource, summaryFromSource } from './build-army.js';
import { goArmy } from './router.js';
import { getDB, invalidateDB } from './data.js';
import { isDevHost, getMeta, isCached, syncWahapedia, clearWahapedia } from './wahapedia-store.js';

const $ = (id) => document.getElementById(id);

let els = null;
function cache() {
  els = {
    drop: $('drop'), file: $('file'), pick: $('pick'), uploadStatus: $('upload-status'),
    pasteText: $('paste-text'), pasteAdd: $('paste-add'),
    list: $('army-list'), empty: $('army-empty'), deleteAll: $('delete-all'),
    armiesHeading: $('armies-heading'), listLoading: $('army-loading'),
    waStatus: $('wahapedia-status'), waSync: $('wahapedia-sync'), waUnload: $('wahapedia-unload'),
    migrate: $('migrate-banner'), migrateText: $('migrate-text'),
    migrateMove: $('migrate-move'), migrateDismiss: $('migrate-dismiss'),
  };
}

export function initManager() {
  cache();

  // --- upload (drag/drop + picker) ---------------------------------------
  els.pick.addEventListener('click', () => els.file.click());
  els.file.addEventListener('change', () => {
    if (els.file.files[0]) addFile(els.file.files[0]);
    els.file.value = '';
  });
  ['dragover', 'dragenter'].forEach((ev) =>
    els.drop.addEventListener(ev, (e) => { e.preventDefault(); els.drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) =>
    els.drop.addEventListener(ev, () => els.drop.classList.remove('over')));
  els.drop.addEventListener('drop', (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) addFile(f);
  });

  // Paste the export text directly as an alternative to a file.
  els.pasteAdd.addEventListener('click', async () => {
    const text = els.pasteText.value;
    if (!text.trim()) { setUpload('Paste an export first.', true); return; }
    if (await addText(text, '')) els.pasteText.value = '';
  });

  // --- Wahapedia controls -------------------------------------------------
  els.waSync.addEventListener('click', doSync);
  els.migrateDismiss.addEventListener('click', hideMigration);
  // Dev-only: clear the cached Wahapedia data so the auto-load flow can be tested.
  els.waUnload.hidden = !isDevHost();
  els.waUnload.addEventListener('click', async () => {
    await clearWahapedia();
    invalidateDB();
    await refreshWahapedia();
  });
  refreshWahapedia();

  // Delete-all: a press-and-hold button whose fill grows while held and only
  // fires once fully filled (releasing early cancels). No accidental wipes.
  const cancelHold = () => els.deleteAll.classList.remove('holding');
  els.deleteAll.addEventListener('pointerdown', (e) => { e.preventDefault(); els.deleteAll.classList.add('holding'); });
  els.deleteAll.addEventListener('pointerup', cancelHold);
  els.deleteAll.addEventListener('pointerleave', cancelHold);
  els.deleteAll.addEventListener('pointercancel', cancelHold);
  els.deleteAll.addEventListener('transitionend', async (e) => {
    if (e.propertyName !== 'width' || !els.deleteAll.classList.contains('holding')) return;
    els.deleteAll.classList.remove('holding');
    for (const a of await armyStore.list()) await armyStore.remove(a.id);
    await refreshList();
  });
}

// Show just a spinner in the list panel (used on first load while auth/cloud
// data settles, so the empty-state welcome doesn't flash before cloud armies).
export function showListLoading() {
  els.listLoading.hidden = false;
  els.list.hidden = true;
  els.empty.hidden = true;
  els.armiesHeading.hidden = true;
  els.deleteAll.hidden = true;
}

// Called by the router each time the manager view is shown.
export async function refreshList() {
  const armies = await armyStore.list();
  els.listLoading.hidden = true;
  els.list.hidden = false;
  els.list.innerHTML = '';
  els.empty.hidden = armies.length > 0;
  els.armiesHeading.hidden = armies.length === 0;
  els.deleteAll.hidden = armies.length === 0;
  for (const a of armies) els.list.appendChild(armyCard(a));
}

// --- uploading --------------------------------------------------------------
async function addFile(file) {
  setUpload('Reading…');
  let text;
  try { text = await file.text(); }
  catch (err) { setUpload(`Couldn't read that file: ${err.message}`, true); return; }
  await addText(text, file.name.replace(/\.[^.]+$/, ''));
}

// Add an army from raw export text (drop, picker, or paste). The format is
// determined from the CONTENTS, not a file extension. Returns true on success.
async function addText(text, suggestedName) {
  const source = detectSource(text);
  if (!source) {
    setUpload('Unrecognized text — expected a New Recruit JSON export or a GW app text export.', true);
    return false;
  }
  let summary;
  try { summary = summaryFromSource(source); }
  catch (err) { setUpload(`Couldn't parse that export: ${err.message}`, true); return false; }

  const record = {
    name: summary.name || suggestedName || `${summary.faction || 'Untitled'} army`,
    format: source.format,
    faction: summary.faction || '',
    detachment: summary.detachment || '',
    points: summary.points,
    unitCount: summary.unitCount,
    source,
  };
  const saved = await armyStore.put(record);
  setUpload(`Added “${saved.name}”.`);
  await refreshList();
  return true;
}

// --- army list cards --------------------------------------------------------
function armyCard(a) {
  const li = document.createElement('li');
  li.className = 'army-card';

  const main = document.createElement('button');
  main.type = 'button';
  main.className = 'army-open';
  main.addEventListener('click', () => goArmy(a.id));

  const title = document.createElement('div');
  title.className = 'army-title';
  const nm = document.createElement('span');
  nm.className = 'army-name';
  nm.textContent = a.name;
  const badge = document.createElement('span');
  badge.className = `badge badge-${a.format}`;
  badge.textContent = a.format === 'gw' ? 'GW app' : 'New Recruit';
  title.append(nm, badge);

  const meta = document.createElement('div');
  meta.className = 'army-meta';
  const bits = [a.faction, a.detachment, a.points != null ? `${a.points} pts` : null,
    a.unitCount != null ? `${a.unitCount} units` : null].filter(Boolean);
  meta.textContent = bits.join(' · ');

  const when = document.createElement('div');
  when.className = 'army-when';
  when.textContent = `Added ${fmtDate(a.createdAt)}${a.updatedAt && a.updatedAt !== a.createdAt ? ` · updated ${fmtDate(a.updatedAt)}` : ''}`;

  main.append(title, meta, when);

  const actions = document.createElement('div');
  actions.className = 'army-actions';
  const rename = iconBtn('Rename', 'rename');
  rename.addEventListener('click', async () => {
    const name = prompt('Rename army', a.name);
    if (name && name.trim()) { await armyStore.rename(a.id, name.trim()); await refreshList(); }
  });
  const del = deleteHoldBtn(a);
  actions.append(rename, del);

  li.append(main, actions);
  return li;
}

function iconBtn(label, kind) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = `army-act army-act-${kind}`;
  b.title = label;
  b.setAttribute('aria-label', label);
  b.textContent = kind === 'delete' ? '🗑' : '✎';
  return b;
}

// A press-and-hold delete for one army: a red fill rises while held and only
// deletes once full (release early cancels) — same model as "delete all", no popup.
function deleteHoldBtn(a) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'army-act army-act-delete hold-act';
  b.title = `Hold to delete “${a.name}”`;
  b.setAttribute('aria-label', b.title);
  const fill = document.createElement('span');
  fill.className = 'hold-act-fill';
  fill.setAttribute('aria-hidden', 'true');
  const icon = document.createElement('span');
  icon.className = 'hold-act-icon';
  icon.textContent = '🗑';
  b.append(fill, icon);
  const cancel = () => b.classList.remove('holding');
  b.addEventListener('pointerdown', (e) => { e.preventDefault(); b.classList.add('holding'); });
  b.addEventListener('pointerup', cancel);
  b.addEventListener('pointerleave', cancel);
  b.addEventListener('pointercancel', cancel);
  b.addEventListener('transitionend', async (e) => {
    if (e.propertyName !== 'width' || !b.classList.contains('holding')) return;
    b.classList.remove('holding');
    await armyStore.remove(a.id);
    await refreshList();
  });
  return b;
}

// --- sign-in migration offer ------------------------------------------------
// Shown by main.js when, after Google sign-in, there are browser-stored armies
// not yet in the account. "Move" copies them to the cloud and deletes the local
// copies (handled by the onMove callback main.js supplies).
export function showMigration(count, onMove) {
  els.migrateText.textContent =
    `You have ${count} ${count === 1 ? 'army' : 'armies'} saved on this device. `
    + `Move ${count === 1 ? 'it' : 'them'} to your account? (removes the local ${count === 1 ? 'copy' : 'copies'})`;
  els.migrateMove.onclick = async () => {
    els.migrateMove.disabled = true;
    try { await onMove(); } finally { els.migrateMove.disabled = false; }
  };
  els.migrate.hidden = false;
}
export function hideMigration() { if (els && els.migrate) els.migrate.hidden = true; }

// --- Wahapedia data panel ---------------------------------------------------
async function refreshWahapedia() {
  const dev = isDevHost();
  const cached = await isCached();
  const meta = await getMeta();
  if (cached && meta) {
    els.waStatus.innerHTML =
      `Loaded — Wahapedia data from <strong>${meta.lastUpdate || 'unknown date'}</strong>` +
      `<br /><span class="hint">Synced ${fmtDate(meta.syncedAt)}${dev ? ' · dev (local files)' : ''}</span>`;
    els.waSync.textContent = 'Refresh';
  } else {
    els.waStatus.innerHTML = 'Not loaded. GW app lists need Wahapedia datasheet data to fill in stats.';
    els.waSync.textContent = 'Load data';
  }
}

async function doSync() {
  els.waSync.disabled = true;
  els.waStatus.textContent = 'Syncing…';
  try {
    const res = await syncWahapedia({
      force: false,
      onProgress: (done, total, name) => {
        els.waStatus.textContent = `Downloading ${done}/${total}… (${name})`;
      },
    });
    invalidateDB();
    await getDB(); // warm the cache
    els.waStatus.textContent = res.updated ? 'Updated.' : 'Already up to date.';
  } catch (err) {
    els.waStatus.innerHTML = `<span class="err">Sync failed: ${err.message}</span>` +
      (isDevHost() ? '' : '<br /><span class="hint">The datasheet-data service isn’t reachable right now.</span>');
  } finally {
    els.waSync.disabled = false;
    await refreshWahapedia();
  }
}

// --- helpers ----------------------------------------------------------------
function setUpload(msg, isError = false) {
  els.uploadStatus.textContent = msg;
  els.uploadStatus.classList.toggle('error', isError);
}

function fmtDate(iso) {
  if (!iso) return '';
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}
