# Changelog

Versions are numbered in merge order. The current one is `_BUILD_VERSION` at the top of `js/app.js`, shown in the top bar and logged to the console as `[joiner] vN`. Each version is tagged in git (`v1`, `v2`, …).

## v5
- The census tract tab reads **Census Tract** instead of "Tract".
- Versioning: `_BUILD_VERSION` in `js/app.js`, shown in the top bar (linking here) and logged to the console; this changelog; git tags for each version.

## v4
*PR #4 · 2026-10-14*
- **White basemap** (Protomaps v5 `white`). Highway shields and one-way arrows are always hidden, and only major streets are labelled. **Basemap** toggles turn roads and the basemap's neighborhood names on and off; the choice is remembered in the browser.
- **Area labels:** each area shows its ID (districts as `D9`, ZIPs as the code, neighborhoods by name) and the mapped value, e.g. `$79K`. Under **Map labels**, click a field to add it as the next line, click again to remove it; "+ N more" shows every statistic. The first two lines always show, and each further line appears one zoom level further in; districts add the supervisor's last name as line 3. From the **Prefixes** zoom on, values are labelled (`total Budget Requested: $79K`). Zoom thresholds are whole numbers because MapLibre evaluates label text at tile zoom.
- **Natural breaks (Ckmeans)** replace quantile classes, so classes form around gaps in the values; very different amounts no longer share a color. The legend shows how many areas are in each class.
- Areas with no rows show **0** instead of "—" in the list, tooltip, popup, labels and legend. Averages stay blank, since there is nothing to average.
- New statistics: **% of all rows** and **% of total** for each numeric column. Both divide by the whole file; rows listed in two areas count in both.
- Every tab opens at the same view of the city, so switching boundary sets doesn't move the map.
- ID-like columns (`Id`, `Record ID`, `*_id`) are no longer offered as amounts.
- Layer config adds `labelTemplate` (e.g. `D{sup_dist}`) and `labelExtras` (supervisor last name, realtor district, a tract's neighborhood and district).

## v3
*PR #2 · 2026-10-14*
- **Who's on First** places for San Francisco in `data/wof/`, from the Spelunker's descendant list: 4 macrohoods; 84 current neighbourhoods and 32 with `mz:is_current` -1 (`neighbourhoods-unverified.geojson`); 46 current and 49 unverified microhoods. `places.csv` lists every record with its status, `mz:is_current`, macrohood, parent, and Spelunker and download links.
- `scripts/get_wof.mjs` walks the Spelunker, downloads records from `whosonfirst-data-admin-us`, and rebuilds the outputs (`--from-ids`, `--offline`).

## v2
*PR #3 · 2026-10-14*
- **The map:** tabs for District, ZIP, Neighborhood (SF Find, Analysis, Planning, Realtor) and Tract, built from `data/boundaries/index.json`.
- Load a CSV, Airtable `records` JSON or Joiner snapshot by dropping it on the page or with **Load data**. Files are read in the browser.
- **Match rows by** tries every column and picks the one that places the most rows, per tab; **Color by** row count, or the total or average of a numeric column.
- Panel: rows placed, unmatched values with how often each appears, and an area list that highlights with the map. Popups list the first rows in an area.
- **Save snapshot** writes rows and settings to JSON; loading it restores the view.
- Layer config: `match` rules (districts accept `5`, `D5` or `District 5` and split multi-select cells; neighborhoods ignore case and spacing) and `nameTemplate`.
- Join logic from [JoinKit](https://github.com/burritojustice/maplibre/tree/main/joinkit), pinned to a commit on jsDelivr.

## v1
*PR #1 · 2026-10-14*
- **Boundary layers** in `data/boundaries/`: supervisor districts, ZIP codes, census tracts, and four neighborhood sets (SF Find, Analysis, Planning groups, Realtor), with `index.json`. SF Find is the default neighborhood set.
- `scripts/get_layers.mjs` downloads them from DataSF (or reads exported files with `--file`), keeps the configured properties, rounds coordinates, merges multi-part ZIPs, and sets a mainland-only `bbox` so District 4 and its census tract don't zoom out to the Farallones.
