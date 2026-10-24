# CLAUDE.md

Notes for Claude working on Joiner. What the project is, how changes ship, and the rules that came out of building it with John.

## What Joiner is

A MapLibre map for Civic Joy Fund. It joins rows from CSV, JSON or GeoJSON files, Airtable views, Google Sheets, DataSF/Socrata datasets and other CSV links to polygon sets: SF districts, ZIPs, neighborhood sets, census tracts, H3 hexbins, Bay Area counties and ZIPs, election precincts and the districts made from them, and polygons the user uploads. Areas are colored by count, total, average or share, and rows with locations are drawn as features.

- Live at https://civic-joy-fund.github.io/joiner/ (GitHub Pages, served from `main`).
- Plain HTML, CSS and JS. No build step, no modules, no npm dependencies in the page.
- Libraries come from CDNs, pinned to exact versions in `index.html`: MapLibre GL 5.16, PapaParse, h3-js 4.4.0 and JoinKit.
- Basemap: the Protomaps `white` style. The key `6c8d7dd20c838f80` only works from `https://civic-joy-fund.github.io`, but localhost works with any valid key. Selecter uses a different key (`071e272e8d5e13b7`, for burritojustice.github.io).

## Files

| Path | What's in it |
| --- | --- |
| `index.html` | All the markup: top bar, sidebar cards, map, table drawer, toast, Load data dialog |
| `js/app.js` | The app. `CONFIG` at the top, then state `S` (map) and `T` (table) |
| `js/sources.js` | Reading files and links into `{ name, kind, headers, rows, geoms, geomFrom }`. Also finds geometry, reads CSVs in chunks, and handles Google Sheets, Socrata and snapshots |
| `js/airtable.js` | Airtable REST: loading tables and their linked records, the cached list of bases and tables (`catalog`), and the token (kept in sessionStorage) |
| `js/vendor/joinkit.js` | Fallback copy of the pinned JoinKit commit, used when jsDelivr fails |
| `css/joiner.css` | Styles. Later versions append sections marked `/* vNN: … */`; a later rule can override an earlier one |
| `config/layers.json` | The polygon sets: join key, name, label templates, `match` rules, `tab`, `regional`, `dissolve` |
| `data/boundaries/` | Cleaned GeoJSON for each layer, plus `index.json` (the manifest the page reads). Committed; never fetched from DataSF at runtime |
| `scripts/get_layers.mjs` | Builds `data/boundaries/` from DataSF, from local files (`--file id=path`), or by dissolving another layer |
| `CHANGELOG.md` | One section per version, newest first |

### Key functions in `js/app.js`

- `boot()`: loads the manifest, builds the tabs (Other is always last), starts the map, and reads the `?airtable=` and `?url=` links.
- `setLayer(id)`: switches the polygon set. For big files it shows progress toasts and calls `prepare()` first.
- `useSource(src)`: shows a loaded source. `loadFile`, `loadLink` and `loadAirtable` all end here, and then `autoMatch()` runs.
- `recompute()` chooses the key column (`pickKey`) and gets the join:
  - The join is cached in `joined`, keyed by `joinKey()`. Changing the statistic, classes or colors doesn't count again.
  - Files under 20,000 rows use JoinKit's `buildJoin` (`joinNow`). Bigger files use `buildJoinChunked` (`joinInChunks`) through `prepare()` / `refresh()`, with a progress bar.
- `classify()` turns values into classes: `JoinKit.classBreaks` (natural breaks, equal width or quantiles, with optional log). `recolor()` re-classes without recounting.
- `normalizerFor(meta)` builds the forgiving name matcher (`JoinKit.makeLooseNormalizer`). `delimFor(col)` detects columns that list several areas in one cell. `areasOfRow(i)` gives every area a row is in.
- `loadHex()` builds the H3 grid. Auto resolution, switch zooms and short codes come from `JoinKit.hex`. Names come from `hexNameSet()`: neighborhoods, or counties from level 7 down.
- Table: `tableRowIdx()` → `searchAndFilter()` → `renderTable()`. **Map only these** sets `S.mapMask`, and `maskJoin()` narrows the join to those rows.

## How a change ships

Each version is one PR on its own branch:

1. Branch from an up-to-date `main`, named `vNN-short-name`. If the previous PR isn't merged yet, branch from its branch and say so in the PR ("Builds on #NN, merge that first").
2. Bump `_BUILD_VERSION` at the top of `js/app.js`.
3. Add a `## vNN` section at the top of `CHANGELOG.md`: what changed, in plain words, for John rather than for a developer.
4. Commit, ending the message with the attribution lines from the session's system reminder.
5. Push with `git push -u origin <branch>`, then open the PR. `gh pr create` doesn't work here because GraphQL is blocked, so use the REST API: `gh api repos/civic-joy-fund/joiner/pulls -f title=… -f head=… -f base=main -f body=…`. The body is the changelog section, how it was tested, and the attribution footer.
6. John merges. A GitHub Action tags each version on `main`.

