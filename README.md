# joiner

A map for Civic Joy Fund data. It joins rows from Airtable tables (and CSVs) to San Francisco boundaries — supervisor districts, ZIP codes, neighborhoods, census tracts — and to street segments by CNN. Polygons are colored by count, with sums and averages of numeric fields. The join logic is [JoinKit](https://github.com/burritojustice/maplibre/tree/main/joinkit), shared with Selecter.

*Work in progress.*

## Using the map

Open `index.html` (on GitHub Pages, or any local web server — `python3 -m http.server` from this folder). Pick a boundary set from the tabs, then drop a file anywhere on the page or use **Load data**:

- a **CSV** exported from Airtable or a spreadsheet;
- **Airtable JSON** — the `records` response from the Airtable API (one page or an array of pages);
- a **Joiner snapshot** saved from this page.

Joiner guesses which column to match on for each tab by trying every column and counting how many rows land on an area; the **Match rows by** menu shows the counts and lets you pick another. Each tab remembers its own choice. **Color by** switches between the number of rows and the total or average of any numeric column. The panel shows how many rows were placed and lists the values that matched no area, with how often each appears — those are what the crosswalk will fix.

**Save snapshot** downloads the rows plus the current settings as one JSON file; loading it later restores the same view without Airtable. Snapshots contain every column of the file you loaded, so remove personal fields (names, emails, phone numbers) before loading a file you plan to share.

Nothing is uploaded: files are read in the browser. Join logic is [JoinKit](https://github.com/burritojustice/maplibre/tree/main/joinkit), loaded from jsDelivr pinned to a commit.

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
| `census_tracts` | Tract | `geoid` | 242 | [sevw-6tgi](https://data.sf.gov/Geographic-Locations-and-Boundaries/Analysis-Neighborhoods-2020-census-tracts-assigned/sevw-6tgi) |

The Neighborhood tab offers the neighborhood sets in the order above — SF Find first and as the default, since its names match the most Airtable values, then Analysis, Planning and Realtor. The order in `config/layers.json` sets the order in the tab, and `"default": true` picks the one it opens with. Census tracts carry their analysis neighborhood and 2022 supervisor district, which is useful later for comparing how the sets overlap.

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

## License

AGPL-3.0 — see [LICENSE](LICENSE).
