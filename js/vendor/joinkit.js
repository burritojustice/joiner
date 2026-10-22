/*!
 * JoinKit — table-to-geometry join logic shared by Selecter and Joiner.
 *
 * Pure functions only: no DOM, no MapLibre, no globals. Works as a plain
 * <script> (exposes window.JoinKit) and under Node (module.exports), so it
 * keeps Selecter's no-build, no-modules rule and can be unit tested.
 *
 * Extracted from selecter/index.html (v964). Functions marked "Selecter
 * parity" must produce byte-identical results to the code they replaced —
 * joinkit/test/parity.test.js checks this against the original source.
 *
 * https://github.com/burritojustice/maplibre/tree/main/joinkit
 */
(function (root, factory) {
    if (typeof module === 'object' && module.exports) module.exports = factory();
    else root.JoinKit = factory();
})(typeof self !== 'undefined' ? self : this, function () {
'use strict';

const VERSION = '0.3.0';
const noop = () => {};

// ═════════════════════════════════════════════════════════════════════════
// Value normalization
// ═════════════════════════════════════════════════════════════════════════

// Selecter parity (normVal). Strips thousands-separator commas from numeric
// strings so "3,495,000" matches the integer property 3495000.
function normVal(v) {
    if (!v) return '';
    const stripped = String(v).trim().replace(/,/g, '');
    return isNaN(stripped) || stripped === '' ? String(v).trim() : stripped;
}

// Selecter parity (_parseNum / parseCurrencyVal). Number from a cell,
// accepting "$45,000" style currency strings. Returns null when not numeric.
function parseNum(v) {
    if (v === null || v === undefined || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v).trim();
    if (!isNaN(Number(s)) && isFinite(Number(s))) return Number(s);
    const stripped = s.replace(/^\$/, '').replace(/,/g, '').trim();
    const n = Number(stripped);
    return (!isNaN(n) && isFinite(n)) ? n : null;
}

function isCurrencyVal(v) {
    if (v === null || v === undefined || v === '') return false;
    return String(v).trim().startsWith('$');
}

// Text form of a cell. Airtable returns selects as {name}, multi-selects and
// linked records as arrays; flatten those to their display names.
function cellText(v) {
    if (v === null || v === undefined) return '';
    if (Array.isArray(v)) return v.map(cellText).filter(s => s !== '').join(', ');
    if (typeof v === 'object') return v.name != null ? String(v.name) : (v.label != null ? String(v.label) : JSON.stringify(v));
    return String(v);
}

// Split a cell into its individual values. Arrays (Airtable multi-select,
// linked records) are always split; strings only when a delimiter is given.
function cellValues(v, delimiter) {
    if (v === null || v === undefined || v === '') return [];
    if (Array.isArray(v)) return v.flatMap(x => cellValues(x, delimiter));
    if (typeof v === 'object') return [cellText(v)];
    if (delimiter) {
        const parts = delimiter instanceof RegExp ? String(v).split(delimiter) : String(v).split(delimiter);
        return parts.map(s => s.trim()).filter(Boolean);
    }
    return [v];
}

// Build a key normalizer. Defaults match normVal, except that numeric 0 is
// kept as the key "0" (normVal treats it as empty — a Selecter quirk that
// buildJoin's default keeps for parity).
//   stripPrefix        RegExp or string removed from the start ("D5" → "5")
//   caseInsensitive    lowercase both sides
//   collapseSpace      squeeze internal whitespace runs to one space
//   stripLeadingZeros  "007" → "7"  (Selecter known issue: "01" vs 1)
//   padStart           [width, char] e.g. [5, '0'] for zips stored as numbers
//   aliases            { rawValue: canonicalValue } crosswalk, applied first
function makeKeyNormalizer(opts) {
    const o = opts || {};
    const fold = s => o.caseInsensitive ? s.toLowerCase() : s;
    const squeeze = s => o.collapseSpace ? s.replace(/\s+/g, ' ') : s;
    const aliasMap = new Map();
    if (o.aliases) {
        for (const [k, v] of Object.entries(o.aliases)) aliasMap.set(fold(squeeze(String(k).trim())), v);
    }
    const prefix = typeof o.stripPrefix === 'string'
        ? new RegExp('^' + o.stripPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), o.caseInsensitive ? 'i' : '')
        : o.stripPrefix || null;
    return function normalizeKey(v) {
        if (v === null || v === undefined || v === '') return '';
        if (typeof v === 'object') v = cellText(v);
        let s = squeeze(String(v).trim());
        const aliasKey = fold(s);
        if (aliasMap.has(aliasKey)) s = squeeze(String(aliasMap.get(aliasKey)).trim());
        if (prefix) s = s.replace(prefix, '').trim();
        s = normVal(s);
        if (o.stripLeadingZeros && /^0+\d/.test(s)) s = s.replace(/^0+(?=\d)/, '');
        if (o.padStart && /^\d+$/.test(s)) s = s.padStart(o.padStart[0], o.padStart[1] || '0');
        return fold(s);
    };
}

// Normalized, de-duplicated keys for one row.
function rowKeys(row, keyCol, normalize, delimiter) {
    const raw = row[keyCol];
    const vals = (Array.isArray(raw) || delimiter) ? cellValues(raw, delimiter) : [raw ?? ''];
    const out = [];
    for (const v of vals) {
        const k = normalize(v);
        if (k && !out.includes(k)) out.push(k);
    }
    return out;
}

// ═════════════════════════════════════════════════════════════════════════
// Column classification (numeric / currency / categorical)
// ═════════════════════════════════════════════════════════════════════════

const CURRENCY_NAME_HINTS = ['amount','cost','price','budget','fee','payment','revenue',
    'salary','wage','income','spend','spending','expense','grant','award','funded','funding','total'];

// Column names that look numeric but are identifiers — always categorical.
const FORCE_CAT_NAMES = [
    'zip','zipcode','zip_code','postal','postalcode',
    'geoid','geo_id','fips','fips_code',
    'tractce','tract','blkgrpce','blockce','blockgrp',
    'countyfp','statefp','stateabbr','state_fips',
    'objectid','object_id','globalid','global_id',
    'phone','tel','telephone','mobile','fax',
    'ssn','ein','tax_id',
    'year','yr',
    'district','dist','ward','precinct','zone','sector','region','area','quad',
    'supdist','sup_dist','supervisorial',
];
// Matched as whole "_"-separated tokens only ("awarded" does not match "ward").
const FORCE_CAT_PARTIAL = ['district','ward','precinct','zone','sector'];

// Selecter parity (_isForcecat in _buildJoinStore).
function isForcedCategorical(col, vals) {
    const low = col.toLowerCase().replace(/[^a-z0-9_]/g, '_');
    if (FORCE_CAT_NAMES.some(n => low === n || low === n + '_' || low.endsWith('_' + n) || low.startsWith(n + '_'))) return true;
    const tokens = low.split('_').filter(Boolean);
    if (FORCE_CAT_PARTIAL.some(n => tokens.includes(n))) return true;
    const zeropadded = vals.filter(v => /^0\d{3,}$/.test(String(v).trim())).length;
    if (zeropadded / vals.length > 0.3) return true;
    const numericVals = vals.map(v => Number(v)).filter(n => !isNaN(n) && isFinite(n));
    if (numericVals.length / vals.length > 0.9) {
        const allSmallInt = numericVals.every(n => Number.isInteger(n) && n >= 1 && n <= 99);
        const distinctCount = new Set(numericVals).size;
        if (allSmallInt && distinctCount <= 20) return true;
    }
    return false;
}

// Selecter parity (column loop in _buildJoinStore).
//   exclude   columns to skip entirely (the join key)
//   types     { col: 'numeric' | 'currency' | 'categorical' } — explicit types
//             win over guessing. Use this for sources with a schema (Airtable)
//             so 0–5 score fields aren't mistaken for district numbers.
//   statsCol  restrict numeric stats to one column ('__all__' = no restriction)
//   log       optional logger, e.g. console.log
function classifyColumns(rows, headers, opts) {
    const o = opts || {};
    const log = o.log || noop;
    const exclude = new Set(o.exclude || []);
    const types = o.types || {};
    let numericCols = [], catCols = [];
    const currencyCols = new Set();

    headers.filter(h => !exclude.has(h)).forEach(col => {
        const t = types[col];
        if (t === 'numeric' || t === 'currency') {
            numericCols.push(col);
            if (t === 'currency') currencyCols.add(col);
            return;
        }
        if (t === 'categorical') { catCols.push(col); return; }

        const vals = rows.map(r => r[col]).filter(v => v !== null && v !== undefined && v !== '');
        if (!vals.length) { catCols.push(col); return; }

        if (isForcedCategorical(col, vals)) {
            catCols.push(col);
            log(`[join] cat col (forced): "${col}" — zip/census/id/phone column`);
            return;
        }
        const currencyCount = vals.filter(v => isCurrencyVal(v)).length;
        const isCurrencyCol = currencyCount > 0 && currencyCount / vals.length >= 0.5;

        const parseableCount = vals.filter(v => parseNum(v) !== null).length;
        if (!parseableCount) { catCols.push(col); return; }
        const parseableRatio = parseableCount / vals.length;
        const colLower = col.toLowerCase();
        const nameHint = CURRENCY_NAME_HINTS.some(h => colLower.includes(h));

        // Currency columns: ≥1 value, ≥10% parseable (free text mixed in is common).
        // Plain numeric columns: ≥3 values, ≥50% parseable.
        const loose = isCurrencyCol || (nameHint && currencyCount > 0);
        const minRequired = loose ? 1 : 3;
        const minRatio = loose ? 0.1 : 0.5;

        if (parseableCount >= minRequired && parseableRatio >= minRatio) {
            numericCols.push(col);
            if (loose) currencyCols.add(col);
            log(`[join] numeric col: "${col}" currency=${isCurrencyCol} parseable=${parseableCount}/${vals.length}`);
        } else {
            catCols.push(col);
            log(`[join] cat col: "${col}" parseable=${parseableCount}/${vals.length} minReq=${minRequired} ratio=${parseableRatio.toFixed(2)} sample="${vals[0]}"`);
        }
    });

    if (o.statsCol && o.statsCol !== '__all__') {
        catCols = [...catCols, ...numericCols.filter(c => c !== o.statsCol)];
        numericCols = numericCols.filter(c => c === o.statsCol);
    }
    return { numericCols, catCols, currencyCols };
}

// ═════════════════════════════════════════════════════════════════════════
// Aggregation
// ═════════════════════════════════════════════════════════════════════════

// Selecter parity (_computeJoinAgg).
function computeAgg(rows, numericCols, catCols) {
    const agg = { count: rows.length };
    numericCols.forEach(col => {
        const vals = rows.map(r => parseNum(r[col])).filter(v => v !== null);
        if (!vals.length) {
            ['sum','avg','min','max','median','stddev'].forEach(a => agg[`${a}_${col}`] = null);
            agg[`count_${col}`] = 0; return;
        }
        vals.sort((a, b) => a - b);
        const n = vals.length, sum = vals.reduce((a, b) => a + b, 0), mean = sum / n;
        const median = n % 2 === 0 ? (vals[n/2-1] + vals[n/2]) / 2 : vals[Math.floor(n/2)];
        const stddev = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / n);
        agg[`count_${col}`]  = n;
        agg[`sum_${col}`]    = parseFloat(sum.toFixed(4));
        agg[`avg_${col}`]    = parseFloat(mean.toFixed(4));
        agg[`min_${col}`]    = vals[0];
        agg[`max_${col}`]    = vals[n - 1];
        agg[`median_${col}`] = parseFloat(median.toFixed(4));
        agg[`stddev_${col}`] = parseFloat(stddev.toFixed(4));
    });
    catCols.forEach(col => {
        const counts = {};
        rows.forEach(r => { const v = cellText(r[col]).trim(); if (v) counts[v] = (counts[v] || 0) + 1; });
        agg[`mode_${col}`] = Object.entries(counts).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    });
    return agg;
}

