// Cross-reference engine: turn a bare datasheet reference (name + faction, which
// is all an official Games Workshop app export gives us) into the full army-unit
// shape the renderers consume — the same shape src/parse.js produces from a New
// Recruit export. Also resolves a detachment's stratagems, enhancements, and
// detachment rules.
//
// Input is the parsed Wahapedia CSV export (see src/wahapedia.js). Pure JS,
// browser-safe, no I/O: the caller supplies a `{ name: csvText }` map.
//
// IP note: this operates on Wahapedia (Games Workshop) data living on the user's
// device; it is never re-hosted. See src/wahapedia.js.

import { parseCsv, groupBy, indexBy, htmlToText } from './wahapedia.js';

// Files this engine needs. The fetch script pulls the whole export, but the
// browser only has to parse this subset (skips the 2 MB Datasheets_stratagems
// etc.), keeping the in-memory index small.
export const USED_FILES = [
  'Factions', 'Datasheets', 'Datasheets_models', 'Datasheets_wargear',
  'Datasheets_abilities', 'Abilities', 'Datasheets_keywords',
  'Datasheets_models_cost', 'Datasheets_unit_composition',
  'Stratagems', 'Enhancements', 'Detachment_abilities',
];

// --- small value formatters (Wahapedia columns -> the renderers' conventions)

// Append "+" to a bare skill value ("5" -> "5+"); leave "N/A", "-", "3+" alone.
function plus(v) {
  v = String(v ?? '').trim();
  return /^\d+$/.test(v) ? v + '+' : v;
}
// Invuln: Datasheets_models.inv_sv is a bare number ("5"); render "5+". Blank -> ''.
function inv(v) {
  v = String(v ?? '').trim();
  if (!v) return '';
  return /^\d+$/.test(v) ? v + '+' : v;
}
// Range: ranged weapons store a bare number ('24'); the renderers show '24"'.
function range(v) {
  v = String(v ?? '').trim();
  return /^\d+$/.test(v) ? v + '"' : v;
}
// AP already carries its sign in the export ('-2'); normalise '-0' -> '0'.
function ap(v) {
  v = String(v ?? '').trim();
  return v === '-0' ? '0' : v;
}
// Weapon keyword list: the export stores these lowercase ("rapid fire 1"); the
// NR data is ALL-CAPS and the renderers de-shout to Title Case. Upper-case here
// so both sources render identically ("Rapid Fire 1").
function kw(v) {
  return String(v ?? '').trim().toUpperCase();
}

