# joiner

Joiner joins rows from a spreadsheet, a file, an Airtable view, a Google Sheet or a DataSF dataset to areas on a map. The areas include San Francisco districts, ZIPs, neighborhoods and census tracts, H3 hexagons, Bay Area counties and ZIPs, election precincts and the districts made from them, or polygons you upload. Each area is colored by how many rows it has, or by the total, average or share of any number column. Rows with a location are drawn too. The join logic is [JoinKit](https://github.com/burritojustice/maplibre/tree/main/joinkit), shared with Selecter.

Live at **https://burritojustice.github.io/joiner/**. Hover the Joiner logo to see the version; [CHANGELOG.md](CHANGELOG.md) says what changed in each. Nothing is uploaded: files are read in your browser.

## Loading data

Drop a file anywhere on the page, or click **Load data**. The dialog has **Open a file…** and a box for a link.

- **A CSV** with a column that names areas (district, ZIP, neighborhood).
- **GeoJSON**, or a CSV with WKT or latitude/longitude columns. These rows are drawn on the map and can be placed by location.
- **Airtable.** Under **Airtable**, paste a view link and a [personal access token](https://airtable.com/create/tokens) with `data.records:read` and `schema.bases:read`.
  - **Show other tables** lists every table the token can open. With a saved token, the folded heading says how far it reaches ("token: 3 bases, 12 tables").
  - Linked records are brought in as "Link: Field" columns.
  - Contact fields (email, phone, mailing address, attachments, users) are left out unless you add them back.
  - You can also load the API's `records` JSON as a file.
- **A link** to an online CSV, JSON or GeoJSON file, a DataSF or other Socrata dataset, or a Google Sheet.
  - Google Sheets must be shared with "Anyone with the link".
  - A Socrata dataset link loads every row, not just the first 1,000.
  - Other sites work only if they let other web pages read their files (CORS). If one doesn't, download the file and load that instead.
- **A Joiner snapshot** saved with **Save**: the rows and every setting, in one file you can reopen later.

**Sharing.** After loading a link or an Airtable view, the page address carries it (`?url=…` or `?airtable=…`), so the page can be shared. The Airtable token is never put in the address: it stays in your browser tab until the tab closes, and whoever opens a shared page uses their own token. Snapshots contain every column you loaded, so remove names, emails and phone numbers before sharing one.

**Big files.** Files with tens or hundreds of thousands of rows show their progress as they read, place, count and color. A 26 MB CSV of 367,000 rows loads in about 3 seconds. Above 2,000 located rows, a file starts drawn as pinpoints; above 50,000, its points start hidden (the areas still count them).

## Matching rows to areas

**Match rows by** picks the column, or **Location** (the area that contains each row's point; lines count by their midpoint). Joiner tries every column and picks the one that places the most rows; the menu shows each column's count.

- If nothing matches on the current tab and a column's name says what it holds (ZIP, district, neighborhood), Joiner switches to that set. For neighborhoods, it asks which set the names come from.
- Names are matched forgivingly:
  - Case, spaces and punctuation don't matter: "Downtown / Civic Center" matches "Downtown/Civic Center".
  - Either side of a slashed name matches it: "Treasure Island" matches "Treasure Island/YBI".
  - Names of 8 or more letters can be a letter or two off: "Outer Susnet" matches "Outer Sunset".
- A cell can list several areas, separated by commas, semicolons, pipes or line breaks. The row then counts in each of them. Clicking or hovering such a row marks all its areas, and its card names any part that isn't an area ("Not on the map: Citywide").
- The panel shows how many rows were placed and lists the values that matched no area.
- How each set matches values is set by `match` in `config/layers.json`. For example, districts accept `5`, `D5` or `District 5`.

## Area sets

The tabs along the top are **District**, **ZIP**, **Neighborhood** (SF Find, Analysis, Planning, Realtor or Who's on First), **H3 hexbins** and **Other**. Other holds:

- Census Tracts
- Bay Area Counties and Bay Area ZIP Codes
- Election Precincts 2022, plus the US House, State Senate, Assembly and BART Board districts made from them
- **Upload polygons (GeoJSON)…**, to add your own areas for the session

Bay Area sets zoom out to show all of themselves.

**H3 hexbins** work anywhere, not just in SF.
- **Auto** picks the level whose hexagons are about 32 pixels across at the current zoom and latitude.
- The small table shows the level in use and the one on either side, each with the zooms where Auto picks it, its side length and its area.
- **−½ / +½** moves the levels half a zoom later or sooner, and **− / +** moves one level. **Fixed** keeps a level at every zoom.
- Hexagons get friendly names like "Mission #82c7": the area that covers most of the hexagon, plus a short code. They're named by neighborhood, or by county once they're bigger than a neighborhood. You can also name them by any other set, or show the full H3 index.
- Clicking a hexagon pans to it without zooming, so the grid stays the same.

## Colors, labels and the legend

- **Color by:** Count, % of total count, or the total, average or % of total of any number column.
- **Area colors:** Blues, Yellow–red or Blue–yellow–red. Each palette is paired with a contrasting color for the points.
- **Classes:**
  - **Natural breaks** groups similar values and splits at the biggest gaps.
  - **Equal width** gives each class the same range of values.
  - **Quantiles** gives each class about the same number of areas.
  - **Log** works on the logarithm of the values, which helps when a few areas are much bigger than the rest.
- **Area labels:** pick the lines (name, count, other fields). Label size starts at **Small**. **Dynamic** sizes labels by area, which can make big areas look like big values.
- **Area outlines:** Auto, Area color, Ghost, Grey, White, Black or None, in Hair, Thin, Mid or Thick widths.
- **Legend:** **▾ Legend** folds it into one bar per layer: min and max at the ends, the median as a line and the mean as a diamond.

**Basemap.** Streets draw above the areas from zoom 13 (or put the areas under the basemap). Highway shields and one-way arrows are hidden. The creek fix from Block Party and Selecter hides streams and "Creek" and "Arroyo" waterways, which Protomaps tags as rivers even where they're culverted.

## Features from the file

When the file has locations, **Format features** controls how its rows are drawn:

- **Color by** any column: numbers on a ramp opposite the areas' colors, text by its most common values.
- **Size points by** a number, with a log option.
- **Size:** Pinpoint, Tiny, Small, Medium, Big or Huge. Lines follow the same control. **Smaller where crowded** shrinks points as more of them come into view.
- **Style:**
  - Fill, Ring, Ghost, Black outline, White outline or Black & white.
  - Click Ring or Ghost again for a white version, which shows up on dark area colors.
- **Labels:** pick columns to show beside each point, from zoom 13.

## The table

**Table** (next to Areas) shows every row, below or beside the map; the two icons switch between them.

- Sort by any column, and pin any column at the left.
- **All**, **Area** (the selected area's rows) or **In view**.
- **Search** keeps rows that contain every word you type.
- **+ Filter** adds a filter:
  - Category columns: tick the values to keep. Each part of a list cell counts.
  - Number columns: **>**, **<** or **from – to**.
  - With two or more filters, **All / Any** says whether rows must match every filter or just one.
- **Map only these** makes the map count and draw just the rows that match the search and filters.
- Clicking a row pins its card, opens its area in the list, and marks all its areas on the map. Hovering the area list highlights the matching rows in the table.

## Boundary layers

The polygon sets come from [sf-blocks](https://github.com/burritojustice/sf-blocks), the main copy of San Francisco's map data: one GeoJSON file per layer in `data/boundaries/`, plus `index.json`, which the map reads to build its tabs. The page reads sf-blocks' `region.json` for the paths and loads each file live from https://burritojustice.github.io/sf-blocks/; if that site can't be reached, it uses the copies in this repo at the same paths. `data/sf-blocks.json` lists the copies and the sf-blocks version they came from (hover the version number to see which the page is using). `?sfblocks=local` forces the copies. Refresh them with `python3 scripts/copy_sf_blocks.py ../sf-blocks`.

Other names for areas ("Calle 24" for the Calle 24 Latino Cultural District, "South Bayshore" for Bayview) are in sf-blocks' `data/aliases.json`, by layer id, shared with Block Party. Add aliases there, not in `config/layers.json`.

The map never calls DataSF while it runs. `scripts/get_layers.mjs` still builds the files from `config/layers.json` until it moves to sf-blocks; copy its output there.

| Layer | Tab | Join key | Features | Source |
| --- | --- | --- | --- | --- |
| `supervisor_districts` | District | `sup_dist` (`1`–`11`) | 11 | DataSF [cqbw-m5m3](https://data.sf.gov/-/Map-of-Current-Supervisor-Districts/tadv-nifg) |
| `zip_codes` | ZIP | `zip_code` | 27 | DataSF [srq6-hmpi](https://data.sf.gov/-/San-Francisco-ZIP-Codes/srq6-hmpi) |
| `sf_find_neighborhoods` | Neighborhood (default) | `name` | 117 | DataSF [pty2-tcw4](https://data.sf.gov/-/SF-Find-Neighborhoods/pty2-tcw4) |
| `analysis_neighborhoods` | Neighborhood | `nhood` | 41 | DataSF [p5b7-5n3h](https://data.sf.gov/-/Analysis-Neighborhoods/p5b7-5n3h) |
| `planning_neighborhoods` | Neighborhood | `neighborho` | 37 | DataSF [Planning Neighborhood Groups](https://data.sf.gov/-/Planning-Neighborhood-Groups-Map/iacs-ws63) |
| `realtor_neighborhoods` | Neighborhood | `nbrhood` | 92 | DataSF [5gzd-g9ns](https://data.sf.gov/-/Realtor-Neighborhoods/5gzd-g9ns) |
| `wof_neighbourhoods` | Neighborhood | `name` | 116 | `data/wof/` (84 current + 32 unverified) |
| `census_tracts` | Other | `geoid` | 242 | DataSF [sevw-6tgi](https://data.sf.gov/Geographic-Locations-and-Boundaries/Analysis-Neighborhoods-2020-census-tracts-assigned/sevw-6tgi) |
| `bay_area_counties` | Other | `county` | 9 | California county boundaries, the nine Bay Area counties (to be replaced by DataSF [wamw-vt4s](https://data.sf.gov/Geographic-Locations-and-Boundaries/Bay-Area-County-Polygons/wamw-vt4s)) |
| `bay_area_zip_codes` | Other | `zip` | 323 | DataSF [4kz9-76pb](https://data.sf.gov/dataset/Bay-Area-ZIP-Codes/4kz9-76pb) |
| `election_precincts` | Other | `prec_2022` | 514 | DataSF [d6x4-hefw](https://data.sf.gov/Geographic-Locations-and-Boundaries/Election-Precincts-Current-Defined-2022/d6x4-hefw) |
| `us_house_districts` | Other | `cong22` | 4 | precincts dissolved by district |
| `state_senate_districts` | Other | `sen22` | 3 | precincts dissolved by district |
| `assembly_districts` | Other | `assemb22` | 4 | precincts dissolved by district |
| `bart_districts` | Other | `bart22` | 3 | precincts dissolved by district |

Each layer's settings are in `config/layers.json`:

- `tab` decides where the layer appears. Layers that share a tab become one menu, and `"Other"` puts a layer in the Other menu.
- `"default": true` picks the set a tab opens with.
- `regional` marks a layer beyond SF.
- `dissolve: { from, by }` builds a layer by merging another layer's polygons that share a value. That's how precincts become districts, with clean outlines.

A few precincts sit alone in their own district: one on the Bay Bridge and one near Angel Island.

### Refreshing them

```sh
node scripts/get_layers.mjs                    # download all layers (Node 18+, no npm install)
node scripts/get_layers.mjs zip_codes          # just one
node scripts/get_layers.mjs --check            # validate what's in data/boundaries
```

If a download fails, export the GeoJSON from the DataSF page and pass the file instead:

```sh
node scripts/get_layers.mjs --file zip_codes=~/Downloads/SF_ZIP_Codes.geojson
```

The script cleans each layer the same way:

- keeps only the properties listed under `keep`, and sets each feature's `id` to its join key;
- rounds coordinates to 6 decimals (about 10 cm), which roughly halves file size;
- merges features that share a key into one MultiPolygon where `mergeByKey` is set (ZIPs 94121, 94133 and 94158 come in several pieces);
- sorts features by key, one feature per line, so reruns produce readable diffs;
- sets the collection's `bbox` to the mainland only, so fitting the map to a layer doesn't zoom out to the Farallones (part of District 4 and tract 06075980401). The full extent is kept as `extent`.

To add a layer, add an entry to `config/layers.json` with its DataSF dataset id (the id of the dataset, not of a map view built on it), join `key`, display `name` and the properties to `keep`, then run the script for it. Dissolved layers are built from their source's file, so run the source first.

## Who's on First places

`data/wof/` holds the San Francisco macrohoods, neighbourhoods and microhoods from [Who's on First](https://whosonfirst.org/), gathered from the Spelunker's [descendant list for San Francisco](https://spelunker.whosonfirst.org/id/85922583/descendants/). Unlike the DataSF sets, WOF records a hierarchy (a microhood inside a neighbourhood inside a macrohood), which is what we need for broad names like "Sunset" or "Richmond".

| File | What |
| --- | --- |
| `places.csv` | every record: id, name, placetype, status, macrohood, parent, geometry source, Spelunker and download URLs |
| `macrohoods.geojson` | 4 macrohoods: Downtown, Mission District, Richmond District, Sunset District |
| `neighbourhoods.geojson` | 84 current neighbourhoods (`mz:is_current` 1) |
| `neighbourhoods-unverified.geojson` | 32 neighbourhoods with `mz:is_current` -1 |
| `microhoods.geojson` | 46 current microhoods |
| `microhoods-unverified.geojson` | 49 microhoods with `mz:is_current` -1 |
| `raw/` | the original WOF records, one file per id |
| `ids.txt`, `missing.txt` | ids from the Spelunker; ids not found in `whosonfirst-data-admin-us` |

**Current vs. unverified.** WOF marks 84 SF neighbourhoods current (`mz:is_current` 1). Another 32 have `mz:is_current` -1: never reviewed, but not deprecated, superseded or ceased. These files are named `-unverified` rather than "not current" because in WOF "not current" is `mz:is_current` 0, the retired records. They include Excelsior, Inner and Outer Sunset, Inner and Outer Richmond, Chinatown, Bayview and Ingleside. The two sets don't overlap, and together they cover all of SF; the 84 alone cover 62% of its land. So for a full neighbourhood map, load both files. Records with `mz:is_current` 0 (deprecated, superseded or ceased) aren't in any layer but are listed in `places.csv`. None of these records set `mz:is_deprecated`; deprecation is in `edtf:deprecated` and `wof:superseded_by`.

```sh
node scripts/get_wof.mjs              # walk the Spelunker, download new records, rebuild outputs
node scripts/get_wof.mjs --from-ids   # skip the Spelunker; use data/wof/ids.txt
node scripts/get_wof.mjs --offline    # rebuild outputs from data/wof/raw only
```

Records come from GitHub (`whosonfirst-data/whosonfirst-data-admin-us`); `places.csv` also lists each record's `data.whosonfirst.org` URL.

## Releasing

Each merged change is a new version:

1. Bump `_BUILD_VERSION` at the top of `js/app.js` (`v37` → `v38`).
2. Add a `## v38` section at the top of `CHANGELOG.md` saying what changed, in terms someone using the map would notice.
3. Merge the PR. The **Tag version** action (`.github/workflows/tag-version.yml`) reads `_BUILD_VERSION` and tags the merge commit `v38`.

To tag an older commit, run the action by hand: **Actions → Tag version → Run workflow**, with the tag (`v1`) and the commit SHA.

JoinKit is pinned to one commit in `index.html`, and the same commit is kept in `js/vendor/joinkit.js` for when the CDN fails. Update both together. [CLAUDE.md](CLAUDE.md) has the steps, and notes on how changes are built and tested.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
