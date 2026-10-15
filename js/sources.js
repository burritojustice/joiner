// Reading data files into { name, kind, headers, rows }.
// kinds: 'csv', 'airtable' (API records JSON), 'json' (array of objects), 'snapshot' (saved by Joiner).
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
            settings: data.settings || {}, savedAt: data.savedAt, sourceKind: data.source?.kind };
    }
    if (data && Array.isArray(data.records)) return fromAirtable([data], name);
    if (Array.isArray(data) && data.length && Array.isArray(data[0]?.records)) return fromAirtable(data, name);
    if (data && data.type === 'FeatureCollection') {
        const rows = (data.features || []).map(f => ({ ...(f.properties || {}) }));
        return { name, kind: 'json', headers: headersOf(rows), rows };
    }
    if (Array.isArray(data) && data.every(r => r && typeof r === 'object' && !Array.isArray(r))) {
        return { name, kind: 'json', headers: headersOf(data), rows: data };
    }
    throw new Error(`${name}: not a recognized JSON shape (expected Airtable records, an array of objects, or a Joiner snapshot)`);
}

async function readFile(file) {
    const text = await file.text();
    const isJSON = /\.(geo)?json$/i.test(file.name) || /^\s*[\[{]/.test(text);
    const src = isJSON ? parseJSON(text, file.name) : parseCSV(text, file.name);
    if (!src.rows.length) throw new Error(`${file.name}: no rows`);
    src.loadedAt = new Date().toISOString();
    return src;
}

function makeSnapshot(src, settings) {
    return {
        format: SNAPSHOT_FORMAT, version: SNAPSHOT_VERSION, savedAt: new Date().toISOString(),
        source: { name: src.name, kind: src.kind === 'snapshot' ? (src.sourceKind || 'snapshot') : src.kind, loadedAt: src.loadedAt },
        settings, headers: src.headers, rows: src.rows,
    };
}

window.JoinerSources = { readFile, makeSnapshot, parseCSV, parseJSON };
})();