If the stop hook says a branch is "unpushed" right after a push, it's because the local fetch refspec doesn't track that branch. Fix it with `git config --add remote.origin.fetch '+refs/heads/*:refs/remotes/origin/*'`, then `git fetch`.

## JoinKit

The join logic lives in [burritojustice/maplibre](https://github.com/burritojustice/maplibre/tree/main/joinkit) as `joinkit/joinkit.js`, and Selecter uses it too.

- It's pure functions with no dependencies. The `JoinKit.hex.*` helpers take the h3-js module as their first argument.
- Tests: `node --test test/*.test.js` in `joinkit/`. The hexbin test needs `h3-js` on `NODE_PATH`; there's a copy under the scratchpad `cdn/` folder.
- Joiner pins one commit in `index.html`, keeps the same commit in `js/vendor/joinkit.js`, and loads the vendor copy if the CDN fails.
- To update:
  1. Merge the JoinKit PR.
  2. Change the sha in `index.html`.
  3. Refresh the vendor copy: `git -C ../maplibre show <sha>:joinkit/joinkit.js > js/vendor/joinkit.js`.
- New JoinKit functions are additions; existing ones keep Selecter parity (`test/parity.test.js`).

## Boundary layers

- Add a layer to `config/layers.json`, then run `node scripts/get_layers.mjs <id>`. Add `--file <id>=<path>` when the source is a local export.
- `tab` decides where the layer shows. Layers that share a tab name become a menu; `"tab": "Other"` puts it in the Other menu, which always ends with **Upload polygons (GeoJSON)…**.
- `regional: true`: the map zooms out to the whole layer, and the layer's bbox doesn't count toward the SF home view.
- `dissolve: { from, by }` builds districts from precincts (US House, State Senate, Assembly, BART). It uses JoinKit's `dissolve` from the vendor copy. The source layer must come earlier in the config.
- Sources:
  - The Bay Area counties came from a California county boundaries file (the nine counties, simplified to about 20 m), not DataSF `wamw-vt4s`.
  - The Bay Area ZIPs came from the DataSF CSV export (simplified to about 10 m).
  - The precincts came from DataSF `d6x4-hefw`.

## Rules John has set

- **Creek fix on every map:** hide Protomaps `water_stream`, and filter "Creek" and "Arroyo" names out of `water_river` and waterway labels.
- **Tokens never go in the URL.** The Airtable token stays in sessionStorage for the tab. `?airtable=` carries the view link only.
- **No contact fields:** don't request email, phone, mailing address, attachments or users from Airtable unless the user adds them back.
- **No PII in commits, PRs, outputs or geo tables.** For test files from John that have names, emails or phones (like the SF Planning notification list), make a reduced copy in the scratchpad and never commit it.
- Keep `name` as a primary identifier in Airtable tables.
- Push the branch **and** open the PR.
- UI words:
  - "Count" (not "Number of rows"), "H3 hexbins", "Map only these".
  - Say what happened in plain language.
  - Toasts for anything slow, with a progress bar when there's a count to show.

## Testing

Tests are headless Playwright scripts run from the scratchpad, not committed. The pattern:

- Serve the repo on `http://localhost:8766` with a small Node server.
- Route CDN library URLs to local copies: MapLibre, PapaParse and h3-js under the scratchpad `cdn/` folder, and JoinKit from `../maplibre/joinkit/joinkit.js`.
- Serve the Protomaps style from a saved `white-style.json`, with tiles returning 204.
- Mock outside services with `page.route`: Airtable (`api.airtable.com`, including the CORS preflight), Google Sheets (`docs.google.com`) and DataSF (`data.sf.gov`).
- Read state through `window.Joiner` (`state`, `table`, `map`, `version`), and take screenshots of the panels you changed.
- Launch Chromium with `--use-gl=swiftshader`. Timings that include drawing are slow there, so time JS work inside the page (`performance.now()`), or profile it with CDP `Profiler`.
- Useful generated files:
  - a 367k-row lat/lon CSV, for big-file progress;
  - a 12k-row California points CSV, for hexbins and filters;
  - a 1,500-point US CSV, for scope beyond SF;
  - `schools-test2.geojson`, a small points file.

The session's network goes through an allowlist. Domains John adds take effect in a new session. The list has included `data.sf.gov`, `api.protomaps.com`, `protomaps.github.io`, `cdn.jsdelivr.net`, `unpkg.com`, Google Fonts, census and California GIS sites, and `docs.google.com` with `googleusercontent.com`. If a site is still refused, mock it or ask John to export the file into a folder linked to the session.

## Related projects

- **Selecter:** `burritojustice/maplibre/selecter`, the GeoJSON viewer whose point and outline styles Joiner borrowed.
- **Block Party:** `civic-joy-fund/block-party`, the CNN street-segment lookup. Its data feeds the Airtable "Block Party 2026 geo" and "2025 geo" tables (base `appzHWTq3Hzmr12vY`).
- Planned: joining by lists of CNNs (street segments), the same way cells listing several neighborhoods work now.
