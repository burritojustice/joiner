#!/usr/bin/env node
// Download the boundary layers listed in config/layers.json from DataSF and
// write cleaned copies to data/boundaries/ for Joiner to load.
//
//   node scripts/get_layers.mjs                     all layers
//   node scripts/get_layers.mjs zip_codes ...       just these layers
//   node scripts/get_layers.mjs --file zip_codes=~/Downloads/SF_ZIP_Codes.geojson
//                                                   use a file you exported instead of downloading
//   node scripts/get_layers.mjs --check             re-validate files already in data/boundaries
//
// Cleaning: keeps only the configured properties, sets feature.id to the join
// key, rounds coordinates (6 decimals ≈ 10 cm), merges duplicate keys into one
// MultiPolygon when the layer allows it, and sorts features by key so reruns
// produce small diffs.
//
// bbox: the FeatureCollection's "bbox" covers only polygon parts that touch
// mainlandBbox, so fitting the map to a layer doesn't zoom out to the
// Farallones (part of District 4 and one census tract). The full extent is
// kept as "extent".
//
// Needs Node 18+ (built-in fetch). No dependencies.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/layers.json'), 'utf8'));
const OUT = path.join(ROOT, 'data/boundaries');
const SODA_LIMIT = 50000;

// ── args ────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const files = {};
const only = [];
let checkOnly = false;
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--check') checkOnly = true;
    else if (a === '--file') {
        const [id, p] = (args[++i] || '').split('=');
        if (!id || !p) die('--file needs <layer-id>=<path>');
        files[id] = p.replace(/^~(?=$|\/)/, os.homedir());
    } else if (a === '-h' || a === '--help') { console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 22).join('\n')); process.exit(0); }
    else only.push(a);
}
const known = new Set(CONFIG.layers.map(l => l.id));
for (const id of [...only, ...Object.keys(files)]) if (!known.has(id)) die(`unknown layer "${id}" — see config/layers.json`);
const named = new Set([...only, ...Object.keys(files)]);
const selected = CONFIG.layers.filter(l => !named.size || named.has(l.id));

function die(msg) { console.error('error: ' + msg); process.exit(1); }

// ── geometry helpers ────────────────────────────────────────────────────────
const round = (n, p) => { const f = 10 ** p; return Math.round(n * f) / f; };

function cleanRing(ring, p) {
    const out = [];
    for (const c of ring) {
        const pt = [round(c[0], p), round(c[1], p)];
        const last = out[out.length - 1];
        if (!last || last[0] !== pt[0] || last[1] !== pt[1]) out.push(pt);
    }
    const first = out[0], last = out[out.length - 1];
    if (first && (first[0] !== last[0] || first[1] !== last[1])) out.push([first[0], first[1]]);
    return out.length >= 4 ? out : null;
}

// Always returns an array of polygons (MultiPolygon coordinates).
function toPolygons(geom, p) {
    if (!geom) return [];
    const polys = geom.type === 'Polygon' ? [geom.coordinates]
        : geom.type === 'MultiPolygon' ? geom.coordinates
        : null;
    if (!polys) throw new Error(`expected Polygon/MultiPolygon, got ${geom.type}`);
    return polys.map(rings => {
        const cleaned = rings.map(r => cleanRing(r, p)).filter(Boolean);
        return cleaned.length && cleaned[0] ? cleaned : null;
    }).filter(Boolean);
}

function extendBbox(b, ring) {
    for (const [x, y] of ring) {
        if (x < b[0]) b[0] = x; if (y < b[1]) b[1] = y;
        if (x > b[2]) b[2] = x; if (y > b[3]) b[3] = y;
    }
    return b;
}
const emptyBbox = () => [Infinity, Infinity, -Infinity, -Infinity];
const intersects = (a, b) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];

function bboxes(features, mainland) {
    const extent = emptyBbox(), view = emptyBbox();
    let offshore = 0;
    for (const f of features) for (const poly of f.geometry.coordinates) {
        const pb = extendBbox(emptyBbox(), poly[0]);
        extendBbox(extent, poly[0]);
        if (intersects(pb, mainland)) extendBbox(view, poly[0]); else offshore++;
    }
    return { extent, view: isFinite(view[0]) ? view : extent, offshore };
}

