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

// onProgress(step, fraction): 'read' (CSV, by bytes parsed), 'parse' (JSON, no fraction),
// 'locate' (finding each row's location). Big files yield between chunks so the page can paint.
async function readFile(file, { onProgress = () => {} } = {}) {
    const head = await file.slice(0, 64).text();
    const isJSON = /\.(geo)?json$/i.test(file.name) || /^\s*[\[{]/.test(head);
    if (isJSON) {
        onProgress('parse', null);
        await tick();
        const text = await file.text();
        return finishSource(parseJSON(text, file.name), { onProgress });
    }
    return finishSource(await parseCSVFile(file, onProgress), { onProgress });
}
const tick = () => new Promise(r => setTimeout(r, 0));

// A CSV read in chunks straight from the file, reporting how far through it is.
function parseCSVFile(file, onProgress) {
    return new Promise((resolve, reject) => {
        let headers = null;
        const rows = [];
        onProgress('read', 0);
        Papa.parse(file, {
            header: true, skipEmptyLines: 'greedy', transformHeader: h => h.trim(), chunkSize: 1024 * 1024 * 2,
            chunk: res => {
                if (!headers) headers = (res.meta.fields || []).filter(h => h !== '');
                for (const r of res.data) { const o = {}; for (const h of headers) o[h] = r[h] ?? ''; rows.push(o); }
                onProgress('read', Math.min(1, (res.meta.cursor || 0) / (file.size || 1)), rows.length);
            },
            complete: () => {
                if (!headers?.length) return reject(new Error(`${file.name}: no header row found`));
                resolve({ name: file.name, kind: 'csv', headers, rows });
            },
            error: e => reject(new Error(`${file.name}: ${e.message || e}`)),
        });
    });
}

// ── links: Google Sheets, Socrata (DataSF), or any CSV / JSON / GeoJSON URL ──────────────────
// What a pasted link points at, and the URL(s) to fetch. Sheets need sharing set to "Anyone with
// the link"; the export URL is tried first, then the gviz CSV (which reads some mixed columns as
// blank). Socrata resource and dataset links become the resource's JSON, all rows, page by page.
const SOCRATA_ID = /^[a-z0-9]{4}-[a-z0-9]{4}$/;
function resolveLink(input) {
    let u;
    try { u = new URL(String(input).trim()); } catch { throw new Error('That isn’t a link (it should start with https://).'); }
    const gid = u.searchParams.get('gid') || (u.hash.match(/gid=(\d+)/) || [])[1] || '0';
    let m = u.pathname.match(/^\/spreadsheets\/d\/e\/([\w-]+)/);
    if (u.hostname === 'docs.google.com' && m)   // "Publish to web" link
        return { kind: 'sheet', urls: [`https://docs.google.com/spreadsheets/d/e/${m[1]}/pub?output=csv&gid=${gid}`], format: 'csv', id: m[1], gid };
    m = u.pathname.match(/^\/spreadsheets\/d\/([\w-]+)/);
    if (u.hostname === 'docs.google.com' && m) return { kind: 'sheet', id: m[1], gid, format: 'csv', urls: [
        `https://docs.google.com/spreadsheets/d/${m[1]}/export?format=csv&gid=${gid}`,
        `https://docs.google.com/spreadsheets/d/${m[1]}/gviz/tq?tqx=out:csv&gid=${gid}`] };
    // Socrata: /resource/abcd-1234(.json|.csv|.geojson), or a dataset page ending in the id (or /about_data).
    m = u.pathname.match(/\/resource\/([a-z0-9]{4}-[a-z0-9]{4})(\.(json|csv|geojson))?$/i);
    const page = !m && u.pathname.split('/').filter(Boolean).filter(p => p !== 'about_data').pop();
    const id = m ? m[1] : page && SOCRATA_ID.test(page) && /^data\.|\.gov$|socrata/.test(u.hostname) ? page : null;
    if (id) {
        const q = new URLSearchParams(m ? u.search : '');   // keep a resource link's own $where, $select…
        return { kind: 'socrata', host: u.host, id, query: q, format: 'json',
            meta: `https://${u.host}/api/views/${id}.json`, base: `https://${u.host}/resource/${id}.json` };
    }
    const ext = (u.pathname.match(/\.(csv|tsv|txt|json|geojson)$/i) || [])[1]?.toLowerCase();
    return { kind: 'url', urls: [u.href], format: ext === 'json' || ext === 'geojson' ? 'json' : ext ? 'csv' : null };
}

// Fetch with how many bytes have come so far.
async function fetchText(url, onBytes) {
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) throw Object.assign(new Error(`HTTP ${res.status}`), { status: res.status });
    const type = res.headers.get('content-type') || '';
    if (!res.body || !onBytes) return { text: await res.text(), type };
    const reader = res.body.getReader(), chunks = [];
    let n = 0;
    for (;;) { const { done, value } = await reader.read(); if (done) break; chunks.push(value); n += value.length; onBytes(n); }
    return { text: new TextDecoder().decode(chunks.length === 1 ? chunks[0] : chunks.reduce((a, c) => { const b = new Uint8Array(a.length + c.length); b.set(a); b.set(c, a.length); return b; }, new Uint8Array())), type };
}

// onProgress(step, info): 'fetch' { bytes, page, rows }, then readFile's steps.
async function readURL(input, { onProgress = () => {} } = {}) {
    const link = resolveLink(input);
    if (link.kind === 'socrata') {
        // Its name, for the title (optional), then every row: Socrata gives 1,000 unless asked.
        let name = link.id;
        try { const m = await (await fetch(link.meta)).json(); if (m?.name) name = m.name; } catch { /* the id will do */ }
        const LIMIT = 50000, rows = [];
        const own = link.query.get('$limit');
        for (let page = 1, offset = 0; ; page++) {
            const q = new URLSearchParams(link.query);
            if (!own) { q.set('$limit', LIMIT); q.set('$offset', offset); if (!q.has('$order')) q.set('$order', ':id'); }
            onProgress('fetch', { page, rows: rows.length });
            const { text } = await fetchText(`${link.base}?${q}`, b => onProgress('fetch', { page, rows: rows.length, bytes: b }));
            const batch = JSON.parse(text);
            if (!Array.isArray(batch)) throw new Error(batch?.message || 'Socrata didn’t return rows');
            rows.push(...batch);
            if (own || batch.length < LIMIT) break;
            offset += LIMIT;
        }
        // Socrata's ":@computed_region_…" columns are its own area ids, not the data's.
        const clean = rows.map(r => { const o = {}; for (const k in r) if (!k.startsWith(':')) o[k] = r[k]; return o; });
        const src = { name, kind: 'socrata', headers: headersOf(clean), rows: clean, link: { url: String(input).trim(), host: link.host, id: link.id } };
        return finishSource(src, { onProgress });
    }
    let got, lastErr;
    for (const url of link.urls) {
        try { got = await fetchText(url, b => onProgress('fetch', { bytes: b })); break; } catch (e) { lastErr = e; }
    }
    if (!got) {
        if (link.kind === 'sheet') throw new Error('Couldn’t read that sheet. In Google Sheets, set Share › General access to “Anyone with the link” (Viewer), then try again.');
        throw new Error(`Couldn’t load that link (${lastErr?.message || 'blocked'}). The site may not allow other pages to read it (CORS); downloading the file and loading it works instead.`);
    }
    const text = got.text;
    if (link.kind === 'sheet' && /^\s*<!doctype html|^\s*<html/i.test(text)) throw new Error('That sheet isn’t shared publicly. In Google Sheets, set Share › General access to “Anyone with the link” (Viewer), then try again.');
    const isJSON = link.format === 'json' || (!link.format && (/json/.test(got.type) || /^\s*[\[{]/.test(text)));
    const name = link.kind === 'sheet' ? `Google Sheet${link.gid !== '0' ? ` (tab ${link.gid})` : ''}` : decodeURIComponent(new URL(link.urls[0]).pathname.split('/').pop() || new URL(link.urls[0]).host);
    const src = isJSON ? parseJSON(text, name) : parseCSV(text, name);
    if (link.kind === 'sheet') src.kind = 'sheet';
    src.link = { url: String(input).trim() };
    return finishSource(src, { onProgress });
}

// Shared by files and Airtable: find geometry, stamp the load time. With onProgress (files), big
// files find locations in chunks and say how far along they are; without it, all at once.
function finishSource(src, { onProgress } = {}) {
    if (!src.rows.length) throw new Error(`${src.name}: no rows`);
    if (onProgress && !src.geoms && src.rows.length > 20000) return finishSourceAsync(src, onProgress);
    detectGeometry(src);
    return finishTail(src);
}
async function finishSourceAsync(src, onProgress) {
    // Decide where locations are from a sample, then read every row's in chunks.
    const sample = { rows: src.rows.filter((_, i) => i % Math.ceil(src.rows.length / 5000) === 0), headers: src.headers };
    detectGeometry(sample);
    if (sample.geoms) {
        const make = geomMaker(sample, src.headers);
        const geoms = new Array(src.rows.length), CH = 25000;
        for (let i = 0; i < src.rows.length; i += CH) {
            onProgress('locate', i / src.rows.length);
            await tick();
            for (let j = i; j < Math.min(src.rows.length, i + CH); j++) geoms[j] = make(src.rows[j]);
        }
        Object.assign(src, { geoms, geomFrom: sample.geomFrom, geomCols: sample.geomCols });
    }
    return finishTail(src);
}
// The per-row reader detectGeometry settled on for a sample.
function geomMaker(sample) {
    const [a, b] = sample.geomCols;
    if (/^WKT/.test(sample.geomFrom)) return r => parseWKT(r[a]);
    if (/^location/.test(sample.geomFrom)) return r => parseLatLonPair(r[a]) || parseObjectGeom(r[a]);
    return r => { const lat = num(r[a]), lon = num(r[b]); return isFinite(lat) && isFinite(lon) && !(lat === 0 && lon === 0) ? { type: 'Point', coordinates: [lon, lat] } : null; };
}
function finishTail(src) {
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

window.JoinerSources = { readFile, readURL, resolveLink, finishSource, makeSnapshot, parseCSV, parseJSON, parseWKT, detectGeometry };
})();
