// Joiner — join table rows to SF boundaries and map counts and totals per area.
// Data stays in the browser. Join logic: JoinKit (window.JoinKit).
(function () {
'use strict';

const CONFIG = {
    manifest: 'data/boundaries/index.json',
    boundaries: 'data/boundaries/',
    style: 'https://api.protomaps.com/styles/v5/white/en.json?key=ffc24a4325d458ce',
    // Sequential ramp (one hue, light→dark), validated with the dataviz palette checker.
    ramp: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'],
    nodata: '#F0EFEC',
    popupRows: 8,
    fonts: { bold: ['Noto Sans Medium'], regular: ['Noto Sans Regular'] },
    // Label lines beyond the first two appear as you zoom in: the third one whole zoom
    // level in from the opening view, each further line one level after that. MapLibre
    // evaluates zoom steps in label text at whole tile zooms, so thresholds are integers.
    revealAfter: 1, revealStep: 1,
    prefixAfter: 2,            // default prefix zoom = opening zoom level + this
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = {
    get(k, d) { try { const v = localStorage.getItem('joiner.' + k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem('joiner.' + k, JSON.stringify(v)); } catch { /* private mode */ } },
};

const S = {
    manifest: null,       // index.json
    layers: new Map(),    // id → manifest entry
    tabs: [],             // [{ tab, layers: [entry] }]
    tabChoice: {},        // tab → layer id picked in that tab
    geo: new Map(),       // id → FeatureCollection (loaded on demand)
    anchors: new Map(),   // layer id → Map(feature id → { anchor, fit, area })
    layerId: null,
    src: null,            // { name, kind, headers, rows, loadedAt }
    keyCols: {},          // layer id → row column used as the join key (user choice)
    metric: 'count',
    sort: 'value',
    join: null,           // JoinKit.buildJoin result for the active layer
    candidates: [],       // key column candidates for the active layer
    unmatched: [],        // [{ label, n }]
    values: new Map(),    // feature id → metric value (null = not defined, e.g. an average of no rows)
    classes: null,        // { classOf(v), ranges }
    labels: null,         // ordered label field ids, or null = automatic (ID, color metric, layer defaults)
    allChips: false,      // show every statistic as a label choice, not just the main ones
    prefix: true,
    prefixZoom: null,     // set from the home zoom at boot
    homeZoom: 12,
    basemap: { roads: true, hoodLabels: true },
    hoverId: null,
    selectedId: null,
};

let map, popup;

// ═════════════════════════════════════════════════════════════════════════
// Boot
// ═════════════════════════════════════════════════════════════════════════
async function boot() {
    S.manifest = await (await fetch(CONFIG.manifest)).json();
    for (const l of S.manifest.layers) {
        S.layers.set(l.id, l);
        let t = S.tabs.find(t => t.tab === l.tab);
        if (!t) S.tabs.push(t = { tab: l.tab, layers: [] });
        t.layers.push(l);
    }
    for (const t of S.tabs) S.tabChoice[t.tab] = (t.layers.find(l => l.default) || t.layers[0]).id;
    const fromHash = new URLSearchParams(location.hash.slice(1)).get('layer');
    const first = S.layers.has(fromHash) ? fromHash : (S.manifest.layers.find(l => l.default) || S.manifest.layers[0]).id;
    S.tabChoice[S.layers.get(first).tab] = first;
    S.basemap = { ...S.basemap, ...store.get('basemap', {}) };
    const lab = store.get('labels', null);
    if (lab) { S.labels = lab.fields ?? null; S.prefix = lab.prefix ?? true; S.prefixZoom = lab.prefixZoom != null ? Math.round(lab.prefixZoom) : null; }

    // One view for every boundary set, so switching tabs never moves the map.
    const home = unionBbox(S.manifest.layers.map(l => l.bbox).filter(Boolean));
    map = new maplibregl.Map({ container: 'map', style: CONFIG.style, bounds: [[home[0], home[1]], [home[2], home[3]]],
        fitBoundsOptions: { padding: 24 }, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px' });
    popup.on('close', () => select(null, { fromPopup: true }));
    await new Promise(r => map.on('load', r));
    S.homeZoom = Math.floor(map.getZoom());
    if (S.prefixZoom == null) S.prefixZoom = S.homeZoom + CONFIG.prefixAfter;
    tidyBasemap();
    applyBasemapToggles();
    addMapLayers();
    wireUI();
    map.on('zoom', updateZoomReadout);
    await setLayer(first);
}

const unionBbox = bbs => bbs.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])],
    [Infinity, Infinity, -Infinity, -Infinity]);

function firstSymbolLayer() {
    return map.getStyle().layers.find(l => l.type === 'symbol')?.id;
}

// ═════════════════════════════════════════════════════════════════════════
// Basemap
// ═════════════════════════════════════════════════════════════════════════
const styleLayers = () => map.getStyle().layers;
const roadLayers = () => styleLayers().filter(l => l['source-layer'] === 'roads' || /^roads_/.test(l.id)).map(l => l.id);
const hoodLabelLayers = () => styleLayers().filter(l => l.id === 'places_subplace').map(l => l.id);

// Always: no highway shields or one-way arrows, and road labels for major streets only.
function tidyBasemap() {
    for (const l of styleLayers()) {
        if (l.id === 'roads_shields' || l.id === 'roads_oneway') map.setLayoutProperty(l.id, 'visibility', 'none');
        if (l.id === 'roads_labels_major') map.setFilter(l.id, ['==', ['get', 'kind'], 'major_road']);
    }
}

function applyBasemapToggles() {
    const vis = on => on ? 'visible' : 'none';
    for (const id of roadLayers()) if (id !== 'roads_shields' && id !== 'roads_oneway') map.setLayoutProperty(id, 'visibility', vis(S.basemap.roads));
    for (const id of hoodLabelLayers()) map.setLayoutProperty(id, 'visibility', vis(S.basemap.hoodLabels));
    store.set('basemap', S.basemap);
}

// ═════════════════════════════════════════════════════════════════════════
// Map layers
// ═════════════════════════════════════════════════════════════════════════
function addMapLayers() {
    map.addSource('bounds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: '_jid' });
    map.addSource('labels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const before = firstSymbolLayer();
    const colorExpr = ['match', ['coalesce', ['feature-state', 'c'], -1], ...CONFIG.ramp.flatMap((c, i) => [i, c]), CONFIG.nodata];
    map.addLayer({ id: 'bounds-fill', type: 'fill', source: 'bounds', paint: { 'fill-color': colorExpr, 'fill-opacity': 0.85 } }, before);
    map.addLayer({ id: 'bounds-line', type: 'line', source: 'bounds', paint: { 'line-color': '#1E2340', 'line-opacity': 0.45, 'line-width': 0.8 } }, before);
    map.addLayer({ id: 'bounds-hl', type: 'line', source: 'bounds', paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#6D4AF5', '#1E2340'],
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3.5, ['boolean', ['feature-state', 'hover'], false], 2.5, 0],
    } });
    // Area labels sit above the basemap's own labels.
    map.addLayer({ id: 'area-labels', type: 'symbol', source: 'labels', layout: {
        'text-field': '', 'text-font': CONFIG.fonts.regular, 'text-size': 12, 'text-line-height': 1.15,
        'text-max-width': 9, 'text-padding': 3, 'symbol-sort-key': ['get', '_rank'],
    }, paint: { 'text-color': '#1E2340', 'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 1.6 } });

    map.on('mousemove', 'bounds-fill', e => {
        const f = e.features[0]; if (!f) return;
        setHover(f.properties._jid);
        showTip(e.point, f.properties._jid);
        map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'bounds-fill', () => { setHover(null); $('tip').hidden = true; map.getCanvas().style.cursor = ''; });
    map.on('click', 'bounds-fill', e => { const f = e.features[0]; if (f) select(f.properties._jid, { lngLat: e.lngLat }); });
}

// ═════════════════════════════════════════════════════════════════════════
// Tabs and layers
// ═════════════════════════════════════════════════════════════════════════
function renderTabs() {
    const active = S.layers.get(S.layerId)?.tab;
    $('tabs').innerHTML = S.tabs.map(t => {
        const sel = t.tab === active;
        const inner = t.layers.length > 1
            ? `${esc(t.tab)}: <select data-tab="${esc(t.tab)}" aria-label="${esc(t.tab)} set">${t.layers.map(l =>
                `<option value="${l.id}"${l.id === S.tabChoice[t.tab] ? ' selected' : ''}>${esc(shortLabel(l))}</option>`).join('')}</select>`
            : esc(t.tab);
        return `<div class="tab" role="tab" tabindex="0" aria-selected="${sel}" data-tab="${esc(t.tab)}">${inner}</div>`;
    }).join('');
}
const shortLabel = l => l.label.replace(/\s*\(\d+\)$/, '');

async function loadGeo(id) {
    if (!S.geo.has(id)) {
        const fc = await (await fetch(CONFIG.boundaries + S.layers.get(id).file)).json();
        fc.features.forEach(f => { f.properties._jid = String(f.id); });
        S.geo.set(id, fc);
        const anchors = new Map();
        fc.features.forEach(f => anchors.set(f.id, focusOf(f.geometry)));
        S.anchors.set(id, anchors);
    }
    return S.geo.get(id);
}

async function setLayer(id) {
    const meta = S.layers.get(id);
    S.layerId = id;
    S.tabChoice[meta.tab] = id;
    history.replaceState(null, '', '#layer=' + id);
    renderTabs();
    const fc = await loadGeo(id);
    S.selectedId = null; S.hoverId = null; popup.remove();
    map.removeFeatureState({ source: 'bounds' });
    map.getSource('bounds').setData(fc);
    $('list-title').textContent = shortLabel(meta);
    recompute();
}

// ═════════════════════════════════════════════════════════════════════════
// Joining
// ═════════════════════════════════════════════════════════════════════════
function normalizerFor(meta) {
    const m = meta.match || {};
    return JoinKit.makeKeyNormalizer({
        stripPrefix: m.stripPrefix ? new RegExp(m.stripPrefix, 'i') : undefined,
        caseInsensitive: !!m.caseInsensitive, collapseSpace: !!m.collapseSpace,
    });
}

const rawValues = (row, col, delimiter) => {
    const v = row[col];
    return (Array.isArray(v) || delimiter) ? JoinKit.cellValues(v, delimiter).map(JoinKit.cellText) : [v];
};

// Every column scored by how many rows it would place on this layer.
function keyCandidates(meta, fc, normalize) {
    const index = JoinKit.buildFeatureIndex(fc.features, meta.key, { normalize, idOf: f => f.id });
    const delimiter = meta.match?.delimiter;
    return S.src.headers.map(col => {
        let hits = 0, filled = 0;
        for (const row of S.src.rows) {
            const keys = JoinKit.rowKeys(row, col, normalize, delimiter);
            if (!keys.length) continue;
            filled++;
            if (keys.some(k => index.has(k))) hits++;
        }
        return { col, hits, filled };
    }).sort((a, b) => b.hits - a.hits || a.col.localeCompare(b.col));
}

function recompute() {
    const meta = S.layers.get(S.layerId);
    const fc = S.geo.get(S.layerId);
    S.join = null; S.values = new Map(); S.classes = null; S.unmatched = [];
    if (S.src && fc) {
        const normalize = normalizerFor(meta);
        S.candidates = keyCandidates(meta, fc, normalize);
        let keyCol = S.keyCols[S.layerId];
        if (!keyCol || !S.src.headers.includes(keyCol)) keyCol = S.candidates[0]?.hits ? S.candidates[0].col : null;
        if (keyCol) {
            S.keyCols[S.layerId] = keyCol;
            const delimiter = meta.match?.delimiter;
            S.join = JoinKit.buildJoin({ rows: S.src.rows, headers: S.src.headers, keyCol, features: fc.features,
                propKey: meta.key, normalize, delimiter, idOf: f => f.id });
            S.join.keyCol = keyCol;
            // Unmatched values with row counts, labelled with the text as it appears in the data.
            const index = JoinKit.buildFeatureIndex(fc.features, meta.key, { normalize, idOf: f => f.id });
            const tally = new Map();
            for (const row of S.src.rows) for (const raw of rawValues(row, keyCol, delimiter)) {
                const k = normalize(raw);
                if (!k || index.has(k)) continue;
                const t = tally.get(k) || { label: String(JoinKit.cellText(raw)).trim(), n: 0 };
                t.n++; tally.set(k, t);
            }
            S.unmatched = [...tally.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
        }
        if (!metricOptions().some(m => m.value === S.metric)) S.metric = 'count';
        for (const f of fc.features) S.values.set(f.id, statFor(f.id, S.metric));
        S.classes = classify([...S.values.values()].filter(v => v !== null && v > 0));
    }
    paint();
    renderPanel();
    renderLabelControls();
    updateLabels();
}

// The value of one statistic for one area. Areas with no rows are 0 — except an
// average, which is undefined (null) when there is nothing to average.
function statFor(id, stat) {
    if (!S.join) return null;
    const agg = S.join.byId[id]?.agg;
    const total = S.src.rows.length;
    if (stat === 'count') return agg ? agg.count : 0;
    if (stat === 'pct_count') return agg && total ? agg.count / total * 100 : 0;
    if (stat.startsWith('avg_')) return agg ? agg[stat] ?? null : null;
    if (stat.startsWith('pct_')) return agg ? agg[stat] ?? 0 : 0;
    return agg ? agg[stat] ?? 0 : 0;
}

function metricOptions() {
    const opts = [{ value: 'count', label: 'Number of rows', short: 'rows' },
                  { value: 'pct_count', label: '% of all rows', short: '% of rows' }];
    if (!S.join) return opts.slice(0, 1);
    for (const col of S.join.numericCols) {
        if (isIdColumn(col)) continue;
        opts.push({ value: `sum_${col}`, label: `Total ${col}`, short: `total ${col}` },
                  { value: `avg_${col}`, label: `Average ${col}`, short: `avg ${col}` },
                  { value: `pct_${col}`, label: `% of total ${col}`, short: `% of ${col}` });
    }
    return opts;
}
// Record numbers (Airtable autonumber "Id", "Record ID", "project_id") are numeric but not amounts.
const isIdColumn = col => /^(_airtable_id|id|record ?id|row ?id|unique ?id)$|[\s_-]id$/i.test(col.trim());
const statLabel = s => metricOptions().find(m => m.value === s)?.label || s;
const metricLabel = () => statLabel(S.metric);

// Natural breaks (Ckmeans, Wang & Song 2011): classes are built around gaps in the values,
// so very different amounts don't share a color the way rank-based quantiles can force.
function ckmeans(sorted, k) {
    const n = sorted.length;
    const cost = Array.from({ length: k }, () => new Float64Array(n));
    const back = Array.from({ length: k }, () => new Int32Array(n));
    const sum = new Float64Array(n + 1), sq = new Float64Array(n + 1);
    for (let i = 0; i < n; i++) { sum[i + 1] = sum[i] + sorted[i]; sq[i + 1] = sq[i] + sorted[i] * sorted[i]; }
    const ssd = (j, i) => { const m = i - j + 1, s = sum[i + 1] - sum[j]; return sq[i + 1] - sq[j] - s * s / m; };
    for (let i = 0; i < n; i++) { cost[0][i] = ssd(0, i); back[0][i] = 0; }
    for (let c = 1; c < k; c++) for (let i = c; i < n; i++) {
        let best = Infinity, arg = c;
        for (let j = c; j <= i; j++) { const v = cost[c - 1][j - 1] + ssd(j, i); if (v < best) { best = v; arg = j; } }
        cost[c][i] = best; back[c][i] = arg;
    }
    const groups = []; let end = n - 1;
    for (let c = k - 1; c >= 0; c--) { const start = back[c][end]; groups.unshift(sorted.slice(start, end + 1)); end = start - 1; }
    return groups;
}

function classify(vals) {
    if (!vals.length) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    const k = Math.min(CONFIG.ramp.length, new Set(sorted).size);
    const groups = ckmeans(sorted, k);
    const uppers = groups.map(g => g[g.length - 1]);
    const offset = CONFIG.ramp.length - k;   // few classes → use the darker end of the ramp
    const classOf = v => { if (v === null || !(v > 0)) return -1; const i = uppers.findIndex(u => v <= u); return (i < 0 ? k - 1 : i) + offset; };
    const ranges = groups.map((g, i) => ({ lo: g[0], hi: g[g.length - 1], n: g.length, c: i + offset }));
    return { classOf, ranges };
}

function paint() {
    const fc = S.geo.get(S.layerId);
    if (!fc) return;
    for (const f of fc.features) {
        const c = S.classes ? S.classes.classOf(S.values.get(f.id)) : -1;
        map.setFeatureState({ source: 'bounds', id: f.id }, { c });
    }
    renderLegend();
}

// ═════════════════════════════════════════════════════════════════════════
// Formatting
// ═════════════════════════════════════════════════════════════════════════
const isMoney = stat => /^(sum|avg)_/.test(stat) && S.join?.currencyCols.has(stat.replace(/^(sum|avg)_/, ''));

function fmt(v, stat = S.metric) {
    if (v === null || v === undefined) return '—';
    if (stat.startsWith('pct_')) return (v === 0 ? '0' : v < 0.1 ? '<0.1' : v.toFixed(1)) + '%';
    const digits = stat.startsWith('avg_') && !isMoney(stat) ? 1 : 0;
    const n = v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    return isMoney(stat) ? '$' + n : n;
}

// Short form for map labels: $104K, $1.2M.
function fmtShort(v, stat) {
    if (v === null || v === undefined) return '—';
    if (stat.startsWith('pct_')) return fmt(v, stat);
    const money = isMoney(stat), a = Math.abs(v);
    let s;
    if (a >= 1e6) s = (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
    else if (a >= 1e4 || (money && a >= 1000)) s = (v / 1e3).toFixed(a >= 1e5 || !money ? 0 : 1).replace(/\.0$/, '') + 'K';
    else s = v.toLocaleString('en-US', { maximumFractionDigits: stat.startsWith('avg_') && !money ? 1 : 0 });
    return (money ? '$' : '') + s;
}

function nameOf(f, meta = S.layers.get(S.layerId)) {
    if (meta.nameTemplate) return fill(meta.nameTemplate, f.properties);
    return f.properties[meta.name] ?? f.id;
}
function labelIdOf(f, meta = S.layers.get(S.layerId)) {
    return meta.labelTemplate ? fill(meta.labelTemplate, f.properties) : String(nameOf(f, meta));
}
const fill = (tpl, props) => tpl.replace(/\{(\w+)\}/g, (_, k) => props[k] ?? '');

function rowLabelCol() {
    const h = S.src.headers;
    return h.find(c => /^(name|title)$/i.test(c)) || h.find(c => /(name|title)/i.test(c) && !/e-?mail/i.test(c)) || h[0];
}

// ═════════════════════════════════════════════════════════════════════════
// Map labels
// ═════════════════════════════════════════════════════════════════════════
// Fields: 'id', any statistic ('count', 'sum_X', …), or 'x:<id>' for a layer's labelExtras.
function labelFieldOptions() {
    const meta = S.layers.get(S.layerId);
    const opts = [{ id: 'id', label: meta.labelTemplate ? 'ID' : 'Name', prefix: '' }];
    if (S.src && S.join) for (const m of metricOptions()) opts.push({ id: m.value, label: m.label, prefix: m.short });
    for (const x of meta.labelExtras || []) opts.push({ id: 'x:' + x.id, label: x.label, prefix: x.label, extra: x });
    return opts;
}

function activeLabelFields() {
    const avail = new Map(labelFieldOptions().map(o => [o.id, o]));
    let ids;
    if (S.labels) ids = S.labels.filter(id => avail.has(id));
    else {
        const meta = S.layers.get(S.layerId);
        ids = ['id', ...(S.src && S.join ? [S.metric] : []), ...(meta.labelExtras || []).filter(x => x.default).map(x => 'x:' + x.id)];
    }
    return ids.map(id => avail.get(id)).filter(Boolean);
}

function labelText(field, f) {
    if (field.id === 'id') return labelIdOf(f);
    if (field.extra) {
        let v = f.properties[field.extra.prop];
        if (v == null || v === '') return '';
        v = String(v).trim();
        if (field.extra.lastWord) v = v.split(/\s+/).pop();
        return field.extra.template ? field.extra.template.replace('{}', v) : v;
    }
    return fmtShort(statFor(f.id, field.id), field.id);
}

// Zoom thresholds at which the label changes: extra lines appear, then prefixes.
function labelSteps(nLines) {
    const z = new Set();
    for (let i = 2; i < nLines; i++) z.add(S.homeZoom + CONFIG.revealAfter + (i - 2) * CONFIG.revealStep);
    if (S.prefix) z.add(S.prefixZoom);
    return [...z].sort((a, b) => a - b);
}
const visibleLines = (n, zoom) => n <= 2 ? n : 2 + [...Array(n - 2).keys()].filter(i => zoom >= S.homeZoom + CONFIG.revealAfter + i * CONFIG.revealStep - 1e-6).length;

function updateLabels() {
    const fc = S.geo.get(S.layerId);
    if (!fc || !map.getSource('labels')) return;
    const fields = activeLabelFields();
    const steps = labelSteps(fields.length);
    const zooms = [-Infinity, ...steps];
    const anchors = S.anchors.get(S.layerId);
    const ranked = [...fc.features].sort((a, b) => anchors.get(b.id).area - anchors.get(a.id).area);
    const rank = new Map(ranked.map((f, i) => [f.id, i]));
    const features = fc.features.map(f => {
        const texts = fields.map(fl => labelText(fl, f));
        const props = { _rank: rank.get(f.id) };
        zooms.forEach((z, k) => {
            const n = visibleLines(fields.length, z), pre = S.prefix && z >= S.prefixZoom - 1e-6;
            const lines = fields.slice(0, n).map((fl, i) => {
                const t = texts[i];
                if (!t) return '';
                return pre && fl.prefix ? `${fl.prefix}: ${t}` : t;
            });
            props['_h' + k] = lines[0] || '';
            props['_r' + k] = lines.slice(1).filter(Boolean).map(l => '\n' + l).join('');
        });
        return { type: 'Feature', geometry: { type: 'Point', coordinates: anchors.get(f.id).anchor }, properties: props };
    });
    map.getSource('labels').setData({ type: 'FeatureCollection', features });
    const fmtExpr = k => ['format', ['get', '_h' + k], { 'text-font': ['literal', CONFIG.fonts.bold], 'font-scale': 1.05 },
        ['get', '_r' + k], { 'font-scale': 0.92 }];
    const textField = fields.length === 0 ? '' : steps.length
        ? ['step', ['zoom'], fmtExpr(0), ...steps.flatMap((z, i) => [z, fmtExpr(i + 1)])]
        : fmtExpr(0);
    map.setLayoutProperty('area-labels', 'text-field', textField);
    // Prefixed lines are long; give them room instead of wrapping mid-phrase.
    map.setLayoutProperty('area-labels', 'text-max-width', S.prefix ? ['step', ['zoom'], 9, S.prefixZoom, 22] : 9);
}

function renderLabelControls() {
    const all = labelFieldOptions();
    const active = activeLabelFields().map(f => f.id);
    // Main choices: ID, row count and share, the color metric, layer extras, anything already on.
    const main = new Set(['id', 'count', 'pct_count', S.metric, ...active]);
    const opts = all.filter(o => S.allChips || main.has(o.id) || o.extra);
    const hidden = all.length - opts.length;
    $('label-chips').innerHTML = opts.map(o => {
        const i = active.indexOf(o.id);
        return `<button type="button" class="chip" data-field="${esc(o.id)}" aria-pressed="${i >= 0}">${i >= 0 ? `<b>${i + 1}</b>` : ''}${esc(o.label)}</button>`;
    }).join('') + (hidden ? `<button type="button" class="chip more" data-more="1">+ ${hidden} more</button>`
        : S.allChips ? `<button type="button" class="chip more" data-more="0">fewer</button>` : '');
    const n = active.length;
    const hints = [];
    for (let i = 2; i < n; i++) hints.push(`line ${i + 1} from zoom ${S.homeZoom + CONFIG.revealAfter + (i - 2) * CONFIG.revealStep}`);
    if (hints.length) hints[0] = hints[0][0].toUpperCase() + hints[0].slice(1);
    $('label-hint').textContent = hints.length ? hints.join(', ') + '.' : '';
    $('prefix-check').checked = S.prefix;
    $('prefix-zoom').value = S.prefixZoom;
    $('prefix-zoom').disabled = !S.prefix;
    $('prefix-zoom-val').textContent = S.prefixZoom;
    $('label-auto').hidden = !S.labels;
    $('roads-check').checked = S.basemap.roads;
    $('hoods-check').checked = S.basemap.hoodLabels;
    updateZoomReadout();
}
function updateZoomReadout() { const el = $('zoom-now'); if (el && map) el.textContent = map.getZoom().toFixed(1); }

function saveLabelPrefs() { store.set('labels', { fields: S.labels, prefix: S.prefix, prefixZoom: S.prefixZoom }); }

// ═════════════════════════════════════════════════════════════════════════
// Panel, legend, tooltip, popup
// ═════════════════════════════════════════════════════════════════════════
function renderPanel() {
    $('empty-card').hidden = !!S.src;
    $('join-card').hidden = !S.src;
    $('save-btn').disabled = !S.src;
    const chip = $('source-chip');
    chip.hidden = !S.src;
    if (S.src) chip.textContent = `${S.src.name} · ${S.src.rows.length.toLocaleString()} rows`;

    if (S.src) {
        const total = S.src.rows.length;
        $('key-select').innerHTML = S.candidates.map(c => `<option value="${esc(c.col)}"${c.col === S.join?.keyCol ? ' selected' : ''}>${esc(c.col)}${c.hits ? ` — ${c.hits} of ${total} rows match` : ''}</option>`).join('')
            + (S.join ? '' : '<option value="" selected>— no column matches this layer —</option>');
        const meta = S.layers.get(S.layerId);
        $('key-hint').textContent = `Compared with ${shortLabel(meta)} “${meta.key}”` + (meta.match?.delimiter ? `; cells with “${meta.match.delimiter}” count toward each value` : '') + '.';
        $('metric-select').innerHTML = metricOptions().map(m => `<option value="${esc(m.value)}"${m.value === S.metric ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
        $('metric-select').disabled = !S.join;
        $('metric-hint').textContent = S.metric.startsWith('pct_') ? `Share of the total across all ${total.toLocaleString()} rows, including rows that matched no area.` +
            (meta.match?.delimiter ? ' A row listed in two areas counts in both, so shares can add up to more than 100%.' : '') : '';

        if (S.join) {
            const j = S.join, unmatchedRows = total - j.matchedRows - j.nullRows;
            const pct = Math.round(j.matchedRows / total * 100);
            const areas = Object.keys(j.byId).length, nAreas = S.geo.get(S.layerId).features.length;
            $('match-summary').innerHTML = `<b>${j.matchedRows.toLocaleString()}</b> of ${total.toLocaleString()} rows placed (${pct}%) in <b>${areas}</b> of ${nAreas} areas
                <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
                <span class="hint">${unmatchedRows ? `${unmatchedRows} rows have a value that matches no area` : 'Every value matched'}${j.nullRows ? ` · ${j.nullRows} rows are blank` : ''}</span>`;
            const um = $('unmatched');
            um.hidden = !S.unmatched.length;
            um.querySelector('summary').textContent = `${S.unmatched.length} unmatched value${S.unmatched.length === 1 ? '' : 's'}`;
            um.querySelector('ul').innerHTML = S.unmatched.map(u => `<li><span>${esc(u.label)}</span><span>${u.n}</span></li>`).join('');
        } else {
            $('match-summary').innerHTML = `<span class="hint">No column in ${esc(S.src.name)} matches ${esc(shortLabel(S.layers.get(S.layerId)))}. Try another tab, or pick a column above.</span>`;
            $('unmatched').hidden = true;
        }
    }
    renderList();
}

function renderList() {
    const fc = S.geo.get(S.layerId);
    if (!fc) return;
    const showV = !!(S.src && S.join);
    const rows = fc.features.map(f => ({ id: f.id, name: String(nameOf(f)), v: S.values.get(f.id) ?? null }));
    const max = Math.max(0, ...rows.map(r => r.v || 0));
    rows.sort(S.sort === 'name' || !showV ? (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })
        : (a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity) || a.name.localeCompare(b.name, 'en', { numeric: true }));
    $('area-list').innerHTML = rows.map(r => {
        const c = S.classes ? S.classes.classOf(r.v) : -1;
        const w = max > 0 && r.v > 0 ? Math.max(2, r.v / max * 100) : 0;
        return `<li data-id="${esc(r.id)}" class="${r.v ? '' : 'zero'}${r.id === S.selectedId ? ' selected' : ''}">
            <span class="nm">${esc(r.name)}</span><span class="v">${showV ? fmt(r.v) : ''}</span>
            ${showV ? `<span class="sw"><i style="width:${w}%;background:${c >= 0 ? CONFIG.ramp[c] : 'transparent'}"></i></span>` : ''}</li>`;
    }).join('');
}

function renderLegend() {
    const lg = $('legend');
    if (!S.src || !S.join) { lg.hidden = true; return; }
    lg.hidden = false;
    const zeroLabel = S.metric.startsWith('avg_') ? 'No rows' : fmt(0);
    const nZero = [...S.values.values()].filter(v => !(v > 0)).length;
    lg.innerHTML = `<h4>${esc(metricLabel())}</h4>` + [...(S.classes?.ranges || [])].reverse().map(r =>
        `<div class="row"><i style="background:${CONFIG.ramp[r.c]}"></i><span>${r.lo === r.hi ? fmt(r.hi) : `${fmt(r.lo)} – ${fmt(r.hi)}`}</span><span class="n">${r.n}</span></div>`).join('')
        + `<div class="row"><i style="background:${CONFIG.nodata}"></i><span>${zeroLabel}</span><span class="n">${nZero}</span></div>`
        + `<div class="foot">Natural breaks · areas per class</div>`;
}

function showTip(point, id) {
    const f = S.geo.get(S.layerId).features.find(f => f.id === id);
    if (!f) return;
    const tip = $('tip');
    tip.innerHTML = `<b>${esc(nameOf(f))}</b>${S.src && S.join ? `${esc(metricLabel())}: ${fmt(S.values.get(id))}` : ''}`;
    tip.style.left = point.x + 'px'; tip.style.top = point.y + 'px';
    tip.hidden = false;
}

function setHover(id) {
    if (id === S.hoverId) return;
    if (S.hoverId !== null) map.setFeatureState({ source: 'bounds', id: S.hoverId }, { hover: false });
    S.hoverId = id;
    if (id !== null) map.setFeatureState({ source: 'bounds', id }, { hover: true });
    document.querySelectorAll('#area-list li.hover').forEach(li => li.classList.remove('hover'));
    if (id !== null) document.querySelector(`#area-list li[data-id="${CSS.escape(id)}"]`)?.classList.add('hover');
}

function select(id, { lngLat, fromPopup = false, fly = false } = {}) {
    if (S.selectedId !== null) map.setFeatureState({ source: 'bounds', id: S.selectedId }, { selected: false });
    S.selectedId = id;
    document.querySelectorAll('#area-list li.selected').forEach(li => li.classList.remove('selected'));
    if (id === null) { if (!fromPopup) popup.remove(); return; }
    map.setFeatureState({ source: 'bounds', id }, { selected: true });
    const li = document.querySelector(`#area-list li[data-id="${CSS.escape(id)}"]`);
    li?.classList.add('selected');
    if (!fly) li?.scrollIntoView({ block: 'nearest' });
    const f = S.geo.get(S.layerId).features.find(f => f.id === id);
    const { fit, anchor } = S.anchors.get(S.layerId).get(id);
    if (fly) map.fitBounds([[fit[0], fit[1]], [fit[2], fit[3]]], { padding: 80, maxZoom: 15, duration: 500 });
    popup.setLngLat(lngLat || anchor).setHTML(popupHTML(f)).addTo(map);
}

// Where to zoom, where to pin a popup or label, and how big an area is. Small outlying
// parts (Treasure Island, the Farallones, rocks in the bay) are left out of the zoom, and
// the anchor is a point inside the largest part rather than a bbox center in the water.
function focusOf(geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    const parts = polys.map(p => { const b = bbox({ coordinates: p[0] }); return { p, b, a: (b[2] - b[0]) * (b[3] - b[1]) }; })
        .sort((x, y) => y.a - x.a);
    const main = parts.filter(x => x.a >= parts[0].a * 0.1);
    const fit = unionBbox(main.map(x => x.b));
    const big = { type: 'Polygon', coordinates: parts[0].p }, b = parts[0].b;
    // Pole of inaccessibility, roughly: the grid point inside the polygon farthest from its edge.
    let anchor = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], bestD = -1;
    const ring = parts[0].p[0], N = 16;
    for (let i = 1; i < N; i++) for (let j = 1; j < N; j++) {
        const pt = [b[0] + (b[2] - b[0]) * i / N, b[1] + (b[3] - b[1]) * j / N];
        if (!JoinKit.pointInPolygon(pt, big)) continue;
        const d = distToRing(pt, ring);
        if (d > bestD) { bestD = d; anchor = pt; }
    }
    return { fit, anchor, area: parts.reduce((s, x) => s + x.a, 0) };
}

function distToRing([x, y], ring) {
    let m = Infinity;
    const k = Math.cos(y * Math.PI / 180);
    for (let i = 1; i < ring.length; i++) {
        const [x1, y1] = ring[i - 1], [x2, y2] = ring[i];
        const ax = (x2 - x1) * k, ay = y2 - y1, px = (x - x1) * k, py = y - y1;
        const t = Math.max(0, Math.min(1, (px * ax + py * ay) / (ax * ax + ay * ay || 1)));
        const dx = px - t * ax, dy = py - t * ay;
        m = Math.min(m, dx * dx + dy * dy);
    }
    return m;
}

function popupHTML(f) {
    let html = `<div class="pop"><h4>${esc(nameOf(f))}</h4>`;
    if (!S.src || !S.join) return html + '</div>';
    const entry = S.join.byId[f.id];
    html += `<div class="big">${esc(metricLabel())}: <b>${fmt(S.values.get(f.id))}</b></div>`;
    if (S.metric !== 'count') html += `<div>${entry ? entry.rows.length : 0} row${entry?.rows.length === 1 ? '' : 's'}</div>`;
    if (!entry) return html + '</div>';
    const col = rowLabelCol();
    const shown = entry.rows.slice(0, CONFIG.popupRows).map(r => `<li>${esc(JoinKit.cellText(r[col]) || '(blank)')}</li>`).join('');
    const more = entry.rows.length - CONFIG.popupRows;
    return html + `<ul>${shown}</ul>${more > 0 ? `<div class="more">and ${more} more</div>` : ''}</div>`;
}

function bbox(geom) {
    const b = [Infinity, Infinity, -Infinity, -Infinity];
    const walk = c => { if (typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0]); b[1] = Math.min(b[1], c[1]); b[2] = Math.max(b[2], c[0]); b[3] = Math.max(b[3], c[1]); } else c.forEach(walk); };
    walk(geom.coordinates);
    return b;
}

// ═════════════════════════════════════════════════════════════════════════
// Loading and saving data
// ═════════════════════════════════════════════════════════════════════════
async function loadFile(file) {
    try {
        const src = await JoinerSources.readFile(file);
        S.src = src;
        S.keyCols = {}; S.metric = 'count';
        const st = src.settings;
        if (st) {
            Object.assign(S.keyCols, st.keyCols || {});
            if (st.metric) S.metric = st.metric;
            if (st.labels) { S.labels = st.labels.fields ?? null; S.prefix = st.labels.prefix ?? S.prefix; S.prefixZoom = st.labels.prefixZoom ?? S.prefixZoom; }
            if (st.layerId && S.layers.has(st.layerId) && st.layerId !== S.layerId) { await setLayer(st.layerId); return; }
        }
        recompute();
    } catch (e) {
        alert(e.message);
        console.error(e);
    }
}

function saveSnapshot() {
    const snap = JoinerSources.makeSnapshot(S.src, { layerId: S.layerId, keyCols: S.keyCols, metric: S.metric,
        labels: { fields: S.labels, prefix: S.prefix, prefixZoom: S.prefixZoom } });
    const blob = new Blob([JSON.stringify(snap)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = S.src.name.replace(/(-joiner-snapshot)?\.(csv|tsv|txt|json|geojson)$/i, '') + '-joiner-snapshot.json';
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ═════════════════════════════════════════════════════════════════════════
// Events
// ═════════════════════════════════════════════════════════════════════════
function wireUI() {
    $('tabs').addEventListener('click', e => {
        if (e.target.closest('select')) return;
        const tab = e.target.closest('.tab')?.dataset.tab;
        if (tab && S.layers.get(S.layerId).tab !== tab) setLayer(S.tabChoice[tab]);
    });
    $('tabs').addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('tab')) { e.preventDefault(); e.target.click(); }
    });
    $('tabs').addEventListener('change', e => { if (e.target.matches('select')) setLayer(e.target.value); });

    $('load-btn').onclick = $('empty-load').onclick = () => $('file-input').click();
    $('file-input').onchange = e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; };
    $('save-btn').onclick = saveSnapshot;

    $('key-select').onchange = e => { if (e.target.value) { S.keyCols[S.layerId] = e.target.value; recompute(); } };
    $('metric-select').onchange = e => { S.metric = e.target.value; recompute(); };
    $('sort-seg').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        S.sort = b.dataset.sort;
        $('sort-seg').querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', x === b));
        renderList();
    };

    // Labels: click a field to add it as the next line, click again to remove it.
    $('label-chips').onclick = e => {
        const b = e.target.closest('.chip'); if (!b) return;
        if (b.dataset.more) { S.allChips = b.dataset.more === '1'; renderLabelControls(); return; }
        const cur = activeLabelFields().map(f => f.id);
        const id = b.dataset.field;
        S.labels = cur.includes(id) ? cur.filter(x => x !== id) : [...cur, id];
        saveLabelPrefs(); renderLabelControls(); updateLabels();
    };
    $('label-auto').onclick = () => { S.labels = null; saveLabelPrefs(); renderLabelControls(); updateLabels(); };
    $('prefix-check').onchange = e => { S.prefix = e.target.checked; saveLabelPrefs(); renderLabelControls(); updateLabels(); };
    $('prefix-zoom').oninput = e => { S.prefixZoom = +e.target.value; $('prefix-zoom-val').textContent = S.prefixZoom; };
    $('prefix-zoom').onchange = () => { saveLabelPrefs(); updateLabels(); };
    $('roads-check').onchange = e => { S.basemap.roads = e.target.checked; applyBasemapToggles(); };
    $('hoods-check').onchange = e => { S.basemap.hoodLabels = e.target.checked; applyBasemapToggles(); };

    const list = $('area-list');
    list.addEventListener('click', e => { const li = e.target.closest('li'); if (li) select(li.dataset.id, { fly: true }); });
    list.addEventListener('mouseover', e => { const li = e.target.closest('li'); if (li) setHover(li.dataset.id); });
    list.addEventListener('mouseleave', () => setHover(null));

    let depth = 0;
    const hasFiles = e => [...(e.dataTransfer?.types || [])].includes('Files');
    window.addEventListener('dragenter', e => { if (!hasFiles(e)) return; e.preventDefault(); depth++; $('drop').hidden = false; });
    window.addEventListener('dragover', e => { if (hasFiles(e)) e.preventDefault(); });
    window.addEventListener('dragleave', () => { if (--depth <= 0) { depth = 0; $('drop').hidden = true; } });
    window.addEventListener('drop', e => {
        if (!hasFiles(e)) return;
        e.preventDefault(); depth = 0; $('drop').hidden = true;
        const f = e.dataTransfer.files[0]; if (f) loadFile(f);
    });
    window.addEventListener('hashchange', () => {
        const id = new URLSearchParams(location.hash.slice(1)).get('layer');
        if (S.layers.has(id) && id !== S.layerId) setLayer(id);
    });
}

window.Joiner = { state: S, loadFile, ckmeans, get map() { return map; } };   // for debugging in the console
boot().catch(e => { console.error(e); alert('Joiner failed to start: ' + e.message); });
})();