const naturalKey = new Intl.Collator('en', { numeric: true, sensitivity: 'base' }).compare;

// ── one layer ───────────────────────────────────────────────────────────────
async function load(layer) {
    if (files[layer.id]) {
        console.log(`  reading ${files[layer.id]}`);
        return { gj: JSON.parse(fs.readFileSync(files[layer.id], 'utf8')), source: 'file:' + path.basename(files[layer.id]) };
    }
    // Layers made by dissolving another layer by one of its properties (election precincts into
    // US House, State Senate, Assembly and BART districts). The source layer is built first.
    if (layer.dissolve) {
        const { from, by } = layer.dissolve;
        const src = path.join(OUT, `${from}.geojson`);
        if (!fs.existsSync(src)) throw new Error(`build "${from}" first (dissolve source)`);
        const { dissolve } = createRequire(import.meta.url)('../js/vendor/joinkit.js');   // JoinKit 0.3, as the page uses
        console.log(`  dissolving ${from} by ${by}`);
        return { gj: dissolve(JSON.parse(fs.readFileSync(src, 'utf8')), by), source: `${from} dissolved by ${by}` };
    }
    // Layers built from files already in the repo (e.g. Who's on First, from get_wof.mjs).
    if (layer.localFiles) {
        const features = layer.localFiles.flatMap(f => {
            console.log(`  reading ${f}`);
            return JSON.parse(fs.readFileSync(path.join(ROOT, f), 'utf8')).features;
        });
        return { gj: { type: 'FeatureCollection', features }, source: layer.localFiles.join(' + ') };
    }
    const url = `${CONFIG.portal}/resource/${layer.dataset}.geojson?$limit=${SODA_LIMIT}`;
    console.log(`  fetching ${url}`);
    const res = await fetch(url, { headers: { Accept: 'application/geo+json, application/json' } });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
    return { gj: await res.json(), source: url };
}

function clean(layer, gj) {
    if (gj?.type !== 'FeatureCollection' || !Array.isArray(gj.features)) throw new Error('not a GeoJSON FeatureCollection');
    if (gj.features.length >= SODA_LIMIT) console.warn(`  ! ${gj.features.length} features — hit the download limit, data may be cut off`);
    const p = CONFIG.precision ?? 6;
    const byKey = new Map();
    const warnings = [];
    for (const f of gj.features) {
        const props = f.properties || {};
        const key = props[layer.key] == null ? '' : String(props[layer.key]).trim();
        if (!key) { warnings.push(`dropped a feature with no "${layer.key}"`); continue; }
        const polys = toPolygons(f.geometry, p);
        if (!polys.length) { warnings.push(`dropped "${key}": empty geometry`); continue; }
        if (byKey.has(key)) {
            if (!layer.mergeByKey) throw new Error(`duplicate key "${key}" — set "mergeByKey": true if parts should be combined`);
            byKey.get(key).geometry.coordinates.push(...polys);
            byKey.get(key)._parts++;
            continue;
        }
        const kept = {};
        for (const k of layer.keep) if (props[k] !== undefined && props[k] !== null && props[k] !== '') kept[k] = typeof props[k] === 'string' ? props[k].trim() : props[k];
        byKey.set(key, { type: 'Feature', id: key, properties: kept, geometry: { type: 'MultiPolygon', coordinates: polys }, _parts: 1 });
    }
    const merged = [...byKey.values()].filter(f => f._parts > 1).map(f => `${f.id}×${f._parts}`);
    const features = [...byKey.values()].sort((a, b) => naturalKey(a.id, b.id)).map(({ _parts, ...f }) => f);
    if (layer.expectCount && features.length !== layer.expectCount) warnings.push(`expected ${layer.expectCount} features, got ${features.length}`);
    return { features, merged, warnings };
}

// One feature per line: readable diffs, still compact.
function serialize(fc) {
    const { features, ...head } = fc;
    const headJson = JSON.stringify(head).slice(0, -1);
    return `${headJson},"features":[\n${features.map(f => JSON.stringify(f)).join(',\n')}\n]}\n`;
}