// Category value counts across rows; multi-valued cells count each value.
function countValues(rows, col, opts) {
    const o = opts || {};
    const counts = {};
    rows.forEach(r => {
        const raw = r[col];
        const vals = Array.isArray(raw) ? cellValues(raw).map(cellText) : [cellText(raw)];
        vals.forEach(v => { v = String(v).trim(); if (v) counts[v] = (counts[v] || 0) + 1; });
    });
    if (o.max && Object.keys(counts).length > o.max) return null;
    return counts;
}

// Selecter csvTotals: parseFloat after stripping "$" and ","; kept separate from
// parseNum because parseFloat accepts trailing text ("12 units" → 12).
function columnTotal(rows, col) {
    return rows.reduce((acc, r) => {
        const v = cellText(r[col]).trim().replace(/^\$/, '').replace(/,/g, '');
        const n = parseFloat(v);
        return isNaN(n) ? acc : acc + n;
    }, 0);
}

// ═════════════════════════════════════════════════════════════════════════
// Indexes and the join itself
// ═════════════════════════════════════════════════════════════════════════

const defaultIdOf = f => f.properties._gvid;

// Map of normalized property value → [feature ids], for one property.
function buildFeatureIndex(features, propKey, opts) {
    const o = opts || {};
    const normalize = o.normalize || normVal;
    const idOf = o.idOf || defaultIdOf;
    const index = new Map();
    features.forEach(f => {
        const v = normalize(String(f.properties?.[propKey] ?? ''));
        if (!v) return;
        if (!index.has(v)) index.set(v, []);
        index.get(v).push(idOf(f));
    });
    return index;
}

// Selecter parity (propIndex in _joinFromGeoJSON / _loadCSV).
// { propKey: Map(normalizedValue → Set(featureId)) } across many properties.
function buildPropIndex(features, props, opts) {
    const o = opts || {};
    const normalize = o.normalize || normVal;
    const idOf = o.idOf || defaultIdOf;
    const propIndex = {};
    for (const f of features) {
        for (const k of props) {
            const v = f.properties[k];
            if (v == null || v === '') continue;
            const nv = normalize(String(v));
            if (!propIndex[k]) propIndex[k] = new Map();
            if (!propIndex[k].has(nv)) propIndex[k].set(nv, new Set());
            propIndex[k].get(nv).add(idOf(f));
        }
    }
    return propIndex;
}

