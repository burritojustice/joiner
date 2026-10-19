// Joiner — load rows from an Airtable view with a personal access token.
// The token stays in this tab (sessionStorage) and is sent only to api.airtable.com.
// Contact fields (email, phone, street address, attachments, collaborators) are never
// requested, so they don't reach the browser or a saved snapshot; the panel lists them
// and any can be added back.
(function () {
'use strict';

const API = 'https://api.airtable.com/v0';
const TOKEN_KEY = 'joiner.airtable.token';
const PAGE_GAP_MS = 220;   // Airtable allows 5 requests a second per base

// Field types that hold contact details, files or Airtable users; and names that suggest contact info.
const SKIP_TYPES = {
    email: 'email', phoneNumber: 'phone', multipleAttachments: 'attachments',
    singleCollaborator: 'Airtable user', multipleCollaborators: 'Airtable users', createdBy: 'Airtable user', lastModifiedBy: 'Airtable user',
    button: 'button',
};
const SKIP_NAMES = /(e-?mail|phone|street address|mailing address|home address|^address$|contact info)/i;

// Geometry from linked records: WKT in a field named like these, combined into one GeoJSON shape.
const GEOM_NAME = /^(wkt|geom|geometry|the_geom|shape)$/i;
function combineWKT(list) {
    const gs = list.map(w => window.JoinerSources?.parseWKT(w)).filter(Boolean);
    if (!gs.length) return null;
    if (gs.length === 1) return gs[0];
    const fam = g => g.type.replace(/^Multi/, '');
    const parts = g => g.type.startsWith('Multi') ? g.coordinates : [g.coordinates];
    if (gs.every(g => fam(g) === fam(gs[0]))) return { type: 'Multi' + fam(gs[0]), coordinates: gs.flatMap(parts) };
    return { type: 'GeometryCollection', geometries: gs };
}
const cellText = v => Array.isArray(v) ? v.join(', ') : v == null ? '' : typeof v === 'object' ? (v.name ?? v.text ?? '') : String(v);

// An Airtable link: https://airtable.com/appXXXX/tblXXXX/viwXXXX?blocks=hide (any part may be missing but the base).
function parseLink(s) {
    const t = String(s || '');
    const base = t.match(/\bapp[A-Za-z0-9]{14}\b/)?.[0];
    if (!base) return null;
    return { base, table: t.match(/\btbl[A-Za-z0-9]{14}\b/)?.[0] || null, view: t.match(/\bviw[A-Za-z0-9]{14}\b/)?.[0] || null };
}
const linkFor = ({ base, table, view }) => `https://airtable.com/${[base, table, view].filter(Boolean).join('/')}`;

const token = {
    get() { try { return sessionStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } },
    set(v) { try { v ? sessionStorage.setItem(TOKEN_KEY, v) : sessionStorage.removeItem(TOKEN_KEY); } catch { /* private mode: memory only */ } },
};

class AirtableError extends Error {}

async function call(path, tok, { method = 'GET', body } = {}) {
    for (let attempt = 0; ; attempt++) {
        let res;
        try {
            res = await fetch(API + path, { method, headers: { Authorization: 'Bearer ' + tok, ...(body ? { 'Content-Type': 'application/json' } : {}) },
                body: body ? JSON.stringify(body) : undefined });
        } catch (e) { throw new AirtableError('Couldn’t reach Airtable (network or browser blocked the request).'); }
        if (res.status === 429 && attempt < 3) { await sleep(1000 * (attempt + 1)); continue; }   // rate limited: back off
        if (res.ok) return res.json();
        let detail = '';
        try { const j = await res.json(); detail = j.error?.message || j.error?.type || (typeof j.error === 'string' ? j.error : ''); } catch { /* not JSON */ }
        const msg = {
            401: 'Airtable didn’t accept the token. Check that it was pasted whole and hasn’t been revoked.',
            403: 'This token can’t read that base. In Airtable’s token settings, add the base and the scopes data.records:read and schema.bases:read.',
            404: 'Airtable couldn’t find that base, table or view. Check the link, and that the token includes the base.',
            422: 'Airtable rejected the request' + (detail ? `: ${detail}` : '.'),
        }[res.status] || `Airtable error ${res.status}${detail ? `: ${detail}` : ''}.`;
        throw new AirtableError(msg);
    }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

// Which fields to request: everything except contact fields, plus any the user added back.
// Linked-record fields are fetched (as record IDs) and resolved below.
function planFields(table, include = [], { links = true } = {}) {
    const fetch = [], skipped = [];
    for (const f of table.fields) {
        if (f.type === 'multipleRecordLinks') { if (links) fetch.push(f); continue; }
        const why = SKIP_TYPES[f.type] || (SKIP_NAMES.test(f.name) && f.id !== table.primaryFieldId ? 'contact info' : '');
        if (why && !include.includes(f.name)) skipped.push({ name: f.name, type: f.type, why });
        else fetch.push(f);
    }
    return { fetch, skipped };
}

// Values as Joiner reads them: currency gets its "$" back (the API sends a bare number), so totals
// and averages are treated as money; everything else is passed through.
function cellValue(f, v) {
    if (v == null) return '';
    if (f.type === 'currency' && typeof v === 'number') return (v < 0 ? '-$' : '$') + Math.abs(v);
    if (f.type === 'multipleLookupValues' || f.type === 'rollup') return Array.isArray(v) ? v.map(x => typeof x === 'object' && x ? (x.name ?? x.url ?? JSON.stringify(x)) : x) : v;
    if (f.type === 'barcode' && typeof v === 'object') return v.text ?? '';
    return v;
}

// Load a base/table/view into a Joiner source: { name, kind: 'airtable', headers, rows, airtable }.
async function load(link, tok, { include = [], skipLinks = [], onProgress } = {}) {
    if (!tok) throw new AirtableError('Paste a personal access token to load from Airtable.');
    onProgress?.({ step: 'schema' });
    const { tables } = await call(`/meta/bases/${link.base}/tables`, tok);
    const table = link.table ? tables.find(t => t.id === link.table) : tables[0];
    if (!table) throw new AirtableError('That table isn’t in the base (or the token can’t see it).');
    const view = link.view ? (table.views || []).find(v => v.id === link.view) : null;
    if (link.view && !view) throw new AirtableError('That view isn’t in the table.');
    const { fetch: fields, skipped } = planFields(table, include);
    onProgress?.({ step: 'fields', table: table.name.trim(), view: view?.name || null, fields: fields.length, skipped: skipped.length });
    const rows = [];
    let offset, pageNo = 0;
    do {
        const page = await call(`/${link.base}/${table.id}/listRecords`, tok, { method: 'POST', body: {
            pageSize: 100, fields: fields.map(f => f.name), ...(view ? { view: view.id } : {}), ...(offset ? { offset } : {}) } });
        for (const r of page.records || []) {
            const row = { _airtable_id: r.id };
            for (const f of fields) if (f.name in r.fields) row[f.name] = cellValue(f, r.fields[f.name]);
            rows.push(row);
        }
        offset = page.offset;
        onProgress?.({ step: 'records', rows: rows.length, page: ++pageNo, more: !!offset, table: table.name.trim() });
        if (offset) await sleep(PAGE_GAP_MS);
    } while (offset);
    // Linked records: bring in the linked table's fields (minus contact fields and its own links),
    // as "Link: Field". The link column shows the linked records' names. Several linked records
    // in one cell: geometry (WKT) is combined into one shape; other values are listed.
    const linkInfo = [], extra = [];
    for (const lf of fields.filter(f => f.type === 'multipleRecordLinks')) {
        const lt = tables.find(t => t.id === lf.options?.linkedTableId);
        const ids = new Set(rows.flatMap(r => Array.isArray(r[lf.name]) ? r[lf.name] : []));
        const info = { field: lf.name, tableId: lt?.id || null, table: lt?.name.trim() || '(table not readable)', resolved: false, fields: 0, shared: 0 };
        linkInfo.push(info);
        if (!lt || skipLinks.includes(lf.name)) continue;
        const ltFields = planFields(lt, [], { links: false }).fetch;
        const prim = lt.fields.find(f => f.id === lt.primaryFieldId);
        const byId = new Map();
        if (ids.size) {
            let off, n = 0;
            do {
                const page = await call(`/${link.base}/${lt.id}/listRecords`, tok, { method: 'POST', body: { pageSize: 100, fields: ltFields.map(f => f.name), ...(off ? { offset: off } : {}) } });
                for (const r of page.records || []) byId.set(r.id, r.fields);
                n += (page.records || []).length; off = page.offset;
                onProgress?.({ step: 'linked', field: lf.name, table: info.table, rows: n });
                if (off) await sleep(PAGE_GAP_MS);
            } while (off);
        }
        const used = ltFields.filter(f => f.id !== lt.primaryFieldId);
        const count = new Map();
        for (const r of rows) {
            const rids = Array.isArray(r[lf.name]) ? r[lf.name] : [];
            rids.forEach(id => count.set(id, (count.get(id) || 0) + 1));
            const recs = rids.map(id => byId.get(id)).filter(Boolean);
            r[lf.name] = recs.map(x => cellText(cellValue(prim, x[prim?.name]))).filter(Boolean).join(', ');
            for (const f of used) {
                const col = `${lf.name}: ${f.name}`;
                const vals = recs.map(x => x[f.name]).filter(v => v != null && v !== '');
                if (!vals.length) continue;
                if (GEOM_NAME.test(f.name) && vals.every(v => typeof v === 'string')) { const g = combineWKT(vals); if (g) r[col] = g; continue; }
                const out = [...new Set(vals.map(v => JSON.stringify(cellValue(f, v))))].map(v => JSON.parse(v));
                r[col] = out.length === 1 ? out[0] : out.flat();
            }
        }
        info.resolved = true; info.fields = used.length; info.shared = [...count.values()].filter(c => c > 1).length;
        extra.push(...used.map(f => `${lf.name}: ${f.name}`).filter(c => rows.some(r => c in r)));
    }
    const name = `${table.name.trim()}${view ? ' · ' + view.name : ''}`;
    return {
        name, kind: 'airtable', rows,
        headers: [...fields.map(f => f.name), ...extra, '_airtable_id'],
        airtable: { base: link.base, table: table.id, view: view?.id || null, tableName: table.name.trim(), viewName: view?.name || null,
            skipped, include, links: linkInfo, skipLinks, tables: tables.map(t => ({ id: t.id, name: t.name.trim(), views: (t.views || []).map(v => ({ id: v.id, name: v.name })) })) },
    };
}

// The bases this token can read, and a base's tables (both need schema.bases:read).
async function listBases(tok) {
    const bases = [];
    let offset;
    do {
        const page = await call('/meta/bases' + (offset ? `?offset=${encodeURIComponent(offset)}` : ''), tok);
        bases.push(...(page.bases || []).map(b => ({ id: b.id, name: b.name.trim(), level: b.permissionLevel })));
        offset = page.offset;
    } while (offset);
    return bases;
}
async function listTables(base, tok) {
    const { tables } = await call(`/meta/bases/${base}/tables`, tok);
    return tables.map(t => ({ id: t.id, name: t.name.trim(), fields: t.fields.length, views: (t.views || []).map(v => ({ id: v.id, name: v.name })) }));
}

// The bases and tables a token can open, kept for the tab (sessionStorage) so the list is there at
// once. It's re-read in the background when older than CATALOG_MAX_AGE, on request (force), and
// from scratch when the token changes. Tables for every base are read in parallel (the rate limit
// is per base), a few at a time; onUpdate gets the catalog as it fills in.
const CATALOG_KEY = 'joiner.airtable.catalog', CATALOG_MAX_AGE = 5 * 60 * 1000;
const fingerprint = t => { let h = 5381; for (const ch of t) h = (h * 33 + ch.charCodeAt(0)) >>> 0; return h.toString(36); };   // not the token itself
let catalogRun = null;
function readCatalog(tok) {
    try { const c = JSON.parse(sessionStorage.getItem(CATALOG_KEY)); return c && c.fp === fingerprint(tok) ? c : null; } catch { return null; }
}
function saveCatalog(c) { try { sessionStorage.setItem(CATALOG_KEY, JSON.stringify(c)); } catch { /* too big or private mode */ } }
function forgetCatalog() { try { sessionStorage.removeItem(CATALOG_KEY); } catch { /* */ } }
function catalog(tok, { force = false, onUpdate } = {}) {
    const have = readCatalog(tok);
    const stale = !have || force || Date.now() - have.at > CATALOG_MAX_AGE;
    if (stale && !catalogRun) catalogRun = refreshCatalog(tok, have, onUpdate).finally(() => { catalogRun = null; });
    else if (catalogRun && onUpdate) catalogRun.then(c => onUpdate(c)).catch(() => {});
    return { catalog: have, refreshing: catalogRun };
}
async function refreshCatalog(tok, prev, onUpdate) {
    const bases = await listBases(tok);
    const old = new Map((prev?.bases || []).map(b => [b.id, b]));
    const c = { fp: fingerprint(tok), at: Date.now(), bases: bases.map(b => ({ ...b, tables: old.get(b.id)?.tables || null })) };
    saveCatalog(c); onUpdate?.(c);
    let next = 0;
    const worker = async () => {
        while (next < c.bases.length) {
            const b = c.bases[next++];
            try { b.tables = await listTables(b.id, tok); b.error = null; }
            catch (e) { b.error = e.message; }
            c.at = Date.now(); saveCatalog(c); onUpdate?.(c);
        }
    };
    await Promise.all([...Array(Math.min(4, c.bases.length))].map(worker));
    return c;
}

window.JoinerAirtable = { parseLink, linkFor, load, listBases, listTables, catalog, readCatalog, forgetCatalog, token, planFields, AirtableError };
})();
