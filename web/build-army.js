// Turn a stored army record's ORIGINAL export into the renderer-ready army
// model — recomputed every time it's opened, so GW lists always reflect the
// current Wahapedia data. Also derives the lightweight display summary the
// manager shows without needing Wahapedia loaded.

import { parseRoster, isNewRecruitRoster } from '../src/parse.js';
import { parseGwExport, buildArmyFromGw, isGwExport } from '../src/parse-gw.js';

// Detect a dropped file's format from its text. Returns { format, data } where
// data is the parsed JSON (NR) or the raw text (GW), or null if unrecognized.
export function detectSource(text) {
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  if (json && isNewRecruitRoster(json)) return { format: 'newrecruit', data: json };
  if (isGwExport(text)) return { format: 'gw', data: text };
  return null;
}

// Display summary from a source alone (no Wahapedia). Used for the manager card
// and stored on the record. { name, faction, detachment, points, unitCount }.
export function summaryFromSource(source) {
  if (source.format === 'newrecruit') {
    const a = parseRoster(source.data);
    return {
      name: a.meta.name, faction: a.meta.faction, detachment: a.meta.detachment,
      points: a.meta.points, unitCount: a.units.length,
    };
  }
  const p = parseGwExport(source.data);
  return {
    name: p.meta.name, faction: p.meta.subfaction || p.meta.faction,
    detachment: p.meta.detachment, points: p.meta.points,
    unitCount: p.units.length,
  };
}

// Full renderer-ready model from a record. New Recruit needs no Wahapedia; GW
// requires a cross-ref DB (throws a friendly error if it's missing).
export function armyFromRecord(record, { db, coreGlossary } = {}) {
  const source = record.source;
  if (source.format === 'newrecruit') {
    const army = parseRoster(source.data);
    army.coreGlossary = coreGlossary || {};
    return army;
  }
  if (source.format === 'gw') {
    if (!db) {
      const err = new Error('This list needs the Wahapedia datasheet data. Load it from the Armies page first.');
      err.code = 'NO_DATA';
      throw err;
    }
    return buildArmyFromGw(parseGwExport(source.data), db, { coreGlossary });
  }
  throw new Error(`Unknown army format: ${source.format}`);
}