// Normalize a datasheet / detachment name for fuzzy matching across sources:
// lower-case, drop punctuation (curly quotes, hyphens), collapse whitespace.
export function normName(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Build the cross-reference database from a `{ fileName: csvText }` map.
export function buildWahapediaDB(files) {
  const P = (n) => parseCsv(files[n] || '');

  const factions = P('Factions');
  const factionNameById = new Map(factions.map((f) => [f.id, f.name]));
  const factionIdByName = new Map(factions.map((f) => [normName(f.name), f.id]));

  const datasheets = P('Datasheets');
  const dsById = indexBy(datasheets, 'id');
  // name -> [rows] (a name can repeat across factions, e.g. generic Imperial units)
  const dsByName = new Map();
  for (const d of datasheets) {
    const k = normName(d.name);
    const list = dsByName.get(k);
    if (list) list.push(d); else dsByName.set(k, [d]);
  }

  const models = groupBy(P('Datasheets_models'), 'datasheet_id');
  const wargear = groupBy(P('Datasheets_wargear'), 'datasheet_id');
  const dsAbilities = groupBy(P('Datasheets_abilities'), 'datasheet_id');
  const abilityById = indexBy(P('Abilities'), 'id');
  const keywords = groupBy(P('Datasheets_keywords'), 'datasheet_id');
  const costs = groupBy(P('Datasheets_models_cost'), 'datasheet_id');
  const composition = groupBy(P('Datasheets_unit_composition'), 'datasheet_id');

  const stratagems = P('Stratagems');
  const enhancements = P('Enhancements');
  const detAbilities = P('Detachment_abilities');

  // --- datasheet lookup ----------------------------------------------------
  function findDatasheet(name, factionId) {
    const list = dsByName.get(normName(name));
    if (!list || !list.length) return null;
    if (list.length === 1) return list[0];
    if (factionId) {
      const inFaction = list.find((d) => d.faction_id === factionId);
      if (inFaction) return inFaction;
    }
    return list[0];
  }

  // --- statline(s) ---------------------------------------------------------
  function statsFor(id) {
    return (models.get(id) || []).map((m) => ({
      name: m.name,
      type: 'Unit',
      chars: { M: m.M, T: m.T, Sv: m.Sv, InSv: inv(m.inv_sv), W: m.W, LD: m.Ld, OC: m.OC },
    }));
  }

  // --- weapons -------------------------------------------------------------
  // Wahapedia's wargear table lists EVERY weapon option on the datasheet. When a
  // source export tells us the actual loadout (GW app bullet list), pass
  // `loadout` as an array of chosen weapon names and we keep only those — a
  // datasheet weapon matches if its name equals, extends, or is extended by a
  // chosen name (handles multi-profile weapons like "Killa jet – burna" vs the
  // export's base "Killa jet"). Pass null to keep all options.
  function weaponsFor(id, loadout) {
    const all = wargear.get(id) || [];
    const want = loadout && loadout.length ? loadout.map(normName) : null;
    const keep = (wName) => {
      if (!want) return true;
      const n = normName(wName);
      return want.some((c) => n === c || n.startsWith(c + ' ') || c.startsWith(n + ' '));
    };
    let rows = want ? all.filter((w) => keep(w.name)) : all;
    // Safety net: if NONE of the listed loadout names matched (naming drift, or a
    // datasheet that abstracts its wargear), show all the datasheet's weapons
    // rather than an empty list — and flag it so the caller can note it.
    let fallback = false;
    if (want && rows.length === 0 && all.length) { rows = all; fallback = true; }

    const ranged = [];
    const melee = [];
    for (const w of rows) {
      if (w.type === 'Melee') {
        melee.push({ name: w.name, chars: {
          Range: 'Melee', A: w.A, WS: plus(w.BS_WS), S: w.S, AP: ap(w.AP), D: w.D, Keywords: kw(w.description),
        } });
      } else if (w.type === 'Ranged') {
        ranged.push({ name: w.name, chars: {
          Range: range(w.range), A: w.A, BS: plus(w.BS_WS), S: w.S, AP: ap(w.AP), D: w.D, Keywords: kw(w.description),
        } });
      }
    }
    return { ranged, melee, fallback };
  }

  // --- abilities / keywords ------------------------------------------------
  function abilitiesFor(id) {
    const core = [];
    const faction = [];
    const abilities = [];
    const seen = new Set();
    for (const a of dsAbilities.get(id) || []) {
      let name = a.name;
      let text = a.description;
      if (!name && a.ability_id && abilityById.has(a.ability_id)) {
        const ref = abilityById.get(a.ability_id);
        name = ref.name;
        text = text || ref.description;
      }
      if (!name) continue;
      name = htmlToText(name);
      text = htmlToText(text);
      if (a.parameter && !name.includes(a.parameter)) name = `${name} ${a.parameter}`.trim();
      if (a.type === 'Core') { if (!seen.has('c:' + name)) { seen.add('c:' + name); core.push(name); } }
      else if (a.type === 'Faction') { if (!seen.has('f:' + name)) { seen.add('f:' + name); faction.push(name); } }
      else if (a.type === 'Wargear' || a.type === 'Wargear profile') { /* folded into weapon keywords */ }
      else { if (!seen.has('a:' + name)) { seen.add('a:' + name); abilities.push({ name, text }); } }
    }
    return { core, faction, abilities };
  }

  function keywordsFor(id) {
    const kws = [];
    const factions = [];
    const seen = new Set();
    for (const k of keywords.get(id) || []) {
      const name = (k.keyword || '').trim();
      if (!name || seen.has(name)) continue;
      seen.add(name);
      if (k.is_faction_keyword === 'true') factions.push(name);
      else kws.push(name);
    }
    return { keywords: kws, factions };
  }

  // Points for a given model count (match the cost row, else the first/cheapest).
  function pointsFor(id, modelCount) {
    const rows = costs.get(id) || [];
    if (!rows.length) return null;
    if (modelCount) {
      const hit = rows.find((r) => parseInt(r.description, 10) === modelCount);
      if (hit) return Number(hit.cost);
    }
    return Number(rows[0].cost);
  }

  // Build a full unit from a datasheet reference. `ref` = { name, factionId?,
  // models?, points?, enhancement? } — supply what the source export knows; the
  // rest is filled from Wahapedia.
  function unitFromRef(ref) {
    const ds = findDatasheet(ref.name, ref.factionId);
    if (!ds) return null;
    const id = ds.id;
    const { ranged, melee, fallback } = weaponsFor(id, ref.wargear);
    const { core, faction, abilities } = abilitiesFor(id);
    const { keywords: kws, factions } = keywordsFor(id);
    const stats = statsFor(id);
    const models = ref.models || inferModelCount(id);

    // Transport capacity rides on the datasheet; surface it as an ability so
    // both renderers show it (matches the NR pipeline's "Transport" ability).
    if (ds.transport && ds.transport.trim()) {
      abilities.push({ name: 'Transport', text: ds.transport.trim() });
    }

    const unit = {
      name: ds.name,
      entryType: 'unit',
      stats,
      ranged,
      melee,
      abilities,
      core,
      faction,
      rules: [],
      keywords: kws,
      factions,
      points: ref.points != null ? ref.points : pointsFor(id, models),
      models,
      attach: [],
      note: '',
      count: ref.count || 1,
    };
    if (fallback) unit.weaponsFallback = true;
    if (ref.enhancement) {
      unit.enhancement = resolveEnhancement(ref.enhancement, ref.detachment)
        || { name: ref.enhancement, points: null, text: '' };
    }
    return unit;
  }

  // Default model count from the cheapest unit-composition / cost row.
  function inferModelCount(id) {
    const rows = costs.get(id) || [];
    const n = rows.length ? parseInt(rows[0].description, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  // --- detachment-scoped lookups ------------------------------------------
  function resolveEnhancement(name, detachment) {
    const nn = normName(name);
    const nd = detachment ? normName(detachment) : '';
    const matches = enhancements.filter((e) => normName(e.name) === nn);
    const inDet = nd ? matches.find((e) => normName(e.detachment) === nd) : null;
    const e = inDet || matches[0];
    return e ? { name: e.name, points: Number(e.cost) || 0, text: htmlToText(e.description) } : null;
  }

  function stratagemsForDetachment(detachment) {
    const nd = normName(detachment);
    if (!nd) return [];
    return stratagems
      .filter((s) => normName(s.detachment) === nd)
      .map((s) => ({
        name: s.name, cp: Number(s.cp_cost) || 0, type: s.type,
        turn: s.turn, phase: s.phase, text: htmlToText(s.description),
      }));
  }

  function enhancementsForDetachment(detachment) {
    const nd = normName(detachment);
    if (!nd) return [];
    return enhancements
      .filter((e) => normName(e.detachment) === nd)
      .map((e) => ({ name: e.name, points: Number(e.cost) || 0, text: htmlToText(e.description) }));
  }

  function detachmentRules(detachment) {
    const nd = normName(detachment);
    if (!nd) return [];
    return detAbilities
      .filter((d) => normName(d.detachment) === nd)
      .map((d) => ({ name: d.name, text: htmlToText(d.description) }));
  }

  return {
    factionNameById, factionIdByName,
    findDatasheet, unitFromRef,
    stratagemsForDetachment, enhancementsForDetachment, detachmentRules, resolveEnhancement,
    counts: { datasheets: datasheets.length, factions: factions.length },
  };
}
