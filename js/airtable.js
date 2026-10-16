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
    button: 'button', multipleRecordLinks: 'linked records (not resolved yet)',
};
const SKIP_NAMES = /(e-?mail|phone|street address|mailing address|home address|^address$|contact info)/i;

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
function planFields(table, include = []) {
    const fetch = [], skipped = [];
    for (const f of table.fields) {
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
async function load(link, tok, { include = [], onProgress } = {}) {
    if (!tok) throw new AirtableError('Paste a personal access token to load from Airtable.');
    const { tables } = await call(`/meta/bases/${link.base}/tables`, tok);
    const table = link.table ? tables.find(t => t.id === link.table) : tables[0];
    if (!table) throw new AirtableError('That table isn’t in the base (or the token can’t see it).');
    const view = link.view ? (table.views || []).find(v => v.id === link.view) : null;
    if (link.view && !view) throw new AirtableError('That view isn’t in the table.');
    const { fetch: fields, skipped } = planFields(table, include);
    const rows = [];
    let offset;
    do {
        const page = await call(`/${link.base}/${table.id}/listRecords`, tok, { method: 'POST', body: {
            pageSize: 100, fields: fields.map(f => f.name), ...(view ? { view: view.id } : {}), ...(offset ? { offset } : {}) } });
        for (const r of page.records || []) {
            const row = { _airtable_id: r.id };
            for (const f of fields) if (f.name in r.fields) row[f.name] = cellValue(f, r.fields[f.name]);
            rows.push(row);
        }
        offset = page.offset;
        onProgress?.(rows.length);
        if (offset) await sleep(PAGE_GAP_MS);
    } while (offset);
    const name = `${table.name.trim()}${view ? ' · ' + view.name : ''}`;
    return {
        name, kind: 'airtable', rows,
        headers: [...fields.map(f => f.name), '_airtable_id'],
        airtable: { base: link.base, table: table.id, view: view?.id || null, tableName: table.name.trim(), viewName: view?.name || null,
            skipped, include, tables: tables.map(t => ({ id: t.id, name: t.name.trim(), views: (t.views || []).map(v => ({ id: v.id, name: v.name })) })) },
    };
}

window.JoinerAirtable = { parseLink, linkFor, load, token, planFields, AirtableError };
})();
