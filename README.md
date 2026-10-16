# joiner

A map for Civic Joy Fund data. It joins rows from Airtable tables (and CSVs) to San Francisco boundaries — supervisor districts, ZIP codes, neighborhoods, census tracts — and to street segments by CNN. Polygons are colored by count, with sums and averages of numeric fields. The join logic is [JoinKit](https://github.com/burritojustice/maplibre/tree/main/joinkit), shared with Selecter.

*Work in progress.* The version is shown in the top bar; see [CHANGELOG.md](CHANGELOG.md) for what changed in each.

## Using the map

Open `index.html` (on GitHub Pages, or any local web server — `python3 -m http.server` from this folder). Pick a boundary set from the tabs, then drop a file anywhere on the page or use **Load data**:

- a **CSV** exported from Airtable or a spreadsheet;
- **Airtable JSON** — the `records` response from the Airtable API (one page or an array of pages);
- **GeoJSON**, or a CSV with WKT or latitude/longitude columns — each row is drawn on the map, and the **Location** checkbox under **Match rows by** places rows in the area that contains them;
- a **Joiner snapshot** saved from this page;
- an **Airtable view**: under **Airtable**, paste the view's link and a [personal access token](https://airtable.com/create/tokens) with `data.records:read` and `schema.bases:read` for the base.

**Airtable.** The token is kept in the browser tab until it closes and sent only to Airtable; it's never put in the page address. After loading, the address ends in `?airtable=<view link>`, so the map can be shared: whoever opens it is asked for their own token. Joiner doesn't request contact fields (email, phone, street address, attachments, Airtable users), so they never reach the browser or a snapshot; the panel lists them, and any can be loaded on purpose. Choosing a view filters and sorts the rows, but doesn't hide fields: Airtable's API returns a view's hidden fields too, which is why Joiner chooses the fields itself.

Joiner guesses which column to match on for each tab by trying every column and counting how many rows land on an area; the **Match rows by** menu shows the counts and lets you pick another. Each tab remembers its own choice. **Color by** switches between the number of rows and the total or average of any numeric column. The panel shows how many rows were placed and lists the values that matched no area, with how often each appears — those are what the crosswalk will fix.

**Save** downloads a snapshot: the rows plus the current settings as one JSON file; loading it later restores the same view without Airtable. Snapshots contain every column of the file you loaded, so remove personal fields (names, emails, phone numbers) before loading a file you plan to share.

Nothing is uploaded: files are read in the browser. Join logic is [JoinKit](https://github.com/burritojustice/maplibre/tree/main/joinkit), loaded from jsDelivr pinned to a commit.

**Map labels.** Each area is labelled with its ID (districts as `D9`) and the value being mapped. Pick other lines under **Map labels**: click a field to add it as the next line, click again to remove it. The first two lines always show; each further line appears one zoom level further in (the supervisor's last name on districts is the third line by default), and from the **Prefixes** zoom on, each value is labelled (`total Budget Requested: $79K`). **Basemap** switches roads and the basemap's neighborhood names on and off; highway shields and one-way arrows are always hidden, and only major streets are named.

**Colors.** Pick **Blues** or **Yellow–red** under **Map → Colors**; rows drawn from the file switch to a contrasting color (orange on blues, blue on yellow–red), solid when placed in an area and hollow or dashed when not. Areas are colored in up to five classes found by natural breaks (Ckmeans), which groups similar values and splits at the largest gaps, so a $104K area and a $40K area don't share a color the way rank-based quantiles can force. Areas with no rows count as 0 (shown in gray); an average of no rows is blank. **% of all rows** and **% of total …** divide by the whole file, including rows that matched no area.

**Format features.** When the file has geometry, the **Format features** panel colors the rows by any column (numbers on the palette opposite the areas', text by its most common values) and labels them with columns from zoom 13. Click an area in the list to see its rows and each one's value.

**Hexbins.** The Hexbins tab maps rows into [H3](https://h3geo.org/) hexagons. **Auto** picks a finer grid as you zoom in; or fix a resolution from 5 (big) to 10 (about 76 m a side).

**Rows and areas.** Hover an area in the list to highlight its rows on the map. **Size points by** a number (with a log option) and pick a point size from Tiny to Huge. Lines show as dots at their midpoints until zoom 12. **Show → Areas** hides the polygons to see just the rows; **✕** beside the file name removes the file. Placing rows by location uses JoinKit's indexed point-in-polygon, which handles a million points in about a quarter of a second.

**Table.** **Table** (next to Areas) shows every row below the map: sort by any column, and show all rows, the selected area's or those in view. Hovering a row highlights it on the map and the reverse; clicking a row goes to it.

**Basemap rules** (apply to every map): major streets draw above the areas from zoom 13 and every street from 14, named from zoom 14 (or put the areas under the basemap with **Show → Under roads**, the default for hexagons), highway shields and one-way arrows are hidden, and the creek fix from Block Party and Selecter hides streams and "Creek"/"Arroyo" waterways, which Protomaps tags as rivers even where they're culverted.

Every tab opens at the same view of the city, so switching boundary sets doesn't move the map.

How each layer matches values is set by `match` in `config/layers.json`: districts accept `5`, `D5` or `District 5` and split multi-select cells like `1,3`; neighborhood names ignore case and extra spaces.

## Boundary layers

The polygon sets live in `data/boundaries/`, one GeoJSON file per layer, plus `index.json`, which the map reads to build its tabs. They are downloaded from DataSF by a script and committed, so the map never calls DataSF at runtime.

| Layer | Tab | Join key | Features | DataSF |
| --- | --- | --- | --- | --- |
| `supervisor_districts` | District | `sup_dist` (`1`–`11`) | 11 | [cqbw-m5m3](https://data.sf.gov/-/Map-of-Current-Supervisor-Districts/tadv-nifg) |
| `zip_codes` | ZIP | `zip_code` | 27 | [srq6-hmpi](https://data.sf.gov/-/San-Francisco-ZIP-Codes/srq6-hmpi) |
| `sf_find_neighborhoods` | Neighborhood | `name` | 117 | [pty2-tcw4](https://data.sf.gov/-/SF-Find-Neighborhoods/pty2-tcw4) |
| `analysis_neighborhoods` | Neighborhood | `nhood` | 41 | [p5b7-5n3h](https://data.sf.gov/-/Analysis-Neighborhoods/p5b7-5n3h) |
| `planning_neighborhoods` | Neighborhood | `neighborho` | 37 | [mw29-m2za](https://data.sf.gov/-/Planning-Neighborhood-Groups-Map/iacs-ws63) |
| `realtor_neighborhoods` | Neighborhood | `nbrhood` | 92 | [5gzd-g9ns](https://data.sf.gov/-/Realtor-Neighborhoods/5gzd-g9ns) |
| `wof_neighbourhoods` | Neighborhood | `name` | 116 | from `data/wof/` (84 current + 32 unverified) |
| `census_tracts` | Census Tract | `geoid` | 242 | [sevw-6tgi](https://data.sf.gov/Geographic-Locations-and-Boundaries/Analysis-Neighborhoods-2020-census-tracts-assigned/sevw-6tgi) |

The Neighborhood tab offers the neighborhood sets in the order above — SF Find first and as the default, since its names match the most Airtable values, then Analysis, Planning, Realtor, and the Who's on First neighbourhoods. The order in `config/layers.json` sets the order in the tab, and `"default": true` picks the one it opens with. Census tracts carry their analysis neighborhood and 2022 supervisor district, which is useful later for comparing how the sets overlap.

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

To add a layer, add an entry to `config/layers.json` with its DataSF dataset id (the id of the dataset, not of a map view built on it), join `key`, display `name` and the properties to `keep`, then run the script for it.

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

Each change that's merged is a new version:

1. Bump `_BUILD_VERSION` at the top of `js/app.js` (`v5` → `v6`).
2. Add a `## v6` section at the top of `CHANGELOG.md` saying what changed, in terms someone using the map would notice.
3. Merge the PR. The **Tag version** action (`.github/workflows/tag-version.yml`) reads `_BUILD_VERSION` and tags the merge commit `v6`.

To tag an older commit, run the action by hand: **Actions → Tag version → Run workflow**, with the tag (`v1`) and the commit SHA.

## License

AGPL-3.0 — see [LICENSE](LICENSE).
