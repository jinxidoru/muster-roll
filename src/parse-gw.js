// Parse an official Games Workshop app ("Warhammer 40,000" companion app) list
// export — plain text — into the same clean army model the renderers consume
// (see src/parse.js for the New Recruit equivalent).
//
// The GW export lists only NAMES: unit names, per-model wargear, enhancements,
// the detachment, and points. It carries NO characteristics. Those are filled
// in by cross-referencing Wahapedia (see src/wahapedia-index.js): parseGwExport()
// does the structural text parse (no data needed); buildArmyFromGw() combines
// that parse with a Wahapedia DB to produce the full army model.
//
// Export shape (both header variants handled):
//
//   <Roster Name> (<current total> Points)      <- line 1 (optional)
//
//   <Faction>                                    <- a Wahapedia faction name
//   [<Subfaction / Chapter>]                     <- optional display-only line
//   <Detachment> (N Detachment Points)           <- may be "A and B"
//   [<Mission etc.>]                             <- other header lines (ignored)
//   <Battle Size> (N Points)                     <- Combat Patrol/Incursion/…
//
//   [ERRORS … ]                                  <- warnings block (skipped)
//   <SECTION HEADER>                             <- CHARACTERS/BATTLELINE/…
//   <Unit> (N Points)
//     • Warlord
//     • Attached as: <role>
//     • Enhancements: <name>
//     • Nx <Model>                               <- model group…
//        ◦ Mx <Weapon>                           <-   …its weapons
//     • 1x <Weapon>                              <- single-model unit's weapon

const BULLET = '•';
const SUBBULLET = '◦';

// Lines that head a datasheet section (not units themselves). Matched case-
// insensitively against the whole trimmed line.
const SECTION_HEADERS = new Set([
  'attached units', 'characters', 'battleline', 'other datasheets',
  'dedicated transports', 'allied units', 'fortifications', 'epic heroes',
  'infantry', 'swarms', 'monsters', 'vehicles', 'mounted', 'beasts',
]);

// 10e battle-size names, used to tell the header's battle-size line (a game-size
// limit) apart from the roster-name line (the current army total).
const BATTLE_SIZES = ['Combat Patrol', 'Incursion', 'Strike Force', 'Onslaught'];

// A "<text> (<number> Points)" line → { name, points }, else null.
function pointsLine(line) {
  const m = line.match(/^(.*?)\s*\(([\d,]+)\s*Points?\)\s*$/i);
  if (!m) return null;
  return { name: m[1].trim(), points: Number(m[2].replace(/,/g, '')) };
}

// "Nx Something" → { count, name }, else { count: 1, name: line }.
function countLine(text) {
  const m = text.match(/^(\d+)\s*x\s+(.*)$/i);
  return m ? { count: Number(m[1]), name: m[2].trim() } : { count: 1, name: text.trim() };
}

function isSectionHeader(line) {
  const l = line.toLowerCase();
  if (SECTION_HEADERS.has(l)) return true;
  // "Attached unit 1", "Attached unit 2", … group labels.
  if (/^attached unit\s+\d+$/i.test(line)) return true;
  return false;
}

