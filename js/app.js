// Joiner — join table rows to SF boundaries and map counts and totals per area.
// Data stays in the browser. Join logic: JoinKit (window.JoinKit).
(function () {
'use strict';

const CONFIG = {
    manifest: 'data/boundaries/index.json',
    boundaries: 'data/boundaries/',
    style: 'https://api.protomaps.com/styles/v5/light/en.json?key=ffc24a4325d458ce',
    center: [-122.44, 37.76], zoom: 11.6,
    // Sequential ramp (one hue, light→dark), validated with the dataviz palette checker.
    ramp: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'],
    nodata: '#F0EFEC',
    popupRows: 8,
};

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const S = {
    manifest: null,       // index.json
    layers: new Map(),    // id → manifest entry
    tabs: [],             // [{ tab, layers: [entry] }]
    tabChoice: {},        // tab → layer id picked in that tab
    geo: new Map(),       // id → FeatureCollection (loaded on demand)
    layerId: null,
    src: null,            // { name, kind, headers, rows, loadedAt }
    keyCols: {},          // layer id → row column used as the join key (user choice)
    metric: 'count',
    sort: 'value',
    join: null,           // JoinKit.buildJoin result for the active layer
    candidates: [],       // key column candidates for the active layer
    unmatched: [],        // [{ label, n }]
    values: new Map(),    // feature id → metric value (null = no rows)
    classes: null,        // { breaks, colorOf(v) }
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

    map = new maplibregl.Map({ container: 'map', style: CONFIG.style, center: CONFIG.center, zoom: CONFIG.zoom, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px' });
    popup.on('close', () => select(null, { fromPopup: true }));
    await new Promise(r => map.on('load', r));
    addMapLayers();
    wireUI();
    await setLayer(first, { fit: true });
}

function firstSymbolLayer() {
    return map.getStyle().layers.find(l => l.type === 'symbol')?.id;
}

function addMapLayers() {
    map.addSource('bounds', { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, promoteId: '_jid' });
    const before = firstSymbolLayer();
    const colorExpr = ['match', ['coalesce', ['feature-state', 'c'], -1], ...CONFIG.ramp.flatMap((c, i) => [i, c]), CONFIG.nodata];
    map.addLayer({ id: 'bounds-fill', type: 'fill', source: 'bounds', paint: { 'fill-color': colorExpr, 'fill-opacity': 0.72 } }, before);
    map.addLayer({ id: 'bounds-line', type: 'line', source: 'bounds', paint: { 'line-color': '#1E2340', 'line-opacity': 0.45, 'line-width': 0.8 } }, before);
    map.addLayer({ id: 'bounds-hl', type: 'line', source: 'bounds', paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#6D4AF5', '#1E2340'],
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3.5, ['boolean', ['feature-state', 'hover'], false], 2.5, 0],
    } }, before);

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
    }
    return S.geo.get(id);
}

async function setLayer(id, { fit = true } = {}) {
    const meta = S.layers.get(id);
    S.layerId = id;
    S.tabChoice[meta.tab] = id;
    history.replaceState(null, '', '#layer=' + id);
    renderTabs();
    const fc = await loadGeo(id);
    S.selectedId = null; S.hoverId = null; popup.remove();
    map.removeFeatureState({ source: 'bounds' });
    map.getSource('bounds').setData(fc);
    if (fit && meta.bbox) map.fitBounds([[meta.bbox[0], meta.bbox[1]], [meta.bbox[2], meta.bbox[3]]], { padding: 30, duration: 600 });
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
        const metrics = metricOptions();
        if (!metrics.some(m => m.value === S.metric)) S.metric = 'count';
        for (const f of fc.features) {
            const agg = S.join?.byId[f.id]?.agg;
            const v = !agg ? null : S.metric === 'count' ? agg.count : agg[S.metric] ?? null;
            S.values.set(f.id, v);
        }
        S.classes = classify([...S.values.values()].filter(v => v !== null && v > 0));
    }
    paint();
    renderPanel();
}