const NAME_HINTS = ['name','title','label','school','site','building','address','street','facility','location','description','place'];

// Selecter parity (_buildJoinStore minus UI state).
// Joins rows to features on rows[keyCol] ↔ feature.properties[propKey].
//   normalize   key normalizer (default normVal) — applied to both sides
//   delimiter   split string keys ("1, 3") into several; arrays always split
//   idOf        feature → stable id (default properties._gvid)
//   types, statsCol, log — see classifyColumns
// A row whose cell holds several keys counts once toward each matched feature.
function buildJoin(params) {
    const { rows, headers, keyCol, features, propKey } = params;
    const normalize = params.normalize || normVal;
    const idOf = params.idOf || defaultIdOf;
    const log = params.log || noop;

    const { numericCols, catCols, currencyCols } = classifyColumns(rows, headers, {
        exclude: [keyCol], types: params.types, statsCol: params.statsCol, log,
    });

    const index = buildFeatureIndex(features, propKey, { normalize, idOf });
    const keysOf = r => rowKeys(r, keyCol, normalize, params.delimiter);

    const byId = {};
    let matchedRows = 0, nullRows = 0;
    const unmatchedVals = new Set();
    rows.forEach(row => {
        const keys = keysOf(row);
        if (!keys.length) { nullRows++; return; }
        const ids = [];
        let matched = false;
        keys.forEach(k => {
            const hit = index.get(k);
            if (!hit) { unmatchedVals.add(k); return; }
            matched = true;
            hit.forEach(id => { if (!ids.includes(id)) ids.push(id); });
        });
        if (matched) matchedRows++;
        ids.forEach(id => {
            if (!byId[id]) byId[id] = { rows: [] };
            byId[id].rows.push(row);
        });
    });

    Object.values(byId).forEach(entry => { entry.agg = computeAgg(entry.rows, numericCols, catCols); });
    const globalAgg = computeAgg(rows, numericCols, catCols);

    // Per-column range of per-feature averages — drives palette breaks.
    const aggColumns = {};
    numericCols.forEach(col => {
        const vals = Object.values(byId).map(e => e.agg[`avg_${col}`]).filter(v => v !== null);
        if (!vals.length) return;
        vals.sort((a, b) => a - b);
        const n = vals.length, sum = vals.reduce((a, b) => a + b, 0), mean = sum / n;
        aggColumns[col] = { min: vals[0], max: vals[n-1], mean: parseFloat(mean.toFixed(3)),
            count: n, nullCount: Object.keys(byId).length - n };
    });

    const catColumns = {};
    catCols.forEach(col => {
        const counts = countValues(rows, col, { max: 40 });
        if (counts) catColumns[col] = counts;
    });

    // Totals: all rows (denominator for pct_) vs rows that matched a feature.
    const csvTotals = Object.fromEntries(numericCols.map(col => [col, columnTotal(rows, col)]));
    const joinedTotals = Object.fromEntries(numericCols.map(col => {
        let sum = 0;
        Object.values(byId).forEach(e => { const v = e.agg[`sum_${col}`]; if (v != null) sum += v; });
        return [col, parseFloat(sum.toFixed(4))];
    }));
    numericCols.forEach(col => {
        const total = csvTotals[col];
        if (!total || total <= 0) return;
        Object.values(byId).forEach(e => {
            const s = e.agg[`sum_${col}`];
            e.agg[`pct_${col}`] = (s !== null && s !== undefined) ? parseFloat((s / total * 100).toFixed(2)) : null;
        });
    });

    const joinedWithMultiple = Object.values(byId).filter(e => e.rows.length > 1).length;
    const isLookup = joinedWithMultiple === 0 && Object.keys(byId).length > 0;

    const { displayNameProp, displayNameCol } = detectDisplayName({
        rows, headers, keyCol, features, joinedCount: Object.keys(byId).length,
    });

    return {
        keyCol, propKey, headers, rows, numericCols, catCols, currencyCols,
        byId, globalAgg, aggColumns, catColumns, csvTotals, joinedTotals,
        isLookup, joinedWithMultiple, displayNameProp, displayNameCol,
        totalRows: rows.length, matchedRows, nullRows,
        unmatchedVals: [...unmatchedVals].sort(),
    };
}

// Selecter parity (display-name detection in _buildJoinStore).
// Prefers a name-like feature property; falls back to a name-like row column.
function detectDisplayName({ rows, headers, keyCol, features, joinedCount }) {
    const geoProps = [...new Set(features.flatMap(f =>
        Object.keys(f.properties || {}).filter(k => !k.startsWith('_') && !k.startsWith(':'))))];
    const keyCount = joinedCount || 1;
    const scoreCol = vals => {
        const uniq = new Set(vals.filter(v => v && v !== '')).size;
        return uniq >= Math.min(keyCount * 0.5, 3) ? uniq : 0;
    };
    const nameLike = s => NAME_HINTS.some(h => s.toLowerCase().replace(/[^a-z]/g, '').includes(h));
    const displayNameProp = geoProps.filter(nameLike)
        .map(k => ({ k, score: scoreCol(features.map(f => String(f.properties[k] ?? ''))) }))
        .filter(x => x.score > 0).sort((a, b) => b.score - a.score)[0]?.k || null;
    const displayNameCol = displayNameProp ? null : (headers
        .filter(h => nameLike(h) && h !== keyCol)
        .map(h => ({ h, score: scoreCol(rows.map(r => cellText(r[h]))) }))
        .filter(x => x.score > 0).sort((a, b) => b.score - a.score)[0]?.h || null);
    return { displayNameProp, displayNameCol };
}

// ═════════════════════════════════════════════════════════════════════════
// Key candidate scoring (which row column joins to which feature property)
// ═════════════════════════════════════════════════════════════════════════

const PREFERRED_JOIN_FIELDS = ['cnn','objectid','geoid','fips','zip','zipcode',
    'tractce','tract','block','supdist','nhood','neighborhood'];