async function processLayer(layer) {
    console.log(`${layer.id} (${layer.dataset || "local files"})`);
    const { gj, source } = await load(layer);
    const { features, merged, warnings } = clean(layer, gj);
    // Bay Area layers zoom to all of themselves; SF layers to SF's mainland.
    const { extent, view, offshore } = bboxes(features, layer.regional ? [-180, -90, 180, 90] : CONFIG.mainlandBbox);
    const fc = {
        type: 'FeatureCollection',
        name: layer.id,
        bbox: view.map(n => round(n, 5)),
        extent: extent.map(n => round(n, 5)),
        features,
    };
    const file = path.join(OUT, `${layer.id}.geojson`);
    const text = serialize(fc);
    fs.writeFileSync(file, text);
    console.log(`  → data/boundaries/${layer.id}.geojson  ${features.length} features, ${(text.length / 1024).toFixed(0)} kB` +
        (merged.length ? `, merged ${merged.join(' ')}` : '') + (offshore ? `, ${offshore} offshore part(s) outside bbox` : ''));
    warnings.forEach(w => console.warn('  ! ' + w));
    return manifestEntry(layer, fc, text.length, source);
}

function manifestEntry(layer, fc, bytes, source) {
    return {
        id: layer.id, label: layer.label, ...(layer.short ? { short: layer.short } : {}), tab: layer.tab, ...(layer.default ? { default: true } : {}),
        file: `${layer.id}.geojson`, key: layer.key, name: layer.name,
        ...(layer.nameTemplate ? { nameTemplate: layer.nameTemplate } : {}),
        ...(layer.labelTemplate ? { labelTemplate: layer.labelTemplate } : {}),
        ...(layer.labelExtras ? { labelExtras: layer.labelExtras } : {}),
        ...(layer.match && Object.keys(layer.match).length ? { match: layer.match } : {}),
        ...(layer.regional ? { regional: true } : {}),
        ...(layer.dissolve ? { dissolve: layer.dissolve } : {}),
        count: fc.features.length, bbox: fc.bbox, extent: fc.extent, bytes,
        ...(layer.dataset ? { dataset: layer.dataset } : {}), page: layer.page, source, retrieved: new Date().toISOString().slice(0, 10),
    };
}

function check(layer) {
    const file = path.join(OUT, `${layer.id}.geojson`);
    if (!fs.existsSync(file)) { console.warn(`${layer.id}: missing — run without --check`); return false; }
    const fc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const ids = fc.features.map(f => f.id);
    const problems = [];
    if (new Set(ids).size !== ids.length) problems.push('duplicate feature ids');
    if (fc.features.some(f => f.properties[layer.key] == null)) problems.push(`features missing "${layer.key}"`);
    if (layer.expectCount && ids.length !== layer.expectCount) problems.push(`expected ${layer.expectCount}, got ${ids.length}`);
    console.log(`${layer.id}: ${ids.length} features${problems.length ? ' — ' + problems.join('; ') : ' ok'}`);
    return !problems.length;
}

// ── main ────────────────────────────────────────────────────────────────────
if (checkOnly) {
    const ok = selected.map(check).every(Boolean);
    process.exit(ok ? 0 : 1);
}

fs.mkdirSync(OUT, { recursive: true });
const indexFile = path.join(OUT, 'index.json');
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : { layers: [] };
const entries = new Map(index.layers.map(e => [e.id, e]));
let failed = 0;
for (const layer of selected) {
    try { entries.set(layer.id, await processLayer(layer)); }
    catch (e) { failed++; console.error(`  ✗ ${layer.id}: ${e.message}`); }
}
// Manifest follows config order; drops layers removed from the config.
const out = {
    _doc: 'Written by scripts/get_layers.mjs — do not edit by hand.',
    portal: CONFIG.portal,
    layers: CONFIG.layers.map(l => entries.get(l.id)).filter(Boolean),
};
fs.writeFileSync(indexFile, JSON.stringify(out, null, 2) + '\n');
console.log(`\nwrote data/boundaries/index.json (${out.layers.length} layers)${failed ? `, ${failed} failed` : ''}`);
process.exit(failed ? 1 : 0);