function metricOptions() {
    const opts = [{ value: 'count', label: 'Number of rows' }];
    if (!S.join) return opts;
    for (const col of S.join.numericCols) {
        if (col === '_airtable_id') continue;
        opts.push({ value: `sum_${col}`, label: `Total ${col}` }, { value: `avg_${col}`, label: `Average ${col}` });
    }
    return opts;
}

// Up to five classes: the distinct values when there are few, otherwise quantile breaks.
function classify(vals) {
    if (!vals.length) return null;
    const sorted = [...vals].sort((a, b) => a - b);
    const uniq = [...new Set(sorted)];
    let uppers;
    if (uniq.length <= CONFIG.ramp.length) uppers = uniq;
    else {
        uppers = [];
        for (let i = 1; i <= CONFIG.ramp.length; i++) {
            const q = sorted[Math.min(sorted.length - 1, Math.ceil(i / CONFIG.ramp.length * sorted.length) - 1)];
            if (!uppers.length || q > uppers[uppers.length - 1]) uppers.push(q);
        }
    }
    const offset = CONFIG.ramp.length - uppers.length;   // few classes → use the darker end of the ramp
    const classOf = v => { if (v === null || !(v > 0)) return -1; const i = uppers.findIndex(u => v <= u); return (i < 0 ? uppers.length - 1 : i) + offset; };
    // Legend ranges show the smallest and largest value actually in each class, so they never overlap.
    const ranges = uppers.map((u, i) => {
        const inClass = sorted.filter(v => v <= u && (i === 0 || v > uppers[i - 1]));
        return { lo: inClass[0], hi: inClass[inClass.length - 1], c: i + offset };
    });
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
function fmt(v, metric = S.metric) {
    if (v === null || v === undefined) return '—';
    const col = metric.replace(/^(sum|avg)_/, '');
    const money = metric !== 'count' && S.join?.currencyCols.has(col);
    const digits = metric.startsWith('avg_') && !money ? 1 : 0;
    const n = v.toLocaleString('en-US', { maximumFractionDigits: digits, minimumFractionDigits: 0 });
    return money ? '$' + n : n;
}
const metricLabel = () => metricOptions().find(m => m.value === S.metric)?.label || 'Number of rows';
function nameOf(f) {
    const meta = S.layers.get(S.layerId);
    if (meta.nameTemplate) return meta.nameTemplate.replace(/\{(\w+)\}/g, (_, k) => f.properties[k] ?? '');
    return f.properties[meta.name] ?? f.id;
}

function rowLabelCol() {
    const h = S.src.headers;
    return h.find(c => /^(name|title)$/i.test(c)) || h.find(c => /(name|title)/i.test(c) && !/e-?mail/i.test(c)) || h[0];
}

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
    const rows = fc.features.map(f => ({ id: f.id, name: String(nameOf(f)), v: S.values.get(f.id) ?? null }));
    const max = Math.max(0, ...rows.map(r => r.v || 0));
    rows.sort(S.sort === 'name' || !S.src ? (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })
        : (a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity) || a.name.localeCompare(b.name, 'en', { numeric: true }));
    $('area-list').innerHTML = rows.map(r => {
        const c = S.classes ? S.classes.classOf(r.v) : -1;
        const w = max > 0 && r.v > 0 ? Math.max(2, r.v / max * 100) : 0;
        return `<li data-id="${esc(r.id)}" class="${r.v ? '' : 'zero'}${r.id === S.selectedId ? ' selected' : ''}">
            <span class="nm">${esc(r.name)}</span><span class="v">${S.src ? fmt(r.v) : ''}</span>
            ${S.src ? `<span class="sw"><i style="width:${w}%;background:${c >= 0 ? CONFIG.ramp[c] : 'transparent'}"></i></span>` : ''}</li>`;
    }).join('');
}