// Selecter parity (match search at the top of _runJoinFlow).
// Priority 1: column name equals property name (case-insensitive) and shares values.
// Priority 2 (only if none): value intersection, ≥ min(3, 50% of rows) shared values.
// Returns { matches, byName, valueMatchesForDisplay }; matches[0] is the best guess.
function scoreKeyCandidates({ rows, headers, propIndex, geoJsonProps, normalize }) {
    const norm = normalize || normVal;
    const colVals = new Map();
    const valsOf = col => {
        if (!colVals.has(col)) colVals.set(col, rows.map(r => norm(r[col])).filter(v => v));
        return colVals.get(col);
    };
    const gvidsFor = (valMap, hits) => {
        const s = new Set();
        for (const v of hits) valMap.get(v)?.forEach(id => s.add(id));
        return s;
    };

    const nameMatches = [];
    for (const csvCol of headers) {
        const csvLow = csvCol.toLowerCase();
        for (const propKey of geoJsonProps) {
            if (propKey.toLowerCase() !== csvLow) continue;
            const csvSet = new Set(valsOf(csvCol));
            const hits = [...csvSet].filter(v => propIndex[propKey]?.has(v));
            if (!hits.length) continue;
            const matchedGvids = gvidsFor(propIndex[propKey], hits);
            nameMatches.push({ csvCol, propKey, hits, csvMatchCount: hits.length,
                featureMatchCount: matchedGvids.size, matchedGvids,
                isOneToOne: hits.length === matchedGvids.size, byName: true });
        }
    }

    const valueMatches = [];
    if (!nameMatches.length) {
        for (const csvCol of headers) {
            const csvVals = valsOf(csvCol);
            if (!csvVals.length) continue;
            const csvSet = new Set(csvVals);
            for (const [propKey, valMap] of Object.entries(propIndex)) {
                const hits = [...csvSet].filter(v => valMap.has(v));
                if (hits.length >= Math.min(3, csvVals.length * 0.5)) {
                    const matchedGvids = gvidsFor(valMap, hits);
                    valueMatches.push({ csvCol, propKey, hits, csvMatchCount: hits.length,
                        featureMatchCount: matchedGvids.size, matchedGvids,
                        isOneToOne: hits.length === matchedGvids.size, byName: false });
                }
            }
        }
        valueMatches.sort((a, b) => b.hits.length - a.hits.length);
    }

    const matches = nameMatches.length ? nameMatches : valueMatches;
    for (const m of matches) {
        const uniq = new Set(valsOf(m.csvCol)).size;
        m.score = uniq > 0 ? Math.round(m.csvMatchCount / uniq * 100) : 0;
    }
    matches.sort((a, b) => {
        const aPref = PREFERRED_JOIN_FIELDS.indexOf(a.csvCol.toLowerCase());
        const bPref = PREFERRED_JOIN_FIELDS.indexOf(b.csvCol.toLowerCase());
        if (aPref >= 0 || bPref >= 0) {
            if (aPref < 0) return 1; if (bPref < 0) return -1; return aPref - bPref;
        }
        return b.score - a.score;
    });

    // Alternatives shown in the dialog even when a name match won.
    let valueMatchesForDisplay = nameMatches.length ? [] : [...valueMatches];
    if (nameMatches.length) {
        for (const csvCol of headers) {
            const csvVals = valsOf(csvCol);
            if (!csvVals.length) continue;
            const csvSet = new Set(csvVals);
            for (const [propKey, valMap] of Object.entries(propIndex)) {
                if (nameMatches.some(m => m.csvCol === csvCol && m.propKey === propKey)) continue;
                const hits = [...csvSet].filter(v => valMap.has(v));
                if (hits.length >= Math.min(3, csvVals.length * 0.3)) {
                    const matchedGvids = gvidsFor(valMap, hits);
                    valueMatchesForDisplay.push({ csvCol, propKey, hits, csvMatchCount: hits.length,
                        featureMatchCount: matchedGvids.size, byName: false,
                        score: Math.round(hits.length / csvSet.size * 100) });
                }
            }
        }
        valueMatchesForDisplay.sort((a, b) => b.score - a.score);
    }
    return { matches, byName: nameMatches.length > 0, valueMatchesForDisplay };
}

// ═════════════════════════════════════════════════════════════════════════
// Multi-row detection (several rows per key, e.g. one per grade per school)
// ═════════════════════════════════════════════════════════════════════════

// Selecter parity (_rowsPerKey / _isMultiRow / _catCol block in _runJoinFlow).
function detectMultiRow(rows, headers, keyCol, normalize) {
    const norm = normalize || normVal;
    const keyOf = r => norm(String(r[keyCol] ?? ''));
    const counts = {};
    rows.forEach(r => { const k = keyOf(r); if (k) counts[k] = (counts[k] || 0) + 1; });
    const cv = Object.values(counts);
    const rowsPerKey = cv.length ? cv.reduce((a, b) => a + b, 0) / cv.length : 1;
    const isMultiRow = rowsPerKey > 1.5;

    let catCol = null, catVals = [];
    if (isMultiRow) {
        const distinctKeys = new Set(rows.map(keyOf)).size;
        let bestScore = -1;
        for (const h of headers) {
            if (h === keyCol) continue;
            const vals = rows.map(r => String(r[h] ?? '')).filter(v => v && v !== '');
            const uniq = new Set(vals);
            const fillRate = vals.length / rows.length;
            if (uniq.size < 2 || uniq.size > 60 || fillRate < 0.8) continue;
            const coverage = [...uniq].map(v => new Set(rows.filter(r => String(r[h] ?? '') === v).map(keyOf)).size);
            const avgCoverage = coverage.reduce((a, b) => a + b, 0) / coverage.length;
            const coverageScore = Math.min(avgCoverage / (distinctKeys / uniq.size), 1);
            const score = fillRate * coverageScore * (1 - Math.log(uniq.size) / Math.log(60));
            if (score > bestScore) { bestScore = score; catCol = h; catVals = [...uniq].sort(); }
        }
    }
    return { rowsPerKey, isMultiRow, catCol, catVals };
}

// ═════════════════════════════════════════════════════════════════════════
// Row filters — any number of conditions
// ═════════════════════════════════════════════════════════════════════════

// condition: { col, op, value }
//   op: '=' '!=' 'in' 'notIn' 'contains' 'notContains'
//       '>' '>=' '<' '<=' 'between' ([lo, hi])  'empty' 'notEmpty'
// Multi-valued cells (arrays) pass '=' / 'in' / 'contains' if ANY value passes,
// and '!=' / 'notIn' / 'notContains' only if NO value fails.
// Selecter's single rowFilter {col, val} is { col, op: '=', value: val }.
function matchCondition(row, cond) {
    const raw = row[cond.col];
    const op = cond.op || '=';
    const vals = Array.isArray(raw) ? cellValues(raw).map(cellText) : [cellText(raw)];
    const str = v => String(v ?? '');
    const lower = v => str(v).toLowerCase();
    const want = cond.value;
    const wantList = Array.isArray(want) ? want.map(str) : [str(want)];
    const isEmpty = vals.every(v => v === '');
    switch (op) {
        case '=':        return vals.some(v => v === str(want));
        case '!=':       return !vals.some(v => v === str(want));
        case 'in':       return vals.some(v => wantList.includes(v));
        case 'notIn':    return !vals.some(v => wantList.includes(v));
        case 'contains': return vals.some(v => lower(v).includes(lower(want)));
        case 'notContains': return !vals.some(v => lower(v).includes(lower(want)));
        case 'empty':    return isEmpty;
        case 'notEmpty': return !isEmpty;
        case '>': case '>=': case '<': case '<=': case 'between': {
            const n = parseNum(Array.isArray(raw) ? null : raw);
            if (n === null) return false;
            if (op === '>') return n > Number(want);
            if (op === '>=') return n >= Number(want);
            if (op === '<') return n < Number(want);
            if (op === '<=') return n <= Number(want);
            return n >= Number(want[0]) && n <= Number(want[1]);
        }
        default: throw new Error(`JoinKit: unknown filter op "${op}"`);
    }
}

// mode 'and' (default) or 'or'. Empty conditions keep every row.
function filterRows(rows, conditions, opts) {
    const conds = (conditions || []).filter(Boolean);
    if (!conds.length) return rows;
    const any = (opts && opts.mode) === 'or';
    return rows.filter(r => any ? conds.some(c => matchCondition(r, c)) : conds.every(c => matchCondition(r, c)));
}

