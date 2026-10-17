// Reading data files into { name, kind, headers, rows, geoms, geomFrom }.
// kinds: 'csv', 'airtable' (API records JSON), 'json' (array of objects), 'geojson', 'snapshot'.
// geoms[i] is row i's GeoJSON geometry, or null. geomFrom says where it came from
// ("GeoJSON geometry", "WKT in “point”", "latitude + longitude").
(function () {
'use strict';

const SNAPSHOT_FORMAT = 'joiner-snapshot';
const SNAPSHOT_VERSION = 1;

function headersOf(rows) {
    const seen = new Set();
    rows.forEach(r => Object.keys(r).forEach(k => seen.add(k)));
    return [...seen];
}

function parseCSV(text, name) {
    const res = Papa.parse(text, { header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim() });
    if (!res.meta.fields?.length) throw new Error(`${name}: no header row found`);
    const headers = res.meta.fields.filter(h => h !== '');
    const rows = res.data.map(r => { const o = {}; headers.forEach(h => { o[h] = r[h] ?? ''; }); return o; });
    return { name, kind: 'csv', headers, rows };
}

// Airtable REST: { records: [{ id, createdTime, fields }] }, or an array of such pages.
function fromAirtable(pages, name) {
    const records = pages.flatMap(p => p.records || []);
    const rows = records.map(r => ({ _airtable_id: r.id, ...r.fields }));
    const headers = headersOf(rows).filter(h => h !== '_airtable_id');
    return { name, kind: 'airtable', headers: [...headers, '_airtable_id'], rows };
}

function parseJSON(text, name) {
    const data = JSON.parse(text);
    if (data && data.format === SNAPSHOT_FORMAT) {
        if (!Array.isArray(data.rows) || !Array.isArray(data.headers)) throw new Error(`${name}: snapshot has no rows`);
        return { name: data.source?.name || name, kind: 'snapshot', headers: data.headers, rows: data.rows,
            geoms: data.geoms || null, geomFrom: data.geomFrom || null,
            settings: data.settings || {}, savedAt: data.savedAt, sourceKind: data.source?.kind };
    }
    if (data && Array.isArray(data.records)) return fromAirtable([data], name);
    if (Array.isArray(data) && data.length && Array.isArray(data[0]?.records)) return fromAirtable(data, name);
    if (data && (data.type === 'FeatureCollection' || data.type === 'Feature')) {
        const feats = data.type === 'Feature' ? [data] : (data.features || []);
        const rows = feats.map(f => ({ ...(f.properties || {}) }));
        return { name, kind: 'geojson', headers: headersOf(rows).filter(h => !h.startsWith(':')), rows,
            geoms: feats.map(f => f.geometry || null), geomFrom: 'GeoJSON geometry' };
    }
    if (Array.isArray(data) && data.every(r => r && typeof r === 'object' && !Array.isArray(r))) {
        return { name, kind: 'json', headers: headersOf(data), rows: data };
    }
    throw new Error(`${name}: not a recognized JSON shape (expected Airtable records, GeoJSON, an array of objects, or a Joiner snapshot)`);
}

// ── geometry in table columns ─────────────────────────────────────────────
const num = v => { if (v === null || v === undefined || v === '') return NaN; const n = typeof v === 'number' ? v : Number(String(v).trim()); return n; };

// Minimal WKT reader: POINT, LINESTRING, POLYGON and their MULTI forms (2D; Z/M dropped).
function parseWKT(s) {
    if (typeof s !== 'string') return null;
    const m = s.trim().match(/^(MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|POINT|LINESTRING|POLYGON)\s*(Z|M|ZM)?\s*(\(.*\))\s*$/i);
    if (!m) return null;
    const type = m[1].toUpperCase();
    let body = m[3];
    // Turn "(x y, x y)" nesting into JSON arrays.
    body = body.replace(/(-?[\d.eE+]+)\s+(-?[\d.eE+]+)(\s+-?[\d.eE+]+)*/g, '[$1,$2]').replace(/\(/g, '[').replace(/\)/g, ']');
    let coords;
    try { coords = JSON.parse(body); } catch { return null; }
    const map = { POINT: 'Point', LINESTRING: 'LineString', POLYGON: 'Polygon', MULTIPOINT: 'MultiPoint', MULTILINESTRING: 'MultiLineString', MULTIPOLYGON: 'MultiPolygon' };
    if (type === 'POINT') coords = coords[0];
    if (type === 'MULTIPOINT') coords = coords.map(c => Array.isArray(c[0]) ? c[0] : c);
    return { type: map[type], coordinates: coords };
}

// Socrata "Location" style: "(37.77, -122.42)" or "37.77, -122.42"
function parseLatLonPair(s) {
    if (typeof s !== 'string') return null;
    const m = s.trim().match(/^\(?\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*\)?$/);
    if (!m) return null;
    const lat = +m[1], lon = +m[2];
    return Math.abs(lat) <= 90 && Math.abs(lon) <= 180 ? { type: 'Point', coordinates: [lon, lat] } : null;
}

// Socrata JSON point: { type: 'Point', coordinates: [...] } or { latitude, longitude }
function parseObjectGeom(v) {
    if (!v || typeof v !== 'object') return null;
    if (typeof v.type === 'string' && Array.isArray(v.coordinates)) return v;
    if (v.type === 'GeometryCollection' && Array.isArray(v.geometries)) return v;
    if (v.latitude != null && v.longitude != null) {
        const lat = num(v.latitude), lon = num(v.longitude);
        if (isFinite(lat) && isFinite(lon)) return { type: 'Point', coordinates: [lon, lat] };
    }
    return null;
}

const LAT = /^(lat|latitude|y|point_?y|.*[ _]lat|.*latitude)$/i;
const LON = /^(lon|lng|long|longitude|x|point_?x|.*[ _](lon|lng)|.*longitude)$/i;

// Share of non-empty cells a parser accepts.
function share(rows, col, test) {
    let ok = 0, n = 0;
    for (const r of rows) { const v = r[col]; if (v === '' || v == null) continue; n++; if (test(v)) ok++; }
    return n ? { ok, n, ratio: ok / n } : { ok: 0, n: 0, ratio: 0 };
}

// Finds geometry in table columns: WKT, then "(lat, lon)" text or geometry objects, then a lat/lon pair.
function detectGeometry(src) {
    if (src.geoms) return;
    const { rows, headers } = src;
    for (const col of headers) {
        if (share(rows, col, v => !!parseWKT(v)).ratio >= 0.8) {
            src.geoms = rows.map(r => parseWKT(r[col])); src.geomFrom = `WKT in “${col}”`; src.geomCols = [col]; return;
        }
    }
    for (const col of headers) {
        const s = share(rows, col, v => !!(parseLatLonPair(v) || parseObjectGeom(v)));
        if (s.n && s.ratio >= 0.8) {
            src.geoms = rows.map(r => parseLatLonPair(r[col]) || parseObjectGeom(r[col])); src.geomFrom = `location in “${col}”`; src.geomCols = [col]; return;
        }
    }
    const latCol = headers.find(h => LAT.test(h.trim()) && share(rows, h, v => Math.abs(num(v)) <= 90).ratio >= 0.8);
    const lonCol = headers.find(h => LON.test(h.trim()) && h !== latCol && share(rows, h, v => Math.abs(num(v)) <= 180).ratio >= 0.8);
    if (latCol && lonCol) {
        src.geoms = rows.map(r => {
            const lat = num(r[latCol]), lon = num(r[lonCol]);
            return isFinite(lat) && isFinite(lon) && !(lat === 0 && lon === 0) ? { type: 'Point', coordinates: [lon, lat] } : null;
        });
        src.geomFrom = `“${latCol}” + “${lonCol}”`; src.geomCols = [latCol, lonCol];
    }
}

async function readFile(file) {
    const text = await file.text();
    const isJSON = /\.(geo)?json$/i.test(file.name) || /^\s*[\[{]/.test(text);
    return finishSource(isJSON ? parseJSON(text, file.name) : parseCSV(text, file.name));
}

// Shared by files and Airtable: find geometry, stamp the load time.
function finishSource(src) {
    if (!src.rows.length) throw new Error(`${src.name}: no rows`);
    detectGeometry(src);
    if (src.geoms && !src.geoms.some(Boolean)) { src.geoms = null; src.geomFrom = null; }
    src.loadedAt = new Date().toISOString();
    return src;
}

function makeSnapshot(src, settings) {
    const geomsInRows = src.geomCols && src.kind !== 'snapshot';   // re-detected from the columns on load
    return {
        format: SNAPSHOT_FORMAT, version: SNAPSHOT_VERSION, savedAt: new Date().toISOString(),
        source: { name: src.name, kind: src.kind === 'snapshot' ? (src.sourceKind || 'snapshot') : src.kind, loadedAt: src.loadedAt },
        settings, headers: src.headers, rows: src.rows,
        ...(src.geoms && !geomsInRows ? { geoms: src.geoms, geomFrom: src.geomFrom } : {}),
    };
}

window.JoinerSources = { readFile, finishSource, makeSnapshot, parseCSV, parseJSON, parseWKT, detectGeometry };
})();
