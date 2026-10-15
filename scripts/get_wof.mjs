#!/usr/bin/env node
// Gather Who's on First places inside San Francisco (macrohoods, neighbourhoods,
// microhoods) and write them where Joiner can use them.
//
//   node scripts/get_wof.mjs                 walk the Spelunker descendant pages, then download
//   node scripts/get_wof.mjs --ids-only      just walk the Spelunker and update data/wof/ids.txt
//   node scripts/get_wof.mjs --from-ids      skip the Spelunker; download the ids in data/wof/ids.txt
//   node scripts/get_wof.mjs --offline       rebuild outputs from data/wof/raw/ without any network
//
// Steps
//   1. Spelunker: https://spelunker.whosonfirst.org/id/<sf>/descendants?placetype=<pt>&page=<n>
//      is paged 10 at a time; every /id/<n> link is collected until a page adds nothing new.
//   2. Each record is downloaded from GitHub (whosonfirst-data-admin-us) into data/wof/raw/.
//      The page links include ancestors and other noise, so a record is kept only if its
//      placetype is one we asked for and San Francisco is in its hierarchy.
//   3. Outputs:
//      data/wof/places.csv            every record: status, macrohood, parent, URLs
//      data/wof/macrohoods.geojson      macrohood polygons
//      data/wof/neighbourhoods.geojson  neighbourhood polygons
//      data/wof/microhoods.geojson      microhood polygons
//      Layers keep mz:is_current 1 (current) and -1 (unknown); deprecated, superseded and
//      ceased records are left out. Each feature carries mz_is_current, its parent and, when
//      the WOF hierarchy has one, its macrohood.
//
// Node 18+, no dependencies.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'data/wof');
const RAW = path.join(DIR, 'raw');
const SF = 85922583;
const PLACETYPES = ['macrohood', 'neighbourhood', 'microhood'];
const SPELUNKER = 'https://spelunker.whosonfirst.org';
const GITHUB_RAW = 'https://raw.githubusercontent.com/whosonfirst-data/whosonfirst-data-admin-us/master/data';
const DATA_HOST = 'https://data.whosonfirst.org';

const args = new Set(process.argv.slice(2));
const offline = args.has('--offline');
const fromIds = args.has('--from-ids') || offline;
const idsOnly = args.has('--ids-only');

const wofPath = id => { const s = String(id); return s.match(/.{1,3}/g).join('/') + '/' + s + '.geojson'; };
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function get(url, { json = false, tries = 4 } = {}) {
    for (let i = 1; ; i++) {
        const res = await fetch(url);
        if (res.ok) return json ? res.json() : res.text();
        if (res.status === 404) return null;
        if (i >= tries || ![429, 500, 502, 503, 504].includes(res.status)) throw new Error(`HTTP ${res.status} ${url}`);
        await sleep(1000 * 2 ** i);
    }
}

// ── 1. Spelunker walk ───────────────────────────────────────────────────────
async function walkSpelunker() {
    const ids = new Set();
    for (const pt of PLACETYPES) {
        let before = -1;
        for (let page = 1; page < 200 && ids.size !== before; page++) {
            before = ids.size;
            const html = await get(`${SPELUNKER}/id/${SF}/descendants?placetype=${pt}&page=${page}`);
            if (!html) break;
            for (const m of html.matchAll(/\/id\/(\d+)/g)) if (Number(m[1]) !== SF) ids.add(m[1]);
            process.stdout.write(`\r  ${pt}: page ${page}, ${ids.size} ids`);
            await sleep(250);
        }
        process.stdout.write('\n');
    }
    return [...ids];
}

// ── 2. Download records ─────────────────────────────────────────────────────
async function download(ids) {
    fs.mkdirSync(RAW, { recursive: true });
    const missing = [];
    let fetched = 0;
    const queue = ids.filter(id => !fs.existsSync(path.join(RAW, `${id}.geojson`)));
    async function worker() {
        while (queue.length) {
            const id = queue.shift();
            const text = await get(`${GITHUB_RAW}/${wofPath(id)}`);
            if (!text) { missing.push(id); continue; }
            fs.writeFileSync(path.join(RAW, `${id}.geojson`), text);
            fetched++;
            process.stdout.write(`\r  downloaded ${fetched}`);
        }
    }
    await Promise.all(Array.from({ length: 4 }, worker));
    process.stdout.write('\n');
    return missing;
}

// ── 3. Outputs ──────────────────────────────────────────────────────────────
const isSet = v => v !== undefined && v !== null && v !== '' && v !== 'uuuu' && !(Array.isArray(v) && !v.length);

function status(p) {
    if (isSet(p['edtf:deprecated'])) return 'deprecated';
    if (isSet(p['wof:superseded_by'])) return 'superseded';
    if (isSet(p['edtf:cessation'])) return 'ceased';
    if (p['mz:is_current'] === 1) return 'current';
    if (p['mz:is_current'] === 0) return 'not current';
    return 'unknown';   // mz:is_current -1: never reviewed, not retired
}

const csvCell = v => { const s = v == null ? '' : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };

function build(skipped) {
    const recs = [];
    for (const f of fs.readdirSync(RAW).filter(f => f.endsWith('.geojson'))) {
        const gj = JSON.parse(fs.readFileSync(path.join(RAW, f), 'utf8'));
        const p = gj.properties;
        const inSF = (p['wof:hierarchy'] || []).some(h => h.locality_id === SF);
        if (!PLACETYPES.includes(p['wof:placetype']) || !inSF) { skipped.push(p['wof:id']); continue; }
        recs.push(gj);
    }
    const byId = new Map(recs.map(r => [r.properties['wof:id'], r]));
    const nameOf = id => id === SF ? 'San Francisco' : (byId.get(id)?.properties['wof:name'] ?? '');
    const macroOf = p => (p['wof:hierarchy'] || []).map(h => h.macrohood_id).find(id => id > 0 && id !== p['wof:id']) ?? null;
    const order = { macrohood: 0, neighbourhood: 1, microhood: 2 };
    recs.sort((a, b) => order[a.properties['wof:placetype']] - order[b.properties['wof:placetype']]
        || a.properties['wof:name'].localeCompare(b.properties['wof:name']));

    // places.csv
    const cols = ['wof_id', 'name', 'placetype', 'status', 'mz_is_current', 'macrohood_id', 'macrohood', 'parent_id', 'parent',
        'geometry', 'src_geom', 'lastmodified', 'spelunker', 'geojson'];
    const lines = [cols.join(',')];
    for (const r of recs) {
        const p = r.properties, macro = macroOf(p);
        lines.push([p['wof:id'], p['wof:name'], p['wof:placetype'], status(p), p['mz:is_current'] ?? '', macro ?? '', macro ? nameOf(macro) : '',
            p['wof:parent_id'] > 0 ? p['wof:parent_id'] : '', p['wof:parent_id'] > 0 ? nameOf(p['wof:parent_id']) : '',
            r.geometry?.type ?? '', p['src:geom'] ?? '',
            p['wof:lastmodified'] ? new Date(p['wof:lastmodified'] * 1000).toISOString().slice(0, 10) : '',
            `${SPELUNKER}/id/${p['wof:id']}/`, `${DATA_HOST}/${wofPath(p['wof:id'])}`].map(csvCell).join(','));
    }
    fs.writeFileSync(path.join(DIR, 'places.csv'), lines.join('\n') + '\n');

    // geojson layers: current polygons only
    const feature = r => {
        const p = r.properties, macro = macroOf(p);
        return { type: 'Feature', id: String(p['wof:id']), properties: {
            wof_id: p['wof:id'], name: p['wof:name'], placetype: p['wof:placetype'], mz_is_current: p['mz:is_current'] ?? null,
            ...(macro ? { macrohood_id: macro, macrohood: nameOf(macro) } : {}),
            ...(p['wof:parent_id'] > 0 ? { parent_id: p['wof:parent_id'], parent: nameOf(p['wof:parent_id']) } : {}),
            src_geom: p['src:geom'] ?? null,
        }, geometry: r.geometry };
    };
    // Layers hold mz:is_current 1 and -1. In SF the -1 neighbourhoods (Excelsior, Inner and Outer
    // Sunset, Chinatown, Bayview…) were never reviewed rather than retired: they don't overlap the
    // current ones and together the two sets tile the city. Filter on mz_is_current === 1 for the
    // strictly current set (84 neighbourhoods).
    const live = recs.filter(r => ['current', 'unknown'].includes(status(r.properties)) && /Polygon/.test(r.geometry?.type || ''));
    const ofType = pt => live.filter(r => r.properties['wof:placetype'] === pt);
    const write = (file, feats) => {
        const fc = { type: 'FeatureCollection', name: path.basename(file, '.geojson'), features: feats.map(feature) };
        fs.writeFileSync(path.join(DIR, file), `{"type":"FeatureCollection","name":"${fc.name}","features":[\n${fc.features.map(f => JSON.stringify(f)).join(',\n')}\n]}\n`);
        return fc.features.length;
    };
    const nMacro = write('macrohoods.geojson', ofType('macrohood'));
    const nHood = write('neighbourhoods.geojson', ofType('neighbourhood'));
    const nMicro = write('microhoods.geojson', ofType('microhood'));

    const tally = {};
    for (const r of recs) { const k = `${r.properties['wof:placetype']} ${status(r.properties)} (mz:is_current ${r.properties['mz:is_current']})`; tally[k] = (tally[k] || 0) + 1; }
    console.log(`\n${recs.length} SF records:`, tally);
    console.log(`wrote data/wof/places.csv and polygons (mz:is_current 1 and -1): macrohoods.geojson (${nMacro}), neighbourhoods.geojson (${nHood}), microhoods.geojson (${nMicro})`);
}

// ── main ────────────────────────────────────────────────────────────────────
fs.mkdirSync(DIR, { recursive: true });
const idsFile = path.join(DIR, 'ids.txt');
let ids;
if (fromIds) {
    ids = fs.readFileSync(idsFile, 'utf8').split(/\s+/).filter(Boolean);
    console.log(`${ids.length} ids from data/wof/ids.txt`);
} else {
    console.log('walking the Spelunker…');
    ids = await walkSpelunker();
    fs.writeFileSync(idsFile, ids.sort((a, b) => a - b).join('\n') + '\n');
    console.log(`${ids.length} ids → data/wof/ids.txt`);
}
if (idsOnly) process.exit(0);
const missing = offline ? [] : await download(ids);
if (missing.length) {
    fs.writeFileSync(path.join(DIR, 'missing.txt'), missing.map(id => `${id}\t${SPELUNKER}/id/${id}/`).join('\n') + '\n');
    console.log(`${missing.length} ids not found in whosonfirst-data-admin-us — listed in data/wof/missing.txt`);
}
const skipped = [];
build(skipped);
if (skipped.length) console.log(`ignored ${skipped.length} records that aren't SF macrohoods/neighbourhoods/microhoods`);