function renderLegend() {
    const lg = $('legend');
    if (!S.src || !S.classes) { lg.hidden = true; return; }
    lg.hidden = false;
    lg.innerHTML = `<h4>${esc(metricLabel())}</h4>` + [...S.classes.ranges].reverse().map(r =>
        `<div class="row"><i style="background:${CONFIG.ramp[r.c]}"></i>${r.lo === r.hi ? fmt(r.hi) : `${fmt(r.lo)} – ${fmt(r.hi)}`}</div>`).join('')
        + `<div class="row"><i style="background:${CONFIG.nodata}"></i>No rows</div>`;
}

function showTip(point, id) {
    const f = S.geo.get(S.layerId).features.find(f => f.id === id);
    if (!f) return;
    const tip = $('tip');
    tip.innerHTML = `<b>${esc(nameOf(f))}</b>${S.src ? `${esc(metricLabel())}: ${fmt(S.values.get(id))}` : ''}`;
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
    const { fit, anchor } = focusOf(f.geometry);
    if (fly) map.fitBounds([[fit[0], fit[1]], [fit[2], fit[3]]], { padding: 80, maxZoom: 15, duration: 500 });
    popup.setLngLat(lngLat || anchor).setHTML(popupHTML(f)).addTo(map);
}

// Where to zoom and where to pin the popup for an area. Small outlying parts (Treasure
// Island, the Farallones, rocks in the bay) are left out of the zoom, and the popup sits
// on a point inside the largest part rather than at a bbox center that may be in the water.
function focusOf(geom) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    const parts = polys.map(p => { const b = bbox({ coordinates: p[0] }); return { p, b, a: (b[2] - b[0]) * (b[3] - b[1]) }; })
        .sort((x, y) => y.a - x.a);
    const main = parts.filter(x => x.a >= parts[0].a * 0.1);
    const fit = main.reduce((u, x) => [Math.min(u[0], x.b[0]), Math.min(u[1], x.b[1]), Math.max(u[2], x.b[2]), Math.max(u[3], x.b[3])], [Infinity, Infinity, -Infinity, -Infinity]);
    const big = { type: 'Polygon', coordinates: parts[0].p }, b = parts[0].b;
    const cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    let anchor = [cx, cy];
    if (!JoinKit.pointInPolygon(anchor, big)) {
        let best = null;
        for (let i = 1; i < 12; i++) for (let j = 1; j < 12; j++) {
            const pt = [b[0] + (b[2] - b[0]) * i / 12, b[1] + (b[3] - b[1]) * j / 12];
            const d = (pt[0] - cx) ** 2 + (pt[1] - cy) ** 2;
            if (JoinKit.pointInPolygon(pt, big) && (!best || d < best.d)) best = { pt, d };
        }
        if (best) anchor = best.pt;
    }
    return { fit, anchor };
}

function popupHTML(f) {
    let html = `<div class="pop"><h4>${esc(nameOf(f))}</h4>`;
    if (!S.src) return html + '</div>';
    const entry = S.join?.byId[f.id];
    html += `<div class="big">${esc(metricLabel())}: <b>${fmt(S.values.get(f.id))}</b></div>`;
    if (!entry) return html + '<div class="more">No rows here.</div></div>';
    if (S.metric !== 'count') html += `<div>${entry.rows.length} row${entry.rows.length === 1 ? '' : 's'}</div>`;
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
            if (st.layerId && S.layers.has(st.layerId) && st.layerId !== S.layerId) { await setLayer(st.layerId); return; }
        }
        recompute();
    } catch (e) {
        alert(e.message);
        console.error(e);
    }
}

function saveSnapshot() {
    const snap = JoinerSources.makeSnapshot(S.src, { layerId: S.layerId, keyCols: S.keyCols, metric: S.metric });
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

window.Joiner = { state: S, loadFile };   // for debugging in the console
boot().catch(e => { console.error(e); alert('Joiner failed to start: ' + e.message); });
})();
