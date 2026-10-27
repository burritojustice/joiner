# Changelog

Versions are numbered in merge order. The current one is `_BUILD_VERSION` at the top of `js/app.js`, shown in the top bar and logged to the console as `[joiner] vN`. Each version is tagged in git (`v1`, `v2`, …); from v5 on, the **Tag version** GitHub Action does this when the version changes on main.

## v43
Joiner moves to burritojustice and reads its boundaries from sf-blocks.

- **Boundaries from sf-blocks, live:** the tabs' manifest and every boundary file load from https://burritojustice.github.io/sf-blocks/, using the paths in its `region.json`. If the site can't be reached (or a file is missing there), Joiner uses the copies in this repo, which are sf-blocks 2026.10.27 (`data/sf-blocks.json`). Hovering the logo or the version shows which. `?sfblocks=local` forces the copies.
- **One list of aliases:** other names for areas come from sf-blocks' `data/aliases.json`, shared with Block Party, instead of `config/layers.json`. Cultural Districts match the same names as before, and Planning neighborhoods now also take "South Bayshore", "Upper Market" and "Treasure Island".
- **Unbranded:** the burritojustice avatar in place of the Civic Joy Fund logo, and the burritojustice.github.io Protomaps key. Another site's key can be listed in sf-blocks' `region.json`.
- `scripts/copy_sf_blocks.py` refreshes the copies from a checkout of sf-blocks.

## v42
- **Cultural Districts in Other:** San Francisco's 10 Cultural Districts (DataSF, exported 2026-10-25), with each district's designation date on hover. Rows match by district name, and short names work too: "Japantown", "Calle 24", "SoMa Pilipinas", "Castro", "Leather".
- **A `reference/` folder for public contact lists,** starting with `reference/cultural-districts/contacts.csv`: one row per district, ready to fill in with the lead organization, website, public email and phone, and where each came from. Its README says how to add and check contacts. These are plain files, so other groups can use them without Airtable.
- Dates from DataSF read as dates (2018-12-11), not timestamps.

## v41
- **Lines outside every area are hollow:** the line's color as an outline with a white core, as points outside are, in place of the dashes (which looked choppy on short street segments, over a solid casing). Placed lines keep their casing; outside ones have none.
- **Lines that are partly inside an area count there.** A line goes to the area holding the most of its length (checked at 11 points along it), so a segment that pokes into an area counts even when its middle is outside, and one split between two areas counts once, in the area with more of it (a tie goes to where its middle is). Before, only the midpoint decided. Points are placed as before. The Match rows by hint says so.

## v40
- **Upload polygons works in Safari.** Safari only opens a file picker from a click, not from choosing a menu item, so Other › Upload polygons (GeoJSON)… now opens a small dialog with a **Choose a GeoJSON file…** button (in every browser).

## v39
- **Fixed: Other › Upload polygons (GeoJSON)… didn't open the file picker.** The menu option's value started with a NUL character, which browsers replace when reading HTML, so choosing it tried to open a set that doesn't exist (and hovering the map then failed too). It now opens the picker. Choosing anything that isn't a set is ignored, and the map's hover tooltip no longer fails when the set is missing.

