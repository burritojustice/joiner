# data/

**Backup copies.** `boundaries/`, `aliases.json` and `../region.json` are copies of [burritojustice/sf-blocks](https://github.com/burritojustice/sf-blocks), at the same paths as on its site. Don't edit them here: change sf-blocks, then refresh the copies. Where each boundary set comes from and how it's built is in sf-blocks' [data/boundaries/README.md](https://github.com/burritojustice/sf-blocks/blob/main/data/boundaries/README.md).

## How the page loads them

1. On load, Joiner asks the live site, https://burritojustice.github.io/sf-blocks/, for `region.json` and `VERSION` (waiting up to 8 seconds).
2. If it answers, the boundary manifest (`data/boundaries/index.json`), `data/aliases.json` and each boundary set as you open it are read live, by the paths in `region.json`. A file the live site can't serve is read from the copy here instead, and the rest stay live.
3. If the live site doesn't answer, everything comes from the copies here.

Hover the logo or the version to see the sf-blocks version and whether it's live. The console logs it too (`[sf-blocks] 2026.10.27.2, live from …`). The loader is `js/sfblocks.js`; Block Party has the same code inline.

**For testing:** `?sfblocks=local` uses only the copies here; `?sfblocks=<url>` reads from another copy of sf-blocks (a fork, a branch on a local server, another city's repo).

## What's here

| Here | What Joiner uses it for |
|---|---|
| `boundaries/index.json` | The tabs and Other menu: every set's label, key, name field, bbox |
| `boundaries/*.geojson` | The 16 polygon sets rows are joined to |
| `aliases.json` | Other names people use for areas ("Calle 24", "South Bayshore") |
| `sf-blocks.json` | The list of copied files, the sf-blocks version they came from, and the date copied |
| `wof/` | Not a copy: Who's On First files left from before the move. sf-blocks' `data/uploads/wof/` is now the source, and `scripts/get_wof.mjs` still writes here |

Data Joiner makes itself isn't stored here: H3 hexbins are built in the browser, uploaded polygons and loaded rows stay in the tab, and **Save** writes them to a snapshot file on your computer.

## Refreshing the copies

After an sf-blocks release:

```
python3 scripts/copy_sf_blocks.py ../sf-blocks --check   # what differs
python3 scripts/copy_sf_blocks.py ../sf-blocks           # copy, and stamp sf-blocks.json
```

Then ship it as a new Joiner version. To copy a new file, add its path to `files` in `sf-blocks.json` first.
