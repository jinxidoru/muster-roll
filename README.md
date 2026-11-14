# 40k Roster PDF

Turn a Warhammer 40,000 army list into a clean, printable quick-reference PDF —
stats, weapons, abilities, enhancements, army rules, and stratagems for your whole
list on a page or two.

Two import formats are supported:

- **[New Recruit](https://newrecruit.eu) / BattleScribe JSON** — self-contained
  (exact loadouts, points, and rules text are in the export), works for any faction
  with nothing else to download.
- **Official Games Workshop app export** (plain text) — lists only names, so the
  characteristics, weapons, abilities, and detachment stratagems are filled in by
  cross-referencing **[Wahapedia](https://wahapedia.ru)** datasheet data pulled onto
  your device.

**▶ Live app: https://jinxidoru.github.io/40k-roster-pdf/** — everything runs in your
browser; nothing is uploaded.

![example sheet](docs/example.png)

## How to use

The landing page is an **army manager**. Add a list by dropping a file, choosing one,
or pasting the export text — the format is detected from the contents:

- **New Recruit:** build your list, then **Export → BattleScribe / JSON**.
- **GW app:** open a list → **Share** → copy/export the text.

Saved lists live on your device (names, format, points, date added; rename/delete any
time). Click one to open its print preview, then print or download the PDF. The sheet
header is colored to match the faction.

### Datasheet data (GW app lists)

A GW app export has no characteristics, so those lists need the Wahapedia data set.
Load or refresh it from the **Datasheet data** panel on the manager. The data stays on
your device and is re-cross-referenced every time a list is opened, so a refresh keeps
every saved list current. New Recruit lists don't need it.

> **Note:** a browser can't fetch Wahapedia directly (no CORS headers), so on the live
> site this requires a small pass-through you configure once in that panel. In local
> development the data is read from `data/wahapedia/` instead (see below).

## Rendering styles

Sheets are produced by named *renderers*, each with its own layout and options:

- **Standard** — the whole army as dense reference tables on US Letter or A4, with
  optional sections for army & detachment rules, enhancements, stratagems (name + CP
  with bulleted WHEN/TARGET/EFFECT steps), and a keyword glossary, plus a page-breaks
  option that splits units / rules / glossary onto separate pages.
- **Cards** — one printable card per unit (Magic/Poker or Tarot size). The preview
  shows individual cards with a checkbox each; the PDF imposes the selected cards onto
  the page (US Letter / A4) in a butt-cut grid with margin cut ticks. Titles use the
  [Anton](https://fonts.google.com/specimen/Anton) font (SIL Open Font License).

More styles can be added without touching the rest.

## Command line

The Standard/Cards renderers also run from a CLI (needs [Typst](https://typst.app) —
`brew install typst`):

```sh
node scripts/build.js path/to/roster.json            # -> build/<name>.pdf (opens it)
node scripts/build.js roster.json --renderer standard --typ-only --no-open
```

## Development

```sh
python3 -m http.server 8000      # serve the repo root, open http://localhost:8000/
node scripts/fetch-wahapedia.js  # download the Wahapedia CSVs into data/wahapedia/
```

On a dev host (localhost / private LAN) the app reads the Wahapedia CSVs from the local
`data/wahapedia/` directory the fetch script creates, so you can iterate offline. That
directory is **gitignored** — the data is Games Workshop IP mirrored by Wahapedia and is
never committed or re-hosted here.

## Notes & limitations

- **Edition:** cross-reference data tracks the current edition (Wahapedia `wh40k11ed`).
- GW app exports can combine detachments (e.g. "A and B"); stratagems, enhancements, and
  detachment rules are pulled for each. A detachment newer than your last data sync is
  flagged — refresh the data to pick it up.
- The optional **keyword glossary** defines core weapon/ability keywords (Lethal Hits,
  Sustained Hits, …). For New Recruit lists these come from the export plus a bundled
  [BSData](https://github.com/BSData/wh40k-11e) extract (`src/keywords.json`, regenerate
  with `node scripts/build-keywords.js`); delete that file to drop all bundled rules
  text.
- Saved lists store the **original export only** — never the cross-referenced datasheets
  — and the storage layer is a small async document store, so it can be moved to a hosted
  backend later without touching callers. Wahapedia data is kept in a separate on-device
  store that is deliberately not part of that layer.
- Not affiliated with Games Workshop, New Recruit, or Wahapedia. Game data is © Games
  Workshop.

## License

MIT (tool code).