// ═════════════════════════════════════════════════════════════════════════
// Spatial join — assign points to the polygon that contains them
// ═════════════════════════════════════════════════════════════════════════

function ringContains(ring, x, y) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
        if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) inside = !inside;
    }
    return inside;
}

function polygonContains(rings, x, y) {
    if (!rings.length || !ringContains(rings[0], x, y)) return false;
    for (let i = 1; i < rings.length; i++) if (ringContains(rings[i], x, y)) return false; // hole
    return true;
}

// true if [lng, lat] lies inside a Polygon or MultiPolygon geometry.
function pointInPolygon(lngLat, geometry) {
    if (!geometry) return false;
    const [x, y] = lngLat;
    if (geometry.type === 'Polygon') return polygonContains(geometry.coordinates, x, y);
    if (geometry.type === 'MultiPolygon') return geometry.coordinates.some(p => polygonContains(p, x, y));
    return false;
}

function geomBbox(geometry) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    const walk = c => {
        if (typeof c[0] === 'number') {
            if (c[0] < minX) minX = c[0]; if (c[0] > maxX) maxX = c[0];
            if (c[1] < minY) minY = c[1]; if (c[1] > maxY) maxY = c[1];
        } else c.forEach(walk);
    };
    walk(geometry.coordinates);
    return [minX, minY, maxX, maxY];
}

// Spatial index for point-in-polygon over many points.
// Each feature's edges are bucketed into horizontal strips, so a test only ray-casts the
// edges whose latitude span covers the point (even-odd rule across all rings, which handles
// holes and multipolygons); a coarse grid over feature bboxes picks the candidate features.
// Results match pointInPolygon: the first feature (in input order) containing the point.
function buildPolygonIndex(features, opts) {
    const idOf = (opts && opts.idOf) || defaultIdOf;
    const polys = [];
    for (const f of features) {
        const g = f.geometry;
        if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
        const rings = g.type === 'Polygon' ? g.coordinates : g.coordinates.flat();
        let nEdges = 0;
        for (const r of rings) nEdges += Math.max(0, r.length - 1);
        const bb = geomBbox(g);
        const K = Math.max(1, Math.min(512, Math.round(Math.sqrt(nEdges) * 2)));
        const h = (bb[3] - bb[1]) / K || 1;
        const strips = Array.from({ length: K }, () => []);
        for (const r of rings) {
            for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
                const x1 = r[j][0], y1 = r[j][1], x2 = r[i][0], y2 = r[i][1];
                if (y1 === y2) continue;   // horizontal edges never count as crossings
                const lo = Math.max(0, Math.floor((Math.min(y1, y2) - bb[1]) / h));
                const hi = Math.min(K - 1, Math.floor((Math.max(y1, y2) - bb[1]) / h));
                for (let k = lo; k <= hi; k++) strips[k].push(x1, y1, x2, y2);
            }
        }
        polys.push({ id: idOf(f), bb, K, h, strips });
    }
    const all = unionOf(polys.map(p => p.bb));
    const G = Math.max(1, Math.min(64, Math.ceil(Math.sqrt(polys.length) * 2)));
    const gw = (all[2] - all[0]) / G || 1, gh = (all[3] - all[1]) / G || 1;
    const grid = Array.from({ length: G * G }, () => []);
    polys.forEach((p, n) => {
        const c0 = Math.max(0, Math.floor((p.bb[0] - all[0]) / gw)), c1 = Math.min(G - 1, Math.floor((p.bb[2] - all[0]) / gw));
        const r0 = Math.max(0, Math.floor((p.bb[1] - all[1]) / gh)), r1 = Math.min(G - 1, Math.floor((p.bb[3] - all[1]) / gh));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) grid[r * G + c].push(n);
    });
    function inside(p, x, y) {
        const b = p.bb;
        if (x < b[0] || x > b[2] || y < b[1] || y > b[3]) return false;
        const e = p.strips[Math.min(p.K - 1, Math.floor((y - b[1]) / p.h))];
        let c = false;
        for (let i = 0; i < e.length; i += 4) {
            const y1 = e[i + 1], y2 = e[i + 3];
            if ((y1 > y) !== (y2 > y) && x < (e[i + 2] - e[i]) * (y - y1) / (y2 - y1) + e[i]) c = !c;
        }
        return c;
    }
    function locate(pt) {
        if (!pt || pt[0] == null || pt[1] == null || isNaN(pt[0]) || isNaN(pt[1])) return null;
        const x = +pt[0], y = +pt[1];
        if (x < all[0] || x > all[2] || y < all[1] || y > all[3]) return null;
        const cell = grid[Math.min(G - 1, Math.floor((y - all[1]) / gh)) * G + Math.min(G - 1, Math.floor((x - all[0]) / gw))];
        for (const n of cell) if (inside(polys[n], x, y)) return polys[n].id;
        return null;
    }
    return { locate, locateAll: points => points.map(locate), size: polys.length };
}

// ═════════════════════════════════════════════════════════════════════════
// Forgiving matching (0.3): loose names, multi-value cells
// ═════════════════════════════════════════════════════════════════════════

// Case, spaces and punctuation removed: "Downtown / Civic Center" → "downtownciviccenter".
const looseKey = s => String(s).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]/g, '');

// Levenshtein distance, giving up (max + 1) once it's over max.
function editDistance(a, b, max) {
    if (Math.abs(a.length - b.length) > max) return max + 1;
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const cur = [i]; let low = i;
        for (let j = 1; j <= b.length; j++) { cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); low = Math.min(low, cur[j]); }
        if (low > max) return max + 1;
        prev = cur;
    }
    return prev[b.length];
}

// A normalizer that also forgives spelling, built from the feature side's keys (already run
// through base): case, spaces and punctuation don't count; each side of a slashed or "&" name
// matches it ("Treasure Island" → "Treasure Island/YBI"); a value of fuzzyMin+ letters one letter
// off (two from 11 letters) a single key matches it. Values that match nothing come back as base
// gave them. The result has .names (the set of feature keys).
//   base      the layer's normalizer (makeKeyNormalizer), applied first
//   fuzzyMin  shortest value fuzzy-matched (8: "Marin" mustn't become "Marina")
function makeLooseNormalizer(keys, base, opts) {
    const o = opts || {};
    const b0 = base || makeKeyNormalizer();
    const fuzzyMin = o.fuzzyMin ?? 8;
    const names = new Set(), canon = new Map(), parts = new Map();
    for (const raw of keys) {
        const b = b0(raw);
        if (!b) continue;
        names.add(b); canon.set(looseKey(b), b);
        for (const p of String(b).split(/\s*[\/&]\s*|\s+and\s+/)) {
            const k = looseKey(p);
            if (p !== b && k.length >= 4) parts.set(k, parts.has(k) ? null : b);   // a part shared by two names matches neither
        }
    }
    for (const [k, b] of parts) if (b && !canon.has(k)) canon.set(k, b);
    const fuzzyKeys = [...canon.keys()].filter(k => /[a-z]/.test(k)), memo = new Map();
    const norm = v => {
        const b = b0(v);
        if (!b || names.has(b)) return b;
        if (memo.has(b)) return memo.get(b);
        const l = looseKey(b);
        let out = canon.get(l);
        if (out == null && /[a-z]/.test(l) && l.length >= fuzzyMin) {
            const max = l.length >= 11 ? 2 : 1;
            let best = null, bd = max + 1, tie = false;
            for (const k of fuzzyKeys) { const d = editDistance(l, k, max); if (d < bd) { bd = d; best = k; tie = false; } else if (d === bd) tie = true; }
            if (best && bd <= max && !tie) out = canon.get(best);
        }
        memo.set(b, out ?? b);
        return out ?? b;
    };
    norm.names = names;
    return norm;
}

