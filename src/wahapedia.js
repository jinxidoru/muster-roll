// Shared, browser-safe helpers for the Wahapedia Warhammer 40k 10e CSV data
// export (https://wahapedia.ru/wh40k10ed/the-rules/data-export/). Pure JS:
// parsing + indexing only, NO I/O. How the bytes are fetched (dev-local files
// vs a production pass-through) is the caller's concern — see web/wahapedia.js
// and scripts/fetch-wahapedia.js.
//
// IMPORTANT: this data is Games Workshop IP mirrored by Wahapedia. It is never
// committed to this repo and never re-hosted by us — it is pulled onto the
// user's device (dev: local files under data/wahapedia/; prod: through a
// pass-through the user configures) and kept there. See [[project-overview]].

// 11th edition (current). Wahapedia keeps older editions at wh40k10ed/wh40k9ed,
// but the live game — and the GW app's exports — are 11e, so we track that path.
export const WAHAPEDIA_BASE = 'https://wahapedia.ru/wh40k11ed';

// Every CSV in the export. Order is roughly by dependency (reference tables
// first) but parsing is order-independent. `Last_update` is the sync sentinel.
export const WAHAPEDIA_FILES = [
  'Factions',
  'Source',
  'Abilities',
  'Detachment_abilities',
  'Stratagems',
  'Enhancements',
  'Datasheets',
  'Datasheets_abilities',
  'Datasheets_keywords',
  'Datasheets_models',
  'Datasheets_options',
  'Datasheets_wargear',
  'Datasheets_unit_composition',
  'Datasheets_models_cost',
  'Datasheets_stratagems',
  'Datasheets_enhancements',
  'Datasheets_detachment_abilities',
  'Datasheets_leader',
  'Last_update',
];

// Parse a Wahapedia pipe-delimited CSV into an array of row objects keyed by
// the header. Format quirks handled here:
//   - a leading UTF-8 BOM,
//   - '|'-separated columns with a trailing '|' terminating every record,
//   - CRLF line endings,
//   - fields are NOT quoted and '|' never appears inside a field, BUT a field
//     (e.g. a long rules description) may contain raw newlines — so we join
//     physical lines until the record closes with its trailing '|'.
export function parseCsv(text) {
  text = String(text).replace(/^﻿/, '');
  const records = [];
  let buf = null;
  for (const raw of text.split('\n')) {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    buf = buf === null ? line : buf + '\n' + line;
    if (buf.endsWith('|')) { records.push(buf); buf = null; }
  }
  if (buf !== null && buf.trim()) records.push(buf); // tolerate a missing terminator
  if (!records.length) return [];

  const header = splitRow(records[0]);
  const rows = [];
  for (let i = 1; i < records.length; i++) {
    const cells = splitRow(records[i]);
    if (cells.length === 1 && cells[0] === '') continue; // blank line
    const o = {};
    for (let c = 0; c < header.length; c++) o[header[c]] = cells[c] ?? '';
    rows.push(o);
  }
  return rows;
}

// One record string -> array of field values (drop the single trailing '|').
function splitRow(rec) {
  const body = rec.endsWith('|') ? rec.slice(0, -1) : rec;
  return body.split('|');
}

// Wahapedia rules text is HTML (<b>, <br>, <span class="kwb">KEYWORD</span>, …).
// Convert to plain text with newlines preserved so the renderers' clean()/markup
// helpers get something sane. Keeps <br> and block ends as newlines, drops all
// other tags, decodes the handful of entities that actually appear.
export function htmlToText(s) {
  return String(s ?? '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|tr)>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&rsquo;/gi, '’')
    .replace(/&lsquo;/gi, '‘')
    .replace(/&[rl]dquo;/gi, '"')
    .replace(/&#?[a-z0-9]+;/gi, '') // drop any remaining entities
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Group an array of rows into a Map keyed by one column's value (many rows per
// key). Rows with an empty key are skipped.
export function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (!k) continue;
    const list = m.get(k);
    if (list) list.push(r); else m.set(k, [r]);
  }
  return m;
}

// Index an array of rows into a Map keyed by one column's value (one row per
// key; first row wins).
export function indexBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key];
    if (k && !m.has(k)) m.set(k, r);
  }
  return m;
}