// A quick, cheap signature check so the app can auto-detect format on upload.
export function isGwExport(text) {
  if (typeof text !== 'string') return false;
  if (/^\s*\{/.test(text)) return false; // JSON (New Recruit)
  return /Exported with App Version/i.test(text) ||
    (text.includes(BULLET) && /\(\d[\d,]*\s*Points?\)/i.test(text));
}

// Structural parse — no Wahapedia data required. Returns header meta plus a list
// of unit references ({ name, points, models, warlord, attachedAs, enhancement,
// wargear:[names] }) ready for cross-reference.
export function parseGwExport(text) {
  const rawLines = String(text).replace(/\r\n?/g, '\n').split('\n');
  const warnings = [];

  // --- split header from body ---------------------------------------------
  // The body begins at the first section header. Everything before (minus an
  // ERRORS block) is the header.
  let bodyStart = rawLines.length;
  for (let i = 0; i < rawLines.length; i++) {
    const t = rawLines[i].trim();
    if (!t) continue;
    if (t.toUpperCase() === 'ERRORS') continue; // handled below
    if (isSectionHeader(t)) { bodyStart = i; break; }
  }

  const headerLines = [];
  for (let i = 0; i < bodyStart; i++) {
    const t = rawLines[i].trim();
    if (!t) continue;
    if (t.toUpperCase() === 'ERRORS') break; // ERRORS + its bullets end the header
    headerLines.push(t);
  }

  // --- interpret the header ------------------------------------------------
  let name = '';
  let faction = '';
  let subfaction = '';
  let detachment = '';
  let battleSize = '';
  let points = null;

  const isBattleSize = (s) => BATTLE_SIZES.some((b) => s.toLowerCase().startsWith(b.toLowerCase()));

  headerLines.forEach((line, idx) => {
    const detMatch = line.match(/^(.*?)\s*\(\d+\s*Detachment Points?\)\s*$/i);
    const pts = pointsLine(line);
    if (detMatch) {
      detachment = detMatch[1].trim();
    } else if (pts && isBattleSize(pts.name)) {
      battleSize = pts.name;
    } else if (pts && idx === 0) {
      name = pts.name;
      points = pts.points;
    } else if (!faction) {
      faction = line; // first non-points, non-detachment line = faction
    } else if (!subfaction && !detachment) {
      subfaction = line; // a line after the faction, before the detachment
    }
    // anything else (mission name, etc.) is ignored
  });

  // --- parse the body into units -------------------------------------------
  const units = [];
  let cur = null;      // current unit being built
  let lastModel = null; // the most recent model-group bullet (◦ weapons attach here)

  const flush = () => { if (cur) { finalizeUnit(cur); units.push(cur); } cur = null; lastModel = null; };

  for (let i = bodyStart; i < rawLines.length; i++) {
    const raw = rawLines[i];
    const t = raw.trim();
    if (!t) continue;
    if (/^Exported with App Version/i.test(t)) break;
    if (isSectionHeader(t)) { flush(); continue; }
    if (t.toUpperCase() === 'ERRORS') { flush(); continue; }

    const firstChar = t[0];
    const isBullet = firstChar === BULLET;
    const isSub = firstChar === SUBBULLET;

    if (!isBullet && !isSub) {
      // A new unit line "<Name> (N Points)".
      const pts = pointsLine(t);
      if (pts) { flush(); cur = newUnit(pts.name, pts.points); }
      // else: stray line inside the body — ignore.
      continue;
    }
    if (!cur) continue; // a bullet with no unit (shouldn't happen) — skip

    const body = t.slice(1).trim();

    if (isBullet) {
      lastModel = null;
      if (/^warlord$/i.test(body)) { cur.warlord = true; continue; }
      const att = body.match(/^attached as:\s*(.*)$/i);
      if (att) { cur.attachedAs = att[1].replace(/\s*\(.*\)\s*$/, '').trim(); continue; }
      const enh = body.match(/^enhancements?:\s*(.*)$/i);
      if (enh) { cur.enhancement = enh[1].trim(); continue; }
      // Otherwise a "Nx X": a model group if ◦ weapons follow, else a weapon
      // (single-model unit). We stage it as a potential model group and also
      // record it as a candidate weapon; finalizeUnit() resolves which.
      const { count, name: nm } = countLine(body);
      const entry = { count, name: nm, weapons: [] };
      cur._bullets.push(entry);
      lastModel = entry;
    } else { // isSub: a weapon under the last model group
      const { count, name: nm } = countLine(body);
      if (lastModel) lastModel.weapons.push({ count, name: nm });
    }
  }
  flush();

  return {
    meta: {
      name: name || '',
      faction,
      subfaction,
      detachment,
      battleSize,
      points,
    },
    units,
    warnings,
  };
}

function newUnit(name, points) {
  return { name, points, models: 0, warlord: false, attachedAs: '', enhancement: '', wargear: [], _bullets: [] };
}

// Resolve staged bullets into a model count + a flat, de-duplicated weapon list.
// A top-level bullet with ◦ children is a model group (count toward models, its
// children are weapons); a childless top-level bullet is itself a weapon on a
// single-model unit.
function finalizeUnit(u) {
  const weapons = new Set();
  let models = 0;
  for (const b of u._bullets) {
    if (b.weapons.length) {
      models += b.count;
      for (const w of b.weapons) weapons.add(w.name);
    } else {
      weapons.add(b.name); // single-model unit weapon
    }
  }
  u.models = models || 1;
  u.wargear = [...weapons];
  delete u._bullets;
}

// Combine a parsed GW export with a Wahapedia DB into the full army model
// (identical shape to src/parse.js parseRoster output). `db` is a
// buildWahapediaDB() instance; `opts.coreGlossary` is optional.
export function buildArmyFromGw(parsed, db, opts = {}) {
  const warnings = [...(parsed.warnings || [])];
  const factionId = db.factionIdByName.get(normalizeFaction(parsed.meta.faction)) || null;

  const units = [];
  const usedEnhancements = [];
  for (const ref of parsed.units) {
    const unit = db.unitFromRef({
      name: ref.name,
      factionId,
      models: ref.models,
      points: ref.points,
      wargear: ref.wargear,
      enhancement: ref.enhancement || null,
      detachment: parsed.meta.detachment,
    });
    if (!unit) {
      warnings.push(`No datasheet match for "${ref.name}" — listed without characteristics.`);
      units.push(stubUnit(ref));
      continue;
    }
    unit.warlord = ref.warlord;
    if (ref.attachedAs) unit.note = ref.attachedAs;
    if (unit.weaponsFallback) {
      warnings.push(`Couldn't match the listed wargear for "${ref.name}" to the data — showing all datasheet weapons.`);
    }
    if (unit.enhancement && !usedEnhancements.some((e) => e.name === unit.enhancement.name)) {
      usedEnhancements.push(unit.enhancement);
    }
    units.push(unit);
  }

  // Detachment-scoped extras. The export may combine detachments with " and ".
  const detNames = splitDetachments(parsed.meta.detachment);
  const stratagems = [];
  const rules = [];
  const seenStrat = new Set();
  const seenRule = new Set();
  for (const d of detNames) {
    const strat = db.stratagemsForDetachment(d);
    const dr = db.detachmentRules(d);
    const enh = db.enhancementsForDetachment(d);
    for (const s of strat) {
      if (!seenStrat.has(s.name)) { seenStrat.add(s.name); stratagems.push(s); }
    }
    for (const r of dr) {
      if (r.name && r.name.toUpperCase() !== 'KEYWORDS' && !seenRule.has(r.name)) {
        seenRule.add(r.name); rules.push(r);
      }
    }
    if (!strat.length && !dr.length && !enh.length) {
      warnings.push(`Detachment "${d}" wasn't found in the Wahapedia data — try refreshing it (it may be newer than your last sync).`);
    }
  }
  if (units.length && rules.length) units[0].rules = rules;

  const totalPoints = parsed.meta.points != null
    ? parsed.meta.points
    : units.reduce((s, u) => s + (u.points || 0), 0);

  return {
    meta: {
      name: parsed.meta.name || `${parsed.meta.subfaction || parsed.meta.faction} army`,
      faction: parsed.meta.subfaction || parsed.meta.faction,
      detachment: parsed.meta.detachment,
      battleSize: parsed.meta.battleSize,
      points: totalPoints,
    },
    units,
    enhancements: usedEnhancements,
    enhancementPool: [],
    stratagems,
    glossary: {},
    coreGlossary: opts.coreGlossary || {},
    warnings,
  };
}

// A placeholder unit for an unmatched datasheet — keeps it visible on the sheet.
function stubUnit(ref) {
  return {
    name: ref.name, entryType: 'unit', stats: [], ranged: [], melee: [],
    abilities: [], core: [], faction: [], rules: [], keywords: [], factions: [],
    points: ref.points, models: ref.models || 1, attach: [], note: 'No datasheet match',
    count: 1, warlord: ref.warlord,
  };
}

// GW sometimes prefixes the faction with an alignment ("Imperium - …"); keep it
// simple and let the direct name match work, with a light normalization.
function normalizeFaction(s) {
  return String(s || '').toLowerCase().replace(/[’‘]/g, "'").replace(/[^a-z0-9]+/g, ' ').trim();
}

// "A and B" → ["A", "B"]; a single detachment → [it]. Blank → [].
function splitDetachments(s) {
  if (!s) return [];
  return s.split(/\s+and\s+/i).map((x) => x.trim()).filter(Boolean);
}