// Cells listing several values: commas, semicolons, pipes or line breaks (not slashes, which
// are in names like "Castro/Upper Market").
const MULTI_DELIMITER = /\s*[,;|\n]\s*/;
// MULTI_DELIMITER when at least share (5%) of a column's filled cells hold one of those, else null.
function detectDelimiter(rows, col, opts) {
    const o = opts || {};
    let filled = 0, multi = 0;
    for (const r of sampleRows(rows, o.sample ?? 5000)) {
        const v = r[col];
        if (v == null || v === '' || Array.isArray(v)) continue;
        filled++;
        if (/[,;|\n]/.test(String(v))) multi++;
    }
    return filled && multi / filled >= (o.share ?? 0.05) ? MULTI_DELIMITER : null;
}

// Up to n rows spread evenly through the table (all of them when it's smaller).
function sampleRows(rows, n) {
    if (rows.length <= n) return rows;
    return Array.from({ length: n }, (_, i) => rows[Math.floor(i * rows.length / n)]);
}

// ═════════════════════════════════════════════════════════════════════════
// Classes for a color ramp (0.3)
// ═════════════════════════════════════════════════════════════════════════

// Natural breaks (Ckmeans, Wang & Song 2011) on sorted values: k groups, each a slice of sorted.
// Runs of equal values are one unit, and past maxUnits distinct values neighbors are pooled, so
// thousands of values take milliseconds (the DP is O(k·units²)).
function ckmeans(sorted, k, opts) {
    const N = sorted.length, MAX = (opts && opts.maxUnits) || 1500;
    const runs = [];
    for (let i = 0; i < N;) { let j = i + 1; while (j < N && sorted[j] === sorted[i]) j++; runs.push([i, j]); i = j; }
    const units = runs.length <= MAX ? runs : Array.from({ length: MAX }, (_, b) => {
        const r0 = Math.floor(b * runs.length / MAX), r1 = Math.floor((b + 1) * runs.length / MAX) - 1;
        return [runs[r0][0], runs[r1][1]];
    });
    const n = units.length;
    k = Math.max(1, Math.min(k, n));
    const W = new Float64Array(n + 1), S1 = new Float64Array(n + 1), S2 = new Float64Array(n + 1);
    units.forEach(([a, b], i) => {
        let s1 = 0, s2 = 0;
        for (let t = a; t < b; t++) { s1 += sorted[t]; s2 += sorted[t] * sorted[t]; }
        W[i + 1] = W[i] + (b - a); S1[i + 1] = S1[i] + s1; S2[i + 1] = S2[i] + s2;
    });
    const ssd = (j, i) => { const w = W[i + 1] - W[j], s1 = S1[i + 1] - S1[j]; return S2[i + 1] - S2[j] - s1 * s1 / w; };
    const cost = Array.from({ length: k }, () => new Float64Array(n));
    const back = Array.from({ length: k }, () => new Int32Array(n));
    for (let i = 0; i < n; i++) cost[0][i] = ssd(0, i);
    for (let c = 1; c < k; c++) for (let i = c; i < n; i++) {
        let best = Infinity, arg = c;
        for (let j = c; j <= i; j++) { const v = cost[c - 1][j - 1] + ssd(j, i); if (v < best) { best = v; arg = j; } }
        cost[c][i] = best; back[c][i] = arg;
    }
    const groups = []; let end = n - 1;
    for (let c = k - 1; c >= 0; c--) { const start = back[c][end]; groups.unshift(sorted.slice(units[start][0], units[end][1])); end = start - 1; }
    return groups;
}

// Min, max, median and mean of sorted values.
function summaryStats(sorted) {
    const n = sorted.length, mid = n >> 1;
    if (!n) return { n: 0, min: null, max: null, median: null, mean: null };
    return { n, min: sorted[0], max: sorted[n - 1], median: n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
        mean: sorted.reduce((a, b) => a + b, 0) / n };
}

// Classes for values:
//   method  'jenks' (natural breaks, around gaps), 'equal' (same span each) or 'quantile' (same count each)
//   k       most classes (fewer when there are fewer distinct values)
//   log     natural breaks and equal width on log10 of the values (values must be > 0)
// Returns { k, uppers, ranges: [{ lo, hi, n, cls }], classOf(v) → 0…k-1 (or -1 for null), stats, method, log }.
// Equal width keeps empty classes (their span), the others drop them.
function classBreaks(values, opts) {
    const o = opts || {};
    const sorted = values.filter(v => v !== null && v !== undefined && isFinite(v)).sort((a, b) => a - b), n = sorted.length;
    const method = o.method || 'jenks';
    if (!n) return { k: 0, uppers: [], ranges: [], classOf: () => -1, stats: summaryStats([]), method, log: false };
    const k = Math.min(o.k || 5, new Set(sorted).size);
    const log = !!o.log && method !== 'quantile' && sorted[0] > 0;
    const t = log ? Math.log10 : v => v, inv = log ? v => 10 ** v : v => v;
    let uppers, bounds = null;
    if (method === 'equal') {
        const lo = t(sorted[0]), hi = t(sorted[n - 1]), w = (hi - lo) / k || 1;
        bounds = Array.from({ length: k + 1 }, (_, i) => inv(lo + w * i));
        bounds[0] = sorted[0]; bounds[k] = sorted[n - 1];
        uppers = bounds.slice(1);
    } else if (method === 'quantile') {
        uppers = [...new Set(Array.from({ length: k }, (_, i) => sorted[Math.max(0, Math.ceil((i + 1) * n / k) - 1)]))];
    } else {
        const groups = ckmeans(sorted.map(t), k);
        let at = 0;
        uppers = groups.map(g => { at += g.length; return sorted[at - 1]; });
    }
    const kk = uppers.length;
    const idx = v => { const i = uppers.findIndex(u => v <= u); return i < 0 ? kk - 1 : i; };
    const members = uppers.map(() => []);
    for (const v of sorted) members[idx(v)].push(v);
    const ranges = members.map((g, i) => ({ lo: bounds ? bounds[i] : g[0], hi: bounds ? bounds[i + 1] : g[g.length - 1], n: g.length, cls: i }))
        .filter(r => r.n || bounds);
    return { k: kk, uppers, ranges, classOf: v => (v === null || v === undefined || !isFinite(v)) ? -1 : idx(v), stats: summaryStats(sorted), method, log };
}

// ═════════════════════════════════════════════════════════════════════════
// Big tables, in chunks (0.3)
// ═════════════════════════════════════════════════════════════════════════
const defaultYield = () => new Promise(r => setTimeout(r, 0));