## v38
- **Filter chips show the value first:** “**Mission, Bayview** · NEIGHBORHOOD OF INTEREST”. The column name is faded and is what gets cut when space is short; hover a chip for the whole filter (“NEIGHBORHOOD OF INTEREST is Mission or Bayview”).
- **The filter editor's column menu stays inside the editor,** however long the column names; long names are shortened in the menu, with the full name on hover.
- **Text with commas isn't split into values** in a filter's list: a column is treated as a list only when its parts also appear on their own in other cells (or it's the column rows are matched by), so “Yes, a merchants group” stays one value.

## v37
- **One header row for the table** (below the map): the count, search, filter chips, + Filter, Clear and Map only these sit with All / Area / In view, the dock buttons and ✕. Filter chips stay on that row and scroll sideways when there are many. On narrow screens the right-hand group drops to a second line; beside the map, search and filters get their own lines as before.
- **Dock buttons are icons,** as in a browser's developer tools: a window with a bar along the bottom, or along the right.
- Shorter labels: **Area** (was Selected area), **Map only these**; the count reads “44 of 317 rows”.

## v36
- **The filter editor opens upward, over the map** (with the table beside the map, it opens just below the tools row), so it no longer pushes the rows down.
- **Map these rows only:** with a search or filter set, this button makes the map count and draw only the matching rows: area counts, totals, averages and shares (of the matching rows' totals), the list, the legend and the features. It follows the search and filters as they change; the summary says “Map: the N rows matching the table's search and filters”. Turn it off (or clear the filters) for every row again. The table's All / Selected area / In view choice doesn't affect the map.

## v35
- **Search the table:** a box above the rows keeps those with every word somewhere in a shown column or the area name.
- **Filters:** + Filter adds one; its chip opens an editor.
  - **Category columns** (and the area column): tick the values to keep, with how many rows have each and a box to find one. Each part of a list cell counts (“Mission, Bernal Heights” matches Mission).
  - **Number columns** (90% of cells are numbers; years count, ZIPs and other codes don't): **>**, **<** or **from – to**; leave a side empty for an open range.
  - With two or more filters, **All / Any** says whether rows must match every filter or one of them. **Clear** removes the search and the filters; loading another file does too.
- Filters and search work with All / Selected area / In view, and with sorting. They narrow the table only; the map still counts every row.

## v34
- **Load data opens a dialog:** Open a file…, or paste a link (Google Sheet, DataSF, CSV/JSON URL). The From a link card is gone; a failed link reopens the dialog with the reason. The help card's “choose a file” still opens the file picker, and its new link line opens the dialog.
- **Census Tracts are in Other.**
- **Hexagon names follow the zoom:** Named by Auto (the default) uses Analysis Neighborhoods, and Bay Area Counties once hexagons are bigger than a neighborhood (level 7, 1.4 km sides, and up): “San Francisco County #830821”. The menu says which it's using.
- **Menu tabs show the set's full name** (“Planning Neighborhoods”, no “…”).
- **Hover the Joiner logo for the version.**
- **Folded, the Airtable heading shows the saved token's reach:** “token: 3 bases, 12 tables” (a + while bases are still being read).
- **The help card lists sources in a new order:** a CSV naming areas, GeoJSON or a located CSV, Airtable, a link, a snapshot.

## v33
- **From a link:** a new card loads a Google Sheet, a DataSF (or any Socrata) dataset, or any CSV, JSON or GeoJSON URL, then joins it like a file.
  - **Google Sheets:** an edit or share link (the tab in `gid` is kept) or a “Publish to web” link. The sheet must be shared with “Anyone with the link”; if it isn't, Joiner says so. It reads the CSV export, falling back to the gviz CSV.
  - **Socrata:** a `/resource/<id>.json` (or `.csv`, `.geojson`) link or a dataset page (`…/<id>`, `…/<id>/about_data`) loads every row, 50,000 at a time (Socrata sends only 1,000 unless asked), named from the dataset's title. A resource link's own `$where`, `$select`, `$limit` are kept. Socrata's `:@computed_region_…` columns are dropped. Point columns like `the_geom` are found as locations.
  - **Other links** load when the site allows other pages to read them (CORS); when it doesn't, Joiner suggests downloading the file instead.
  - Progress in the toast (pages, rows, size). The link goes in the address as `?url=…`, so the page can be shared and reopens with the data; loading a file or clearing removes it.
- **After loading, a column that names areas is used** when nothing was placed in the current set: a “Neighborhood” column asks which neighborhood set, a ZIP or district column switches to that set (as choosing it under Match rows by already did). For files and links.

## v32
- **Joiner loads even when jsDelivr refuses JoinKit.** jsDelivr answered 403 for the newly pinned JoinKit commit (it can do that for a commit it hasn't fetched yet), so the page had no JoinKit and the map didn't load. Joiner now keeps a copy of the same commit in `js/vendor/joinkit.js` and loads it when the CDN fails. When the pin changes, update both (`git show <sha>:joinkit/joinkit.js > js/vendor/joinkit.js` in burritojustice/maplibre).
- `scripts/get_layers.mjs` dissolves precincts with JoinKit's `dissolve` from that copy; `js/dissolve.js` is gone.

## v31
- **New Protomaps API key** (6c8d7dd20c838f80), limited to https://civic-joy-fund.github.io. Local copies on localhost still work: Protomaps lets a valid key through from localhost.

## v30
- **JoinKit 0.3.0** (burritojustice/maplibre#16), pinned at 4851893. Joiner's recent additions now live in JoinKit, shared with Selecter, with tests: the chunked join with progress (`buildJoinChunked`) and chunked point-in-polygon (`assignPointsToPolygonsChunked`); classes (`classBreaks`: natural breaks, equal width, quantiles, log; the fast `ckmeans`; `summaryStats`); forgiving names (`makeLooseNormalizer`) and list columns (`detectDelimiter`); hexbin helpers (`JoinKit.hex`: auto resolution, switch zooms, short codes, cover, which take h3-js as an argument); and `dissolve`. Joiner calls them instead of its own copies; behavior is the same.
- **Shares of a column's total count every row in big files** too (as for smaller files): the chunked join had summed only the placed rows.

## v29
- **Hovering a row lights all of its areas,** in the table, in an area's list and on the map, as clicking does (a planning row naming five neighborhoods lights five).
- **Counting has progress too.** Big files (20,000+ rows) are counted in chunks with a bar (“Counting rows in ZIP Code 200,000 of 366,984”), then “Coloring …” until the map has drawn. The chunked count is one pass that places each row, adds its numbers to its areas' totals and tallies unmatched values; with 366,984 rows it takes about 0.4 s instead of ~3 s, so a 26 MB file loads in about 2.7 s. Smaller files count as before.
- **Counts are kept** until the file, the set, the column or the hexagons change, so changing the statistic, the classes, log or colors doesn't count again. Classes and log just re-class the areas (a couple of milliseconds), so they don't need progress.
- **Area outlines** (as in Selecter), in Format areas & map: Auto (as before), Area color, Ghost, Grey, White, Black or None, and Hair, Thin, Mid or Thick. Saved in snapshots.

## v28
- **Big files show progress as they load.** CSVs are read in 2 MB chunks with a bar (“Reading … 46% of 26 MB · 170,078 rows”), files of 20,000+ rows find their locations in chunks (“Finding locations”), and rows are placed in areas in chunks (“Placing rows in Supervisor District 140,000 of 366,984”), then “Counting and coloring” until the map has drawn. With 366,984 rows, reading takes about 1 s and placing about 0.4 s; the count itself (JoinKit's join) is most of the remaining ~3 s.
- **Switching areas with a big file** shows the same steps: loading the areas, placing rows (with a bar), counting and coloring.
- **Faster column checks on big files:** matching columns, number columns and money columns are judged from a sample (20,000 rows for match counts, shown as “about N of M rows match”; 5,000 for types).
- **Classes for the area colors:** Natural breaks, Equal width or Quantiles, under Classes in the top section, plus **Log** (natural breaks and equal width on the logarithm of the values, for long tails). The legend's footnote names the method. Saved in snapshots.
- **Area labels start Small;** the size-by-area option is now called **Dynamic** (bigger areas got bigger labels, which read as bigger values).
- **Bigger fold triangles** on every folding heading.

## v27
- **Cells that list several areas count in each.** A column where at least 5% of cells hold commas, semicolons, pipes or line breaks is split, and each part is matched (“Chinatown, Financial District, Nob Hill”). Clicking such a row in the table (or in an area's list) marks all its areas on the map and zooms to them when the row has no location; its card says “In 5 areas: …” and names any part that isn't an area (“Not on the map: Citywide”). The table's area column lists them all.
- **Forgiving area names:** case, spaces and punctuation don't count (“Downtown / Civic Center”, “Downtown Civic Center”, “Sea Cliff”), each side of a slashed name matches it (“Treasure Island” → “Treasure Island/YBI”), and names of 8+ letters match one or two letters off (“Downton/Civic Center”, “Outer Susnet”). With SF Planning's notification list on Planning Neighborhood Groups, 303 of 317 rows place; Citywide (14) and South Bayshore (1) are left.
- **An Other menu** at the end of the tabs: Bay Area Counties, Bay Area ZIP Codes, Election Precincts 2022, and US House, State Senate, Assembly and BART Board districts made from the precincts. Bay Area sets zoom out to show all of themselves; going back to an SF set returns to the city.
- **Upload polygons:** Other › Upload polygons (GeoJSON)… adds your own areas for this session, named by a property with a different value for each polygon (a name-like one first), under “Your files”.
- **Districts from precincts:** `dissolve: { from, by }` in `config/layers.json` builds a layer by merging the source's polygons that share a value (shared edges cancel, so the districts have clean outlines). `js/dissolve.js` does it, in `get_layers.mjs` now and in the browser later if we want it for uploads.
- **Every folding heading has the same triangle:** cards, sub-sections, the file title and the legend.
- Data: precincts from DataSF d6x4-hefw; Bay Area ZIPs from DataSF 4kz9-76pb (CSV export, simplified to ~10 m); Bay Area counties from the California county boundaries file (CDTFA), the nine Bay Area counties, simplified to ~20 m — swap in DataSF wamw-vt4s with `get_layers.mjs` when convenient.

## v26
- **The legend folds to one bar per layer.** Click ▾ Legend to fold it (it remembers). Each layer (the areas' statistic, and the features when they're colored by a number) is one bar with an equal block per class, the min and max at its ends, the median as a line and the mean as a diamond where they fall in their class, labelled underneath (merged when they're close or the same). The heading line gives how many areas or hexagons have values and how many are empty; hover a bar for all four numbers. Features colored by categories show their colors as a short key. Click ▸ Legend to unfold.

## v25
- **Hexagons count faster with big files.** With 12,000 rows, switching levels spent 2–3 seconds in Joiner's own code; it's now 0.1–0.3 s. Natural breaks run on runs of equal values (and at most 1,500 groups of neighbors) instead of every hexagon, number formats and name sorting reuse one formatter, empty hexagons get no label, the features aren't resent when only the hexagons changed, and the list shows the first 500 hexagons (and says so). What's left is MapLibre drawing thousands of hexagons.
- **A toast while counting:** files with 3,000 or more rows say “Counting 12,000 rows into hexagons” (with the resolution) until the map has drawn them.
- **The H3 card folds** like the others, with Auto / Fixed in its heading; folded, it shows the level and side length.
- **Hovering the area list highlights the table:** a row in an open area is highlighted in the table and scrolled to; an area tints its rows.
- **A tighter top bar:** smaller tabs, toggles and file name (the version hides below 1440 px wide), so “H3 hexbins” fits, with room for another tab down to about 1280 px wide.

## v24
- **White ring and white ghost:** click Ring or Ghost again to switch it to white, bright on dark bin colors; click again to go back. The chip turns dark to show it. Black ring and White ring are now called Black outline and White outline.
- **H3 hexbins work anywhere,** not just San Francisco: every row with a location gets its hexagon, wherever it is. Auto now picks the resolution whose hexagons are closest to 32 pixels across at the map's zoom and latitude (the same steps as before in SF), and the range is 0–12, so a national or world view gets big hexagons.
- **A small table of levels** in the H3 card: the level in use and the one either side, each with the map zooms where Auto picks it, its side length and its area, in fixed columns so nothing jumps while zooming. Under it, the live map zoom.
- **−½ / +½ on the zoom side:** each level arrives half a zoom later or sooner (up to 2 zooms either way), for testing whether the steps are off by half. − / + still step the level. **Auto / Fixed** replaces the row of level buttons; Fixed holds the level in use.
- **Hexagon names:** Friendly (“Mission #82c7”) or the full H3 index, and **Named by** any area set, or nothing (code only). Empty hexagons fill out the naming set where the data overlaps it and there aren't too many; hexagons outside it are named by the area at their center, or by code alone.
- **“Hexbins” is now “H3 hexbins”.**
- **“Number of rows” is now “Count”** (“count: 3” on the map), and “% of all rows” is “% of total count”.

## v23
- **Point styles from Selecter:** Fill (as before), Ring, Ghost, Black ring, White ring and Black & white, under Format features › Style. Lines follow along: ghosted, a black or white casing, or black on white.
- **Pinpoint size**, below Tiny: small dots with no outline (rings keep a hairline), for a light hint of where rows are. Size and Style are now rows of pictures, with the choice named next to the heading.
- **Smaller where crowded** (on to start): points shrink as more rows are in view, from full size with under 80 to about a third with 15,000 or more, on top of growing with the zoom. Pinpoints stay as they are.
- **Big files start as pinpoints:** with 2,000 or more located rows a file gets its own look (pinpoints, your style), noted in the card; changing size or style changes that file's look only. With 50,000 or more its features start hidden. The next file starts from the usual settings.
- **Hexagon resolution has − and + buttons:** in Auto they shift the zoom-to-resolution steps bigger or smaller (up to 3 steps) and the hint says so; at a fixed level they step the level. In Auto the level in use is outlined.
- **The resolution control sits on its own row** under its heading, and Auto keeps one label, so the card no longer changes height when switching between Auto and a level.

## v22
- **Airtable's table list is ready sooner.** As soon as there's a token (remembered, or pasted), Joiner reads the bases and their tables in the background, several bases at once, and keeps the list for the tab. Show other tables opens at once from that list, fills in any base still loading, and says when it was read, with **Refresh**. It's re-read quietly when it's over 5 minutes old, when you click Refresh, and when a table can't be found; changing or forgetting the token clears it.
- **Hexbins have their own feature size, Tiny to start.** The size control (now **Size**) edits whichever is showing, hexagons or other areas, and each keeps its setting.
- **Lines follow the size control** too, on a gentler scale (Tiny 0.6× to Huge 2.1×), including the highlighted line.
- **Lines are placed and counted by their midpoint**, and Match rows by now says so when the rows include lines.
- **Clicking a hexagon doesn't zoom** (on the map, in the list, or a table row): it pans, so the grid under the cursor stays the same. Zooming with Auto on moves the open hexagon to the new grid: its busiest smaller hexagon zooming in, the bigger one around it zooming out.
- **Hexagons have friendlier names:** the neighborhood covering most of it and a short code, “Mission #82c7”, instead of the full H3 index. The code drops the digits every hexagon in the city shares and the unused f's at the end. The list sorts A–Z by neighborhood. Hexagons off the neighborhoods (piers) are “Shoreline”.

## v21
- **Streets over hexagons get the light touch too:** with the areas under the basemap (hexagons, or Under roads), its streets lose their casings and draw at half width, a little transparent, like the street copies over named areas. Hiding the areas or drawing them over restores the basemap's streets.
- **Match rows by names the area set:** “Location (inside the ZIP Code)”, “(inside the Planning Neighborhood Group)”, “(inside the hexagon)”.
- **Cards and popups are slightly see-through**, with a light blur behind.
- **With the table open, row cards sit in a corner clear of it:** bottom left when the table is beside the map, bottom right when it's below, for hovering rows in the list and for clicking table rows alike.
- **Legend ranges are abbreviated** like the map labels: $24.5K – $28.5K instead of $24,538 – $28,500.

## v20
- **Click a row to keep its card open.** In an open area in the list, or in the table, clicking a row pins its card at the map's edge with every field, so you can move onto it, scroll it and select text. ✕, Esc, clicking the row again or clicking empty map closes it. Hovering rows still previews them. The row is marked in the list. Rows with a location also zoom to it (no popup), with features shown or not.
- **Clicking an area opens it in the list and zooms to it** (on the map, in the list, or a table row's area), closing any other open area. Areas no longer get a popup listing their rows; the list shows them.
- **Clicking a feature** still shows its fields in a popup, and now also opens its area in the list with the feature's row marked.

## v19
- **Blue–yellow–red pairs with green features:** rows are green, and colored by a number they use ColorBrewer Greens. The selected area is purple with this palette (green with the others), so it doesn't blend with the features.
- **Area colors and Area labels sit under Color by**, so the map's look can be set where the data is chosen. Area colors is the same picker as below; Area labels lists the label lines and jumps down to the label picker.
- **Names:** “Colors” is now **Area colors**, the Map card is **Format areas & map**, and its Labels are **Area labels**. The Airtable card's heading matches the other cards.
- **Pointing at the area list folds the other cards** (after a moment), so the list gets the room. Click a card's heading to open it again.
- **Place columns aren't stats:** ZIP, district, supervisor, tract, GEOID, CNN, parcel columns stay out of Color by even with extra words, like “zip (matched)”.

## v18
- **Linked Airtable tables load together.** A linked-record field brings in the linked table's fields as “Link: Field” (contact fields still left out), and shows the linked records' names instead of IDs. So the 2026 geo table gets each application's budget, and the applications table gets its blocks' locations: when the linked records carry WKT, their shapes are combined (blocks and an intersection in one application become one feature). The Airtable panel lists the links, each can be turned off, and it notes when a linked record sits on several rows (its numbers count once per row).
- **One pinned column in the table**, the row's name column to start. The pin in any header pins that column at the left instead.
- **Label color chips keep their size:** each pair has a fixed name (Black · white, Navy · yellow, Navy · lt blue, White · red), the sample shows which side is text, and ⇄ marks the chosen pair. Smaller type.
- **Street names have their own colors** (Basemap › Street names), with the same pairs; navy on light blue to start.
- **Show other tables is a button** next to Load from Airtable, both smaller so they share a row, and it says “Loading…” (animated) while it reads the bases and tables.
- **The loaded file or table's name is the title of the match card**, above Match rows by. Click it to collapse the card to one line (rows, placed, color) so the area list moves up; it remembers.
- **Address ranges aren't stats:** address_low/high (and similar), part/parts and year are left out of Color by, including in linked fields.

## v17
- **Loading from Airtable shows what's happening** in a toast over the map: connecting, which table and how many fields (and contact fields left out), records read so far page by page with the time, looking for locations, placing rows, and a summary when it's done. Errors show there too.
- **Show other tables** (Airtable panel, next to the remembered token) lists the bases this token can open and, when you open a base, its tables. Click a table to load it.
- **Matching by a column picks the area set from its name.** Choosing a ZIP column switches to ZIP Codes, a district column to Supervisor Districts, a tract or GEOID column to Census Tracts, and a toast says so, with Undo. A neighborhood column asks which neighborhood set (unless one is showing, or the name says, like "analysis neighborhood").
- **The table goes below or beside the map** (Bottom / Side in its header); drag its inner edge to resize. Below the map it opens about three rows tall. The area and name columns stay put while scrolling sideways, and every column sorts, the area column included.
- **Blue–yellow–red** replaces Blue–red: ColorBrewer's RdYlBu, blue for low and red for high. Maps saved with Blue–red open in it.
- **Street names on the basemap are navy with a pale yellow glow**, readable on every palette and on the bare basemap.
- **Label colors come in pairs:** Black / white, Navy / yellow, Navy / light blue, White / deep red. Click a pair to use it; click it again (⇄) to swap text and glow, which adds Yellow on navy, Light blue on navy and Deep red on white.

## v16
- **Blue–red palette** (Area colors): a diverging ramp, blue for the lowest values and red for the highest, with a warm gray middle so it doesn't read as "no value". Rows colored by a number use a purple ramp with it.
- **The selected area is green**, on the map (a green outline on a white casing) and in the list, so it stands out against Blues, Yellow–red and Blue–red alike.
- **Getting a token is spelled out** in the Airtable panel: a link to airtable.com/create/tokens, the three steps, and a gentle note to treat a token like a password.
- **The Value / A–Z switch keeps its shape** when the list title wraps to two or more lines.

## v15
- **Table:** a **Table** button next to Areas opens every row in a drawer below the map. Drag its top edge to resize it.
  - Click a column to sort; the row's name column comes first, after the area it's in.
  - Show **All** rows, the rows in the **Selected area**, or those **In view**.
  - Hovering a row highlights it on the map (and its area); hovering a feature on the map highlights its row; clicking a row goes to it.
  - It remembers whether it was open and how tall.
- **Labels in Medium weight with a 2.5px glow** (Black, and dark text in Auto).
- **Line casings follow the line's color**, like the rings on points: white under dark lines, dark under light ones.
- **Places** (Basemap) replaces Neighborhood labels and covers all the basemap's place names: city, neighborhoods, islands. It turns off while areas are shown and back on when they're hidden.
- **Hexagon borders are light gray.**

## v14
- **Hover a row in an expanded area to see its fields** in a card beside the list, whether or not the row has a location (rows matched by a column have none).
- **The Airtable panel is below the area list.**
- **Streets over the areas are a hint of the network:** no casings, half the basemap's width, slightly transparent. Areas left clear look as before.
- **Label size Auto** (the new default): bigger for bigger areas. The set's typical area sets the base (districts about 13.5px, ZIPs 12.5, analysis neighborhoods 12, SF Find 11, tracts 10.5, fine hexagons 10). Each area's own size nudges its label, and labels grow a little as you zoom in. Small, Medium and Large still fix the size.
- **Label lines:** *By zoom* (as before) or *All at once*, for when several short values (percentages) should show together. Lines appear one zoom level sooner: the third at the opening zoom, the fourth one level in.
- **Hexbins never show the cell ID**, only the values.
- **Console:** `Joiner.labelStyle({ width, blur, halo, text, size, font, spacing, rows })` tries label styles; `Joiner.labelStyle('reset')` goes back to the panel's settings.

## v13
- **Load straight from Airtable.** Under **Airtable**, paste a link to a view (or a table) and a personal access token. Joiner reads the table's fields, then loads the view's rows, 100 at a time.
- **Shareable map links:** after loading, the page address carries `?airtable=<view link>` (never the token). Opening it asks for the token, or opens right away if this tab already has it. **Copy map link** copies it.
- **The token stays in this tab** until it closes (sessionStorage) and is sent only to api.airtable.com. **Forget it** clears it.
- **Contact details aren't loaded:** email, phone and attachment fields, Airtable users, and fields named like email, phone or street address are never requested, so they stay out of the map and saved snapshots. Name, the primary field, is kept. Linked-record fields are skipped until links can be resolved to names. The panel lists what was skipped; tick a field and **Reload** to load it.
- **Switch tables and views** the token can read from the menus in the Airtable panel.
- Currency fields keep their dollars (totals and averages are money), lookups come through as lists, and latitude/longitude fields place rows on the map.

## v12
- **Numbers formatted as in Selecter.** Map labels abbreviate from 1,000 (1K, 1M, 1B, 1T), with one decimal until the abbreviated number reaches 100: `$79.4K`, `$104K`, `1.2M`. Unabbreviated values get two decimals below 1, one below 100, none above.
- **No cents on dollar amounts** anywhere: totals and averages, legends, row popups and row labels (Airtable's `$5,000.00` shows as `$5,000`), and the size and color legends for currency columns.
- **Label colors:** Auto · Black · White · **Navy on yellow** (for Blues) · **Navy on light blue** and **White on deep red** (for Yellow–red). Each choice shows a sample. Magenta and Aqua are gone.
- **Hide N areas without data**, under the match summary (as in Selecter): areas no row was placed in are left off the map, the labels and the list. Remembered and saved in snapshots.

## v11
- **Fixed: areas with rows left uncolored after switching neighborhood sets.** Clearing the old set's map state raced with the new set's colors and wiped some of them; toggling Location redrew them. Up to 20 of the 41 analysis neighborhoods were affected in testing; now none are.
- **Areas with no value are clear** instead of filled, so the basemap shows through. The legend shows them as an empty box.
- **Areas and Features buttons next to the tabs** hide and show the polygons and the file's rows. Clicking any tab brings hidden areas back.
- **Hovering an area in the list only outlines it**; its rows no longer light up. Hovering a row in an expanded area (a school, a block party) still enlarges that row on the map.
- **Lines are more prominent:** a dark casing under a wider colored core by default (what hovering looked like in v10). Hovered lines grow bigger still, in yellow.
- **Label color:** Map → Color: **Auto** (black or white per area, as in v10) · **Black** (white glow) · **White** (dark glow) · **Magenta** (aqua glow) · **Aqua** (magenta glow). Applies to area and row labels; remembered and saved in snapshots.
- **Labels collapse:** the label field lists in Map and Format features have a ▸/▾ and show what's chosen when closed. Format features labels start closed.
- **Who's on First macrohoods** are out of the Neighborhood menu for now (the data is still in `data/wof/`).
- The top bar fits on one line: the tabs scroll if they run out of room, and **Save snapshot** is now **Save**.
- The **Tag version** action can be run by hand (Actions → Tag version → Run workflow) to tag an older commit.

## v10
- **Areas over or under the basemap:** Map → Show → **Auto · Over · Under roads**. Under draws the area colors beneath the basemap's water, roads and buildings, with the outlines still on top. Auto puts hexagons under (their grid ignores the coastline and streets) and named areas over, as before. Saved in snapshots.
- **Streets over the areas sooner:** major roads and highways from zoom 13, every street from 14 (was 14). Street names from zoom 14 (was 15).
- **Hovered rows are bigger and yellow** with a dark ring (lines get a dark casing) instead of a thin purple ring.
- **Area labels flip to white** on dark fills (with a light, soft halo), and stay dark with a white halo on light fills, whichever has more contrast.
- **No more statistics on IDs:** `cnn`, `address`, `source_row`, row numbers, ZIPs, parcels and census ids are no longer offered as amounts or sizes. Also skipped: any column of numbers that count 1, 2, 3…, or fixed-length codes of 5+ digits that are mostly unique.
- Hexagon outlines are lighter, since there can be thousands of them.
- JoinKit pinned to the commit that merged burritojustice/maplibre#15.

## v9
- **Hexbins tab: H3 hexagons** as a boundary set, covering SF's land plus any cell a row falls in. **Auto** picks the resolution from the zoom (8 at the opening view, 10 from zoom 14), or pick one from 5 to 10. Rows are placed by location (or by a column of H3 cell ids); labels show only on hexagons with rows, and the list shows those hexagons.
- **Match rows by → Location** is now its own checkbox, with how many rows fall inside an area, so it's available right away and the column menu stays set for when you turn it off.
- **Hovering an area in the list highlights its rows on the map**; hovering a row in an expanded area highlights just that row. Hovering a row on the map rings it too.
- **Size points by** any numeric column (circle area follows the value), with a **Log scale** option so small values stay visible. Bigger circles draw under smaller ones. The legend notes the range.
- **Point size:** Tiny · Small (the size so far) · Medium · Big · Huge.
- **Thicker lines** from the file, growing with zoom (2.5 px at 12 to 10 px at 18), with rounded ends. Area outlines also thicken from zoom 14, where streets draw over the areas.
- **Lines show as a dot at their midpoint below zoom 12**, sized and colored like points; the lines draw from 12. A row's location for placing it in an area is now the midpoint along a line's length rather than its middle vertex.
- **Show → Areas** turns the joining polygons and their labels off, to see just the rows. **✕** next to the file name removes the loaded file.
- **District 4's label** sits in the Sunset again: area labels and popups now anchor in the largest part (by area, not bounding box) inside the layer's mainland bounds, so the Farallones' ocean outline no longer pulls them out to sea.
- **Faster placement by location:** JoinKit 0.2.0 indexes polygon edges in latitude strips; placing a million points takes about a quarter of a second on any of the boundary sets (up to ~40× faster).
- Point size, size by and hexagon resolution are saved in snapshots.

## v8
- **Streets above the areas from zoom 14**, named from zoom 15: copies of the basemap's street lines draw over the colored areas (below outlines, rows and labels), so blocks read when zoomed in. The **Roads** toggle covers them.
- **Creek fix** from Block Party and Selecter: streams are hidden, and rivers and waterway labels named "Creek" or "Arroyo" are filtered out, since Protomaps/OSM tag many culverted Bay Area creeks as rivers.
- **White glow** on area outlines and on lines drawn from the file.
- **Format features** panel (when the file has geometry): show or hide the rows; **Color by** any column, using the area palette's opposite for numbers (yellow–red on Blues, blues on Yellow–red; natural breaks, 5 classes) or the categorical palette for text (most common values, the rest as Other; hues that would blend into the area palette are skipped); **Labels** from any columns, beside each row from zoom 13. Light colors get a dark ring and glow instead of white. The legend adds a **Rows** section.
- **Label size** in the Map panel: Small (the size so far) · Medium · Large, for area and row labels.
- **Clicking an area in the list expands it** to list its rows, each with its value for the statistic being mapped (sorted by it), instead of opening a popup. Click a row with a location to fly to it. Click the area again to collapse.
- **Row popups show values first**, with the field name under each value; long names are cut short with the full name on hover. Up to 30 fields, scrolling.
- The **Map** panel moved below the area list; panel cards remember whether they're open. The side panel scrolls when they're all open.
- Format features and label size are saved in snapshots.

## v7
- **Shorter tabs:** a tab with several boundary sets shows just the chosen set's name with a ▾ ("Analysis Neighborhoods ▾", "WOF Neighbourhoods ▾") and opens the menu when clicked. Opening the menu on another tab switches to it. Layers can set a `short` name for this.
- **Colors** switch in the Map panel: **Blues** (as before) or **Yellow–red** (ColorBrewer YlOrRd, starting at light orange so the lightest class still stands apart from the gray used for 0). The choice is remembered in the browser and saved in snapshots.
- **Row geometry stands out from the areas:** orange on Blues, blue on Yellow–red. Rows placed in an area are solid; rows not placed are hollow rings (points) or dashed (lines and polygons), so the difference doesn't depend on color. A key next to the Data toggle shows both.
- The **Map labels** panel is now **Map**, since it also holds basemap, colors and data options.

## v6
- **Rows with a location are drawn on the map** and can be placed by location. Joiner finds geometry in GeoJSON files, in CSV columns holding WKT (`POINT (-122.4 37.7)`, lines, polygons) or Socrata-style `(37.7, -122.4)` text, and in latitude/longitude column pairs. Points are dark when placed in an area and pink when not; polygons and lines from the file are outlined. Hover a point for its name and area; click for its fields. **Data → Show the N rows with a location** turns them off.
- **Match rows by → Location (inside the area)** places each row in the area that contains it (a line's middle, or a point well inside a polygon). It's offered whenever the file has geometry and chosen when it places at least as many rows as any column. Rows outside every area, and rows with no location, are counted in the panel.
- **Supervisor districts:** the supervisor's last name is in the area list ("District 8 Mandelman"), and the full name is in the hover tooltip and popup. On the map it's still the line that appears one zoom level in.
- **Who's on First** neighbourhoods (116: 84 current plus 32 unverified) and macrohoods (4) are in the Neighborhood menu, after Realtor. Their hover shows WOF status and macrohood.
- The legend moved to the top left of the map.
- Latitude/longitude columns and code columns (e.g. `cds_code`) are no longer offered as amounts. Popups for rows use a name-like column (`school`, `name`, `title`…) or the first mostly-unique text column.
- `get_layers.mjs` builds layers from repo files with `localFiles`; `labelExtras` gain `hover`, `list` and `values`.

## v5
- The census tract tab reads **Census Tract** instead of "Tract".
- Versioning: `_BUILD_VERSION` in `js/app.js`, shown in the top bar (linking here) and logged to the console; this changelog; a **Tag version** GitHub Action that tags each new version on main.

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