// assignPointsToPolygons in chunks: onProgress(done, total) before each, yieldFn() between.
async function assignPointsToPolygonsChunked(points, features, opts) {
    const o = opts || {};
    const index = buildPolygonIndex(features, o), n = points.length, CH = o.chunkSize || 20000;
    const out = new Array(n), yieldFn = o.yieldFn || defaultYield;
    for (let i = 0; i < n; i += CH) {
        o.onProgress?.(i, n);
        await yieldFn();
        const got = index.locateAll(points.slice(i, i + CH));
        for (let j = 0; j < got.length; j++) out[i + j] = got[j];
    }
    o.onProgress?.(n, n);
    return out;
}

// A join for big tables: one pass over the rows in chunks, giving each feature its rows, count
// and per-column count, sum, average and share of the column's total (sum_X, avg_X, count_X,
// pct_X — not the median, stddev or mode buildJoin adds). Column types come from a sample.
// Rows go to features by their key column, or by areaOf (a feature id per row, e.g. from
// assignPointsToPolygons); a key cell can hold several keys (delimiter) and counts toward each.
//   rows, headers, features, propKey, normalize, delimiter, idOf   as buildJoin
//   keyCol      the row column to match (omit with areaOf)
//   areaOf      array: the feature id for each row (or null)
//   types       explicit column types, as classifyColumns; exclude: columns never summed
//   chunkSize, onProgress(done, total), yieldFn
// Returns { keyCol, byId, numericCols, currencyCols, matchedRows, nullRows, totals, rowArea,
// rowAreas (keyCol only: each row's feature ids, in the cell's order), unmatched: [{ label, n }] }.
async function buildJoinChunked(params) {
    const { rows, headers, features } = params;
    const n = rows.length, CH = params.chunkSize || 20000, yieldFn = params.yieldFn || defaultYield;
    const idOf = params.idOf || defaultIdOf, normalize = params.normalize || normVal;
    const types = classifyColumns(sampleRows(rows, 5000), headers, { exclude: [params.keyCol, ...(params.exclude || [])].filter(Boolean), types: params.types });
    const numericCols = types.numericCols, m = numericCols.length;
    const areaOf = params.areaOf || null;
    const index = areaOf ? null : buildFeatureIndex(features, params.propKey, { normalize, idOf });
    const byId = {}, tally = new Map(), totals = new Float64Array(m), nums = new Array(m);
    const rowArea = new Array(n).fill(null), rowAreas = areaOf ? null : new Array(n);
    let matchedRows = 0, nullRows = 0;
    for (let i0 = 0; i0 < n; i0 += CH) {
        params.onProgress?.(i0, n);
        await yieldFn();
        for (let i = i0; i < Math.min(n, i0 + CH); i++) {
            const row = rows[i];
            // Totals cover every row, matched or not: shares are of the whole column, as in buildJoin.
            for (let j = 0; j < m; j++) { const v = parseNum(row[numericCols[j]]); nums[j] = v; if (v !== null) totals[j] += v; }
            let ids;
            if (areaOf) { if (areaOf[i] == null) { nullRows++; continue; } ids = [areaOf[i]]; }
            else {
                ids = []; let any = false;
                const raw = row[params.keyCol];
                const vals = (Array.isArray(raw) || params.delimiter) ? cellValues(raw, params.delimiter).map(cellText) : [raw];
                for (const v of vals) {
                    const k = normalize(v); if (!k) continue; any = true;
                    const hit = index.get(k);
                    if (!hit) { const t = tally.get(k) || tally.set(k, { label: String(cellText(v)).trim(), n: 0 }).get(k); t.n++; continue; }
                    for (const id of hit) if (!ids.includes(id)) ids.push(id);
                }
                rowAreas[i] = ids;
                if (!any) { nullRows++; continue; }
            }
            if (!ids.length) continue;
            matchedRows++; rowArea[i] = ids[0];
            for (const id of ids) {
                const e = byId[id] || (byId[id] = { rows: [], agg: { count: 0 }, _s: new Float64Array(m), _c: new Uint32Array(m) });
                e.rows.push(row); e.agg.count++;
                for (let j = 0; j < m; j++) if (nums[j] !== null) { e._s[j] += nums[j]; e._c[j]++; }
            }
        }
    }
    params.onProgress?.(n, n);
    for (const e of Object.values(byId)) {
        numericCols.forEach((col, j) => {
            const has = e._c[j] > 0;
            e.agg['count_' + col] = e._c[j];
            e.agg['sum_' + col] = has ? e._s[j] : null;
            e.agg['avg_' + col] = has ? e._s[j] / e._c[j] : null;
            if (totals[j] > 0) e.agg['pct_' + col] = has ? e._s[j] / totals[j] * 100 : null;
        });
        delete e._s; delete e._c;
    }
    return {
        keyCol: params.keyCol ?? null, byId, numericCols, currencyCols: types.currencyCols, matchedRows, nullRows,
        totals: Object.fromEntries(numericCols.map((c, j) => [c, totals[j]])), rowArea, rowAreas,
        unmatched: [...tally.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)),
    };
}

// ═════════════════════════════════════════════════════════════════════════
// Dissolve (0.3): merge polygons that share a property
// ═════════════════════════════════════════════════════════════════════════
// Election precincts into districts, say. Shared edges cancel and the rest are chained into
// rings, which needs neighbors to share vertices exactly (true of files cut from one map);
// otherwise the group falls back to a MultiPolygon of its members (same fill, inner lines show).
const ptKey = p => p[0].toFixed(7) + ',' + p[1].toFixed(7);
const signedArea = ring => { let a = 0; for (let i = 0, n = ring.length - 1; i < n; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return a / 2; };
const polysOf = g => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];

function dissolveGeometries(geoms) {
    const polys = geoms.flatMap(polysOf);
    if (polys.length <= 1) return polys.length ? { type: 'Polygon', coordinates: polys[0] } : null;
    const edges = new Map();
    for (const poly of polys) poly.forEach((ring, r) => {
        const rr = (signedArea(ring) > 0) === (r === 0) ? ring : [...ring].reverse();   // outers CCW, holes CW
        for (let i = 0; i < rr.length - 1; i++) {
            const a = rr[i], b = rr[i + 1], ka = ptKey(a), kb = ptKey(b);
            if (ka === kb) continue;
            const k = ka < kb ? ka + '|' + kb : kb + '|' + ka;
            const e = edges.get(k);
            if (e) e.n++; else edges.set(k, { a, b, ka, kb, n: 1 });
        }
    });
    const left = [...edges.values()].filter(e => e.n === 1);
    const from = new Map();
    for (const e of left) (from.get(e.ka) || from.set(e.ka, []).get(e.ka)).push(e);
    const used = new Set(), rings = [];
    for (const e0 of left) {
        if (used.has(e0)) continue;
        const ring = [e0.a];
        let e = e0, guard = 0;
        while (e && !used.has(e) && guard++ < 1e6) {
            used.add(e); ring.push(e.b);
            if (e.kb === e0.ka) break;
            e = (from.get(e.kb) || []).find(x => !used.has(x));
        }
        if (ptKey(ring[0]) !== ptKey(ring[ring.length - 1]) || ring.length < 4) return null;
        rings.push(ring);
    }
    const outers = rings.filter(r => signedArea(r) > 0).map(r => [r]);
    if (!outers.length) return null;
    for (const h of rings.filter(r => signedArea(r) <= 0)) {
        const home = outers.filter(o => ringContains(o[0], h[0][0], h[0][1])).sort((x, y) => Math.abs(signedArea(x[0])) - Math.abs(signedArea(y[0])))[0];
        if (home) home.push(h);
    }
    return outers.length === 1 ? { type: 'Polygon', coordinates: outers[0] } : { type: 'MultiPolygon', coordinates: outers };
}

// One feature per value of prop: { [prop]: value, name, parts } and the merged outline.
function dissolve(fc, prop, opts) {
    const label = (opts && opts.label) || (v => v);
    const groups = new Map();
    for (const f of fc.features) {
        const v = f.properties?.[prop];
        if (v === null || v === undefined || v === '') continue;
        const k = String(v);
        (groups.get(k) || groups.set(k, []).get(k)).push(f);
    }
    const features = [...groups].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true })).map(([k, fs]) => ({
        type: 'Feature', id: k, properties: { [prop]: k, name: String(label(k)), parts: fs.length },
        geometry: dissolveGeometries(fs.map(f => f.geometry)) || { type: 'MultiPolygon', coordinates: fs.flatMap(f => polysOf(f.geometry)) },
    }));
    return { type: 'FeatureCollection', features };
}

// ═════════════════════════════════════════════════════════════════════════
// H3 hexbins (0.3). Pass the h3-js module (v4) in: JoinKit itself stays dependency-free.
// ═════════════════════════════════════════════════════════════════════════
// Meters per pixel at a zoom and latitude (512 px tiles, as MapLibre).
const metersPerPixel = (zoom, lat) => 78271.517 * Math.cos(lat * Math.PI / 180) / 2 ** zoom;
// A hexagon's width (flat side to flat side) in pixels.
const hexWidthPx = (h3, res, zoom, lat) => Math.sqrt(3) * h3.getHexagonEdgeLengthAvg(res, 'm') / metersPerPixel(zoom, lat);

// The resolution whose hexagons are closest (on a log scale) to targetPx across at this zoom and
// latitude, so the same rule works for a city or a continent. zoomShift moves the zoom side (±½
// steps), bump moves the result by whole levels; min / max clamp it.
function hexAutoResolution(h3, zoom, lat, opts) {
    const o = opts || {}, target = o.targetPx || 32;
    let best = 0, d = Infinity;
    for (let r = 0; r <= 15; r++) { const e = Math.abs(Math.log(hexWidthPx(h3, r, zoom + (o.zoomShift || 0), lat) / target)); if (e < d) { d = e; best = r; } }
    return Math.max(o.min ?? 0, Math.min(o.max ?? 15, best + (o.bump || 0)));
}
// The zoom (before any zoomShift) where hexAutoResolution moves from base res to res + 1.
const hexSwitchZoom = (h3, res, lat, opts) => Math.log2((opts?.targetPx || 32) * metersPerPixel(0, lat)
    / Math.sqrt(3 * h3.getHexagonEdgeLengthAvg(res, 'm') * h3.getHexagonEdgeLengthAvg(res + 1, 'm')));

// Each point's cell at res ([lng, lat] in, cell id or null out).
const hexCellsForPoints = (h3, points, res) => points.map(p => p ? h3.latLngToCell(p[1], p[0], res) : null);

// Cells covering polygon features at res, each named for the feature covering most of it
// (counted on cells two levels finer, so slivers along edges are caught).
//   nameOf(feature)  the name to give (default its id); maxCells: return null if more than this
// Returns Map(cell → name), or null when it would be too many.
function hexCover(h3, features, res, opts) {
    const o = opts || {}, nameOf = o.nameOf || (f => String(f.id)), fine = Math.min(15, res + 2);
    const votes = new Map();
    for (const f of features) {
        const name = nameOf(f);
        for (const p of polysOf(f.geometry)) for (const fc of h3.polygonToCells(p, fine, true)) {
            const cell = fine === res ? fc : h3.cellToParent(fc, res);
            const v = votes.get(cell) || votes.set(cell, new Map()).get(cell);
            v.set(name, (v.get(name) || 0) + 1);
            if (o.maxCells && votes.size > o.maxCells) return null;
        }
    }
    return new Map([...votes].map(([cell, v]) => [cell, [...v].sort((a, b) => b[1] - a[1])[0][0]]));
}

// Short codes for a set of cells: each id without the digits they all share and without the
// trailing f's of unused finer levels (a fixed number per resolution, so codes are the same
// length): "8928308280fffff" → "#280". Returns Map(cell → code).
function hexShortCodes(h3, cells) {
    const ids = [...cells];
    let pre = ids[0]?.length || 0;
    for (const id of ids) { let k = 0; while (k < pre && id[k] === ids[0][k]) k++; pre = k; }
    return new Map(ids.map(id => {
        const tail = Math.floor(3 * (15 - h3.getResolution(id)) / 4);
        return [id, '#' + id.slice(Math.min(pre, id.length - tail - 1), id.length - tail)];
    }));
}
// A cell as a GeoJSON feature (id and properties.h3 = the cell).
const hexFeature = (h3, cell, props) => ({ type: 'Feature', id: cell, properties: { h3: cell, ...(props || {}) },
    geometry: { type: 'Polygon', coordinates: [h3.cellToBoundary(cell, true)] } });

function unionOf(bbs) {
    return bbs.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])],
        [Infinity, Infinity, -Infinity, -Infinity]);
}

// For each [lng, lat], the id of the first polygon feature containing it (or null).
function assignPointsToPolygons(points, features, opts) {
    return buildPolygonIndex(features, opts).locateAll(points);
}

return {
    VERSION,
    // values
    normVal, parseNum, isCurrencyVal, cellText, cellValues, makeKeyNormalizer, rowKeys,
    // columns
    CURRENCY_NAME_HINTS, FORCE_CAT_NAMES, FORCE_CAT_PARTIAL, isForcedCategorical, classifyColumns,
    // aggregation
    computeAgg, countValues, columnTotal,
    // joining
    buildFeatureIndex, buildPropIndex, buildJoin, detectDisplayName,
    PREFERRED_JOIN_FIELDS, scoreKeyCandidates, detectMultiRow,
    // filtering
    matchCondition, filterRows,
    // spatial
    pointInPolygon, assignPointsToPolygons, buildPolygonIndex,
    // 0.3: forgiving matching, classes, big tables, dissolve, hexbins
    looseKey, editDistance, makeLooseNormalizer, MULTI_DELIMITER, detectDelimiter, sampleRows,
    ckmeans, summaryStats, classBreaks,
    assignPointsToPolygonsChunked, buildJoinChunked,
    dissolve, dissolveGeometries,
    hex: { metersPerPixel, widthPx: hexWidthPx, autoResolution: hexAutoResolution, switchZoom: hexSwitchZoom,
        cellsForPoints: hexCellsForPoints, cover: hexCover, shortCodes: hexShortCodes, feature: hexFeature },
};
});
