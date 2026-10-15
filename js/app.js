// Joiner — join table rows to SF boundaries and map counts and totals per area.
// Data stays in the browser. Join logic: JoinKit (window.JoinKit).
(function () {
'use strict';

// Bump on every release and add a matching section to CHANGELOG.md.
const _BUILD_VERSION = 'v8';

const CONFIG = {
    manifest: 'data/boundaries/index.json',
    boundaries: 'data/boundaries/',
    style: 'https://api.protomaps.com/styles/v5/white/en.json?key=ffc24a4325d458ce',
    // Area palettes, light→dark, each paired with a row color that stands out against it.
    // Checked with the dataviz palette validator: lightness steps and the row/area pairing.
    palettes: {
        blues:  { label: 'Blues', ramp: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'], rows: '#E8590C' },
        ylorrd: { label: 'Yellow–red', ramp: ['#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#800026'], rows: '#1c5cab' },
    },
    nodata: '#F0EFEC',
    popupRows: 8,
    fonts: { bold: ['Noto Sans Medium'], regular: ['Noto Sans Regular'] },
    labelSizes: { small: { areas: 12, rows: 11 }, medium: { areas: 14, rows: 12.5 }, large: { areas: 16, rows: 14 } },
    streetsOverZoom: 14,       // streets draw above the areas from here in
    streetNamesZoom: 15,       // and are named from here in
    // Categorical colors for rows, in the validated order (dataviz reference palette).
    categorical: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
    other: '#8a8a85',
    // Label lines beyond the first two appear as you zoom in: the third one whole zoom
    // level in from the opening view, each further line one level after that. MapLibre
    // evaluates zoom steps in label text at whole tile zooms, so thresholds are integers.
    revealAfter: 1, revealStep: 1,
    prefixAfter: 2,            // default prefix zoom = opening zoom level + this
};

const $ = id => document.getElementById(id);
const pal = () => CONFIG.palettes[S.palette] || CONFIG.palettes.blues;
const ramp = () => pal().ramp;
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
    basemap: { roads: true, hoodLabels: true, points: true },
    palette: 'blues',
    labelSize: 'small',
    rowStyle: { colorBy: '', labels: [] },   // Format features: color rows by a column, label them with columns
    rowClasses: null,     // { type: 'numeric'|'category', colors, ranges|cats, classOf(row) }
    expanded: null,       // area id expanded in the list
    rowArea: [],          // row index → area id it was placed in (null = not placed), active layer
    areaOf: new Map(),    // layer id → row index → area id containing the row's location
    hoverId: null,
    selectedId: null,
};

let map, popup;

// ═════════════════════════════════════════════════════════════════════════
// Boot
// ═════════════════════════════════════════════════════════════════════════
async function boot() {
    console.log(`[joiner] ${_BUILD_VERSION}`);
    $('version').textContent = _BUILD_VERSION;
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
    S.palette = CONFIG.palettes[store.get('palette', 'blues')] ? store.get('palette', 'blues') : 'blues';
    S.labelSize = CONFIG.labelSizes[store.get('labelSize', 'small')] ? store.get('labelSize', 'small') : 'small';
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
    addMapLayers();
    applyBasemapToggles();   // after addMapLayers, so the street copies follow the Roads toggle too
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
const roadLayers = () => styleLayers().filter(l => l['source-layer'] === 'roads' || /^(over_)?roads_/.test(l.id)).map(l => l.id);
const hoodLabelLayers = () => styleLayers().filter(l => l.id === 'places_subplace').map(l => l.id);

// Always: no highway shields or one-way arrows, road labels for major streets only, and
// the creek fix shared with Block Party and Selecter.
function tidyBasemap() {
    for (const l of styleLayers()) {
        if (l.id === 'roads_shields' || l.id === 'roads_oneway') map.setLayoutProperty(l.id, 'visibility', 'none');
        if (l.id === 'roads_labels_major') map.setFilter(l.id, ['==', ['get', 'kind'], 'major_road']);
        if (l.id === 'roads_labels_major' || l.id === 'roads_labels_minor') map.setLayerZoomRange(l.id, CONFIG.streetNamesZoom, 24);
    }
    fixCreeks();
}

// Creek fix (same as Block Party and Selecter; apply to every map and after every setStyle).
// Protomaps/OSM tag many Bay Area creeks as kind:river, including culverted ones that are
// underground (layer -1), so they draw as rivers across the city. Hide streams entirely and
// rivers or labels with "Creek" or "Arroyo" in the name; kind alone isn't reliable.
function fixCreeks() {
    try {
        if (map.getLayer('water_stream')) map.setLayoutProperty('water_stream', 'visibility', 'none');
        if (map.getLayer('water_river')) map.setFilter('water_river', ['all',
            ['!', ['in', 'Creek', ['get', 'name']]], ['!', ['in', 'Arroyo', ['get', 'name']]]]);
        if (map.getLayer('water_waterway_label')) map.setFilter('water_waterway_label', ['all',
            ['!=', ['get', 'kind'], 'stream'], ['!', ['in', 'Creek', ['get', 'name']]], ['!', ['in', 'Arroyo', ['get', 'name']]]]);
    } catch (e) { console.warn('[creek filter]', e); }
}

// From streetsOverZoom in, copies of the basemap's street lines draw above the colored areas
// (and below the basemap's labels, so street names stay on top), so blocks read when zoomed in.
function addStreetsOverAreas(beforeId) {
    for (const l of styleLayers()) {
        if (l.type !== 'line' || l['source-layer'] !== 'roads') continue;
        const copy = JSON.parse(JSON.stringify(l));
        copy.id = 'over_' + l.id;
        copy.minzoom = Math.max(CONFIG.streetsOverZoom, l.minzoom || 0);
        map.addLayer(copy, beforeId);
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
    map.addLayer({ id: 'bounds-fill', type: 'fill', source: 'bounds', paint: { 'fill-color': CONFIG.nodata, 'fill-opacity': 0.85 } }, before);
    // Area outlines with a soft white glow so edges read against any fill.
    map.addLayer({ id: 'bounds-glow', type: 'line', source: 'bounds', paint: { 'line-color': '#ffffff', 'line-width': 3.5, 'line-blur': 2, 'line-opacity': 0.85 } }, before);
    map.addLayer({ id: 'bounds-line', type: 'line', source: 'bounds', paint: { 'line-color': '#1E2340', 'line-opacity': 0.5, 'line-width': 0.8 } }, before);
    map.addLayer({ id: 'bounds-hl', type: 'line', source: 'bounds', paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], '#6D4AF5', '#1E2340'],
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 3.5, ['boolean', ['feature-state', 'hover'], false], 2.5, 0],
    } });
    // Rows from the loaded file that carry geometry: polygons, lines, points.
    map.addSource('rows', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Placed rows are solid; rows not placed in any area are hollow (white fill, colored ring)
    // or dashed, so the difference doesn't rely on color alone.
    const isPoly = ['==', ['geometry-type'], 'Polygon'], isPt = ['==', ['geometry-type'], 'Point'];
    addStreetsOverAreas(before);
    map.addLayer({ id: 'rows-fill', type: 'fill', source: 'rows', filter: ['all', isPoly, ['get', '_in']], paint: { 'fill-opacity': 0.18 } });
    map.addLayer({ id: 'rows-line-glow', type: 'line', source: 'rows', filter: ['!', isPt], paint: { 'line-width': 6, 'line-blur': 2.5, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'rows-line', type: 'line', source: 'rows', filter: ['all', ['!', isPt], ['get', '_in']], paint: { 'line-width': 2, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'rows-line-out', type: 'line', source: 'rows', filter: ['all', ['!', isPt], ['!', ['get', '_in']]],
        paint: { 'line-width': 2, 'line-opacity': 0.9, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'rows-point', type: 'circle', source: 'rows', filter: isPt, paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 13, 4.5, 16, 7.5],
        'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 10, ['case', ['get', '_in'], 0.8, 1.8], 14, ['case', ['get', '_in'], 1.4, 2.2]],
        'circle-opacity': 1 } });
    applyPalette();
    // Area labels sit above the basemap's own labels.
    map.addLayer({ id: 'area-labels', type: 'symbol', source: 'labels', layout: {
        'text-field': '', 'text-font': CONFIG.fonts.regular, 'text-size': 12, 'text-line-height': 1.15,
        'text-max-width': 9, 'text-padding': 3, 'symbol-sort-key': ['get', '_rank'],
    }, paint: { 'text-color': '#1E2340', 'text-halo-color': 'rgba(255,255,255,0.92)', 'text-halo-width': 1.6 } });
    // Row labels from Format features, beside each row's point.
    map.addSource('rowlabels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'rows-labels', type: 'symbol', source: 'rowlabels', minzoom: 13, layout: {
        'text-field': ['get', '_lab'], 'text-font': CONFIG.fonts.regular, 'text-size': 11, 'text-anchor': 'left',
        'text-offset': [0.8, 0], 'text-justify': 'left', 'text-max-width': 12, 'text-padding': 2, 'text-optional': true,
    }, paint: { 'text-color': '#1E2340', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.4 } });
    applyLabelSize();

    // One handler for areas and rows: a row under the cursor wins over the area beneath it.
    const ROW_LAYERS = ['rows-point', 'rows-line', 'rows-line-out', 'rows-fill'];
    const hit = e => {
        const near = [[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]];
        const row = map.queryRenderedFeatures(near, { layers: ROW_LAYERS.filter(l => l !== 'rows-fill') })[0]
            || map.queryRenderedFeatures(e.point, { layers: ['rows-fill'] })[0];
        if (row) return { row: row.properties._i };
        const area = map.queryRenderedFeatures(e.point, { layers: ['bounds-fill'] })[0];
        return area ? { area: area.properties._jid } : {};
    };
    map.on('mousemove', e => {
        const h = hit(e);
        setHover(h.area ?? (h.row != null ? S.rowArea[h.row] ?? null : null));
        if (h.row != null) showRowTip(e.point, h.row);
        else if (h.area != null) showTip(e.point, h.area);
        else $('tip').hidden = true;
        map.getCanvas().style.cursor = h.row != null || h.area != null ? 'pointer' : '';
    });
    map.on('mouseout', () => { setHover(null); $('tip').hidden = true; });
    map.on('click', e => {
        const h = hit(e);
        if (h.row != null) { select(null); popup.setLngLat(e.lngLat).setHTML(rowPopupHTML(h.row)).addTo(map); }
        else if (h.area != null) select(h.area, { lngLat: e.lngLat });
    });
}

// Relative luminance, for choosing a white or dark glow around a color.
function luminance(hex) {
    const c = hex.replace('#', '').match(/../g).map(h => { const v = parseInt(h, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const glowFor = hex => luminance(hex) > 0.4 ? 'rgba(30,35,64,0.6)' : '#ffffff';

// The ramp used for rows colored by a number: the palette the areas aren't using.
const rowRamp = () => (S.palette === 'blues' ? CONFIG.palettes.ylorrd : CONFIG.palettes.blues).ramp;
// Categorical colors for rows, minus hues that would blend into the area palette.
const rowCategorical = () => CONFIG.categorical.filter(c => S.palette === 'blues' ? c !== '#2a78d6' : !['#eb6834', '#eda100', '#e34948'].includes(c));

function applyPalette() {
    const p = pal();
    map.setPaintProperty('bounds-fill', 'fill-color',
        ['match', ['coalesce', ['feature-state', 'c'], -1], ...p.ramp.flatMap((c, i) => [i, c]), CONFIG.nodata]);
    // Rows: one contrasting color, or one per class when colored by a column (property _k).
    const rc = S.rowClasses;
    const colors = rc ? rc.colors : [p.rows];
    // Class -1 (no value, or a category folded into Other) is gray.
    const pick = (vals, other) => rc ? ['match', ['get', '_k'], ...vals.flatMap((v, i) => [i, v]), other] : vals[0];
    const color = pick(colors, CONFIG.other), glow = pick(colors.map(glowFor), glowFor(CONFIG.other));
    map.setPaintProperty('rows-fill', 'fill-color', color);
    map.setPaintProperty('rows-line', 'line-color', color);
    map.setPaintProperty('rows-line-out', 'line-color', color);
    map.setPaintProperty('rows-line-glow', 'line-color', glow);
    map.setPaintProperty('rows-point', 'circle-color', ['case', ['get', '_in'], color, '#ffffff']);
    // Light colors (the pale ends of a ramp, yellow) get a dark ring instead of a white one.
    map.setPaintProperty('rows-point', 'circle-stroke-color', ['case', ['get', '_in'], glow, color]);
    document.documentElement.style.setProperty('--rows', p.rows);
}

// ═════════════════════════════════════════════════════════════════════════
// Tabs and layers
// ═════════════════════════════════════════════════════════════════════════
function renderTabs() {
    const active = S.layers.get(S.layerId)?.tab;
    $('tabs').innerHTML = S.tabs.map(t => {
        const sel = t.tab === active;
        if (t.layers.length < 2) return `<div class="tab" role="tab" tabindex="0" aria-selected="${sel}" data-tab="${esc(t.tab)}">${esc(t.tab)}</div>`;
        // A tab with several sets shows the chosen set's name and a ▾; the native select sits over it.
        const choice = S.layers.get(S.tabChoice[t.tab]);
        return `<div class="tab menu" role="tab" aria-selected="${sel}" data-tab="${esc(t.tab)}" title="${esc(t.tab)}: choose a set">
            <span>${esc(choice.short || shortLabel(choice))}</span><span class="tri" aria-hidden="true">▾</span>
            <select data-tab="${esc(t.tab)}" aria-label="${esc(t.tab)} set">${t.layers.map(l =>
                `<option value="${l.id}"${l.id === choice.id ? ' selected' : ''}>${esc(shortLabel(l))}</option>`).join('')}</select></div>`;
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
    S.selectedId = null; S.hoverId = null; S.expanded = null; popup.remove();
    map.removeFeatureState({ source: 'bounds' });
    map.getSource('bounds').setData(fc);
    $('list-title').textContent = shortLabel(meta);
    recompute();
}

// ═════════════════════════════════════════════════════════════════════════
// Joining
// ═════════════════════════════════════════════════════════════════════════
// "Match rows by" can be a column, or the row's own location when the file has geometry.
const LOCATION = '\u0000location';
const AREA_COL = '\u0000area';
const keyLabel = col => col === LOCATION ? 'Location (inside the area)' : col;

// One point per row for placing it in an area: the point itself, a line's middle vertex,
// or a spot well inside a polygon.
function repPoint(g) {
    if (!g) return null;
    switch (g.type) {
        case 'Point': return g.coordinates;
        case 'MultiPoint': return g.coordinates[0];
        case 'LineString': return g.coordinates[Math.floor(g.coordinates.length / 2)];
        case 'MultiLineString': { const l = g.coordinates[0]; return l[Math.floor(l.length / 2)]; }
        case 'Polygon': case 'MultiPolygon': return focusOf(g).anchor;
        default: return null;
    }
}

function areasForRows(layerId) {
    if (!S.areaOf.has(layerId)) {
        const pts = S.src.points;
        S.areaOf.set(layerId, JoinKit.assignPointsToPolygons(pts, S.geo.get(layerId).features, { idOf: f => f.id }));
    }
    return S.areaOf.get(layerId);
}
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
    const loc = [];
    if (S.src.points) {
        const areas = areasForRows(S.layerId);
        loc.push({ col: LOCATION, hits: areas.filter(a => a != null).length, filled: S.src.points.filter(Boolean).length });
    }
    // Location first on a tie: it doesn't depend on how names are spelled.
    return [...loc, ...S.src.headers.filter(c => !(S.src.geomCols || []).includes(c)).map(col => {
        let hits = 0, filled = 0;
        for (const row of S.src.rows) {
            const keys = JoinKit.rowKeys(row, col, normalize, delimiter);
            if (!keys.length) continue;
            filled++;
            if (keys.some(k => index.has(k))) hits++;
        }
        return { col, hits, filled };
    })].sort((a, b) => b.hits - a.hits || (a.col === LOCATION ? -1 : b.col === LOCATION ? 1 : a.col.localeCompare(b.col)));
}

function recompute() {
    const meta = S.layers.get(S.layerId);
    const fc = S.geo.get(S.layerId);
    S.join = null; S.values = new Map(); S.classes = null; S.unmatched = [];
    if (S.src && fc) {
        const normalize = normalizerFor(meta);
        S.candidates = keyCandidates(meta, fc, normalize);
        let keyCol = S.keyCols[S.layerId];
        if (!keyCol || !S.candidates.some(c => c.col === keyCol)) keyCol = S.candidates[0]?.hits ? S.candidates[0].col : null;
        S.rowArea = new Array(S.src.rows.length).fill(null);
        if (keyCol === LOCATION) {
            S.keyCols[S.layerId] = keyCol;
            const areas = areasForRows(S.layerId);
            const rows = S.src.rows.map((r, i) => ({ ...r, [AREA_COL]: areas[i] ?? '' }));
            S.rowIndex = new Map(rows.map((r, i) => [r, i]));
            S.join = JoinKit.buildJoin({ rows, headers: [...S.src.headers, AREA_COL], keyCol: AREA_COL, features: fc.features,
                propKey: '_jid', idOf: f => f.id });
            S.join.keyCol = keyCol;
            S.join.numericCols = S.join.numericCols.filter(c => !(S.src.geomCols || []).includes(c));
            areas.forEach((a, i) => { S.rowArea[i] = a; });
            const outside = S.src.points.filter((p, i) => p && areas[i] == null).length;
            S.unmatched = outside ? [{ label: 'Outside every area', n: outside }] : [];
            S.join.nullRows = S.src.points.filter(p => !p).length;
        } else if (keyCol) {
            S.keyCols[S.layerId] = keyCol;
            const delimiter = meta.match?.delimiter;
            S.join = JoinKit.buildJoin({ rows: S.src.rows, headers: S.src.headers, keyCol, features: fc.features,
                propKey: meta.key, normalize, delimiter, idOf: f => f.id });
            S.join.keyCol = keyCol;
            S.join.numericCols = S.join.numericCols.filter(c => !(S.src.geomCols || []).includes(c));
            const idx = S.rowIndex = new Map(S.src.rows.map((r, i) => [r, i]));
            for (const [id, e] of Object.entries(S.join.byId)) for (const r of e.rows) { const i = idx.get(r); if (i != null && S.rowArea[i] == null) S.rowArea[i] = id; }
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
        updateRowLayer();
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
        if (isIdColumn(col) || isCoordColumn(col)) continue;
        opts.push({ value: `sum_${col}`, label: `Total ${col}`, short: `total ${col}` },
                  { value: `avg_${col}`, label: `Average ${col}`, short: `avg ${col}` },
                  { value: `pct_${col}`, label: `% of total ${col}`, short: `% of ${col}` });
    }
    return opts;
}
// Record numbers (Airtable autonumber "Id", "Record ID", "project_id") are numeric but not amounts.
const isIdColumn = col => /^(_airtable_id|id|record ?id|row ?id|unique ?id)$|[\s_-](id|code)$/i.test(col.trim());
// Coordinates are numbers but never amounts.
const isCoordColumn = col => /^(lat|lng|lon|long|latitude|longitude|x|y|point_?[xy])$|[\s_-](lat|lng|lon|latitude|longitude)$/i.test(col.trim());
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
    const k = Math.min(ramp().length, new Set(sorted).size);
    const groups = ckmeans(sorted, k);
    const uppers = groups.map(g => g[g.length - 1]);
    const offset = ramp().length - k;   // few classes → use the darker end of the ramp
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

// The column that names a row: a name/title-like column, else the first mostly-unique text column.
function rowLabelCol() {
    if (S.src._labelCol) return S.src._labelCol;
    const h = S.src.headers.filter(c => !c.startsWith('_'));
    const named = h.find(c => /^(name|title|school|organization name|project|site|facility)$/i.test(c.trim()))
        || h.find(c => /(name|title)/i.test(c) && !/(e-?mail|user|file)/i.test(c));
    const texty = c => {
        const vals = S.src.rows.slice(0, 200).map(r => JoinKit.cellText(r[c]).trim()).filter(Boolean);
        return vals.length && vals.filter(v => isNaN(Number(v))).length / vals.length > 0.8 && new Set(vals).size / vals.length > 0.6;
    };
    return (S.src._labelCol = named || h.find(texty) || h[0]);
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

function extraValue(x, f, { short = true } = {}) {
    let v = f.properties[x.prop];
    if (v == null || v === '') return '';
    v = String(v).trim();
    if (x.values) v = x.values[v] ?? v;
    if (short && x.lastWord) v = v.split(/\s+/).pop();
    return x.template ? x.template.replace('{}', v) : v;
}
const extrasWith = flag => (S.layers.get(S.layerId).labelExtras || []).filter(x => x[flag]);

function labelText(field, f) {
    if (field.id === 'id') return labelIdOf(f);
    if (field.extra) return extraValue(field.extra, f);
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
    renderPaletteSeg();
    $('size-seg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.size === S.labelSize));
    renderFormatFeatures();
    updateZoomReadout();
}
// Format features: how rows from the file are drawn (shown only when the file has geometry).
function renderFormatFeatures() {
    const has = !!S.src?.geoms;
    $('fmt-card').hidden = !has;
    if (!has) return;
    $('points-check').checked = S.basemap.points;
    $('points-count').textContent = S.src.geoms.filter(Boolean).length.toLocaleString();
    const cols = S.src.headers.filter(h => !h.startsWith('_') && !(S.src.geomCols || []).includes(h));
    $('row-color').innerHTML = `<option value="">One color</option>` + cols.map(c => `<option value="${esc(c)}"${c === S.rowStyle.colorBy ? ' selected' : ''}>${esc(c)}</option>`).join('');
    const rc = S.rowClasses;
    $('row-color-hint').textContent = !rc ? 'Solid when placed in an area, hollow when not.'
        : rc.type === 'numeric' ? `A number: ${rc.colors.length} classes by natural breaks, on the ${S.palette === 'blues' ? 'yellow–red' : 'blue'} ramp so rows stand out from the areas.`
        : `${rc.cats.length} most common values${rc.otherN ? ', the rest as Other' : ''}.` + (rc.cats.length > 3 ? ' More than 3 colors can be hard to tell apart; hover names the value.' : '');
    const labs = S.rowStyle.labels;
    $('row-label-chips').innerHTML = cols.map(c => {
        const i = labs.indexOf(c);
        return `<button type="button" class="chip" data-col="${esc(c)}" title="${esc(c)}" aria-pressed="${i >= 0}">${i >= 0 ? `<b>${i + 1}</b>` : ''}<span>${esc(c)}</span></button>`;
    }).join('');
}

function renderPaletteSeg() {
    $('palette-seg').innerHTML = Object.entries(CONFIG.palettes).map(([k, p]) =>
        `<button type="button" data-palette="${k}" aria-pressed="${k === S.palette}" title="${esc(p.label)}"><i style="background:linear-gradient(90deg,${p.ramp.join(',')})"></i>${esc(p.label)}</button>`).join('');
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
        $('key-select').innerHTML = S.candidates.map(c => `<option value="${esc(c.col)}"${c.col === S.join?.keyCol ? ' selected' : ''}>${esc(keyLabel(c.col))}${c.hits ? ` — ${c.hits} of ${total} rows match` : ''}</option>`).join('')
            + (S.join ? '' : '<option value="" selected>— no column matches this layer —</option>');
        const meta = S.layers.get(S.layerId);
        $('key-hint').textContent = S.join?.keyCol === LOCATION
            ? `Each row is placed in the area that contains its location (${S.src.geomFrom}).`
            : `Compared with ${shortLabel(meta)} “${meta.key}”` + (meta.match?.delimiter ? `; cells with “${meta.match.delimiter}” count toward each value` : '') + '.';
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
                <span class="hint">${unmatchedRows ? (j.keyCol === LOCATION ? `${unmatchedRows} rows are outside every area` : `${unmatchedRows} rows have a value that matches no area`) : 'Every row placed'}${j.nullRows ? ` · ${j.nullRows} rows have ${j.keyCol === LOCATION ? 'no location' : 'a blank value'}` : ''}</span>`;
            const um = $('unmatched');
            um.hidden = !S.unmatched.length;
            um.querySelector('summary').textContent = S.join.keyCol === LOCATION ? `${S.unmatched[0]?.n || 0} rows outside every area`
                : `${S.unmatched.length} unmatched value${S.unmatched.length === 1 ? '' : 's'}`;
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
    const listExtras = extrasWith('list');
    const rows = fc.features.map(f => ({ id: f.id, name: String(nameOf(f)), v: S.values.get(f.id) ?? null,
        sub: listExtras.map(x => extraValue(x, f)).filter(Boolean).join(' · ') }));
    const max = Math.max(0, ...rows.map(r => r.v || 0));
    rows.sort(S.sort === 'name' || !showV ? (a, b) => a.name.localeCompare(b.name, 'en', { numeric: true })
        : (a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity) || a.name.localeCompare(b.name, 'en', { numeric: true }));
    $('area-list').innerHTML = rows.map(r => {
        const c = S.classes ? S.classes.classOf(r.v) : -1;
        const w = max > 0 && r.v > 0 ? Math.max(2, r.v / max * 100) : 0;
        const open = showV && r.id === S.expanded;
        return `<li data-id="${esc(r.id)}" class="${r.v ? '' : 'zero'}${r.id === S.selectedId ? ' selected' : ''}${open ? ' open' : ''}">
            <span class="nm">${showV ? `<span class="caret" aria-hidden="true">${open ? '▾' : '▸'}</span>` : ''}${esc(r.name)}${r.sub ? ` <small>${esc(r.sub)}</small>` : ''}</span><span class="v">${showV ? fmt(r.v) : ''}</span>
            ${showV ? `<span class="sw"><i style="width:${w}%;background:${c >= 0 ? ramp()[c] : 'transparent'}"></i></span>` : ''}
            ${open ? itemsHTML(r.id) : ''}</li>`;
    }).join('');
}

// The rows in one area, each with its own value for the statistic being mapped.
function itemsHTML(id) {
    const entry = S.join?.byId[id];
    if (!entry) return `<ul class="items"><li class="none">No rows here</li></ul>`;
    const col = S.metric.replace(/^(sum|avg|pct)_/, '');
    const perRow = S.metric !== 'count' && S.metric !== 'pct_count';
    const statOfRow = r => perRow ? JoinKit.parseNum(r[col]) : null;
    const items = entry.rows.map(r => ({ r, i: S.rowIndex?.get(r), v: statOfRow(r) }));
    if (perRow) items.sort((a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity));
    const MAX = 300;
    const title = it => it.i != null ? rowTitle(it.i) : JoinKit.cellText(it.r[rowLabelCol()]) || '(blank)';
    return `<ul class="items">${items.slice(0, MAX).map(it =>
        `<li data-row="${it.i ?? ''}" class="${it.i != null && S.src.points?.[it.i] ? 'has-loc' : ''}"><span>${esc(title(it))}</span>${perRow ? `<span class="iv">${it.v === null ? '—' : fmt(it.v, 'sum_' + col)}</span>` : ''}</li>`).join('')}
        ${items.length > MAX ? `<li class="none">and ${items.length - MAX} more</li>` : ''}</ul>`;
}

function renderLegend() {
    const lg = $('legend');
    if (!S.src || (!S.join && !S.rowClasses)) { lg.hidden = true; return; }
    if (!S.join) { lg.hidden = false; lg.innerHTML = rowLegendHTML(); return; }
    lg.hidden = false;
    const zeroLabel = S.metric.startsWith('avg_') ? 'No rows' : fmt(0);
    const nZero = [...S.values.values()].filter(v => !(v > 0)).length;
    lg.innerHTML = `<h4>${esc(metricLabel())}</h4>` + [...(S.classes?.ranges || [])].reverse().map(r =>
        `<div class="row"><i style="background:${ramp()[r.c]}"></i><span>${r.lo === r.hi ? fmt(r.hi) : `${fmt(r.lo)} – ${fmt(r.hi)}`}</span><span class="n">${r.n}</span></div>`).join('')
        + `<div class="row"><i style="background:${CONFIG.nodata}"></i><span>${zeroLabel}</span><span class="n">${nZero}</span></div>`
        + `<div class="foot">Natural breaks · areas per class</div>` + rowLegendHTML();
}

function rowLegendHTML() {
    const rc = S.rowClasses;
    if (!rc) return '';
    const dot = c => `<i class="dot" style="background:${c}"></i>`;
    const rows = rc.type === 'numeric'
        ? [...rc.ranges].reverse().map(r => `<div class="row">${dot(r.color)}<span>${r.lo === r.hi ? fmtNum(r.hi) : `${fmtNum(r.lo)} – ${fmtNum(r.hi)}`}</span><span class="n">${r.n}</span></div>`)
        : rc.cats.map(c => `<div class="row">${dot(c.color)}<span>${esc(c.v)}</span><span class="n">${c.n}</span></div>`)
            .concat(rc.otherN ? [`<div class="row">${dot(CONFIG.other)}<span>Other</span><span class="n">${rc.otherN}</span></div>`] : []);
    if (rc.none) rows.push(`<div class="row">${dot(CONFIG.other)}<span>No value</span><span class="n">${rc.none}</span></div>`);
    return `<h4 class="rows-h">Rows: ${esc(rc.col)}</h4>` + rows.join('');
}
const fmtNum = v => v.toLocaleString('en-US', { maximumFractionDigits: 1 });

function showTip(point, id) {
    const f = S.geo.get(S.layerId).features.find(f => f.id === id);
    if (!f) return;
    const tip = $('tip');
    const extras = extrasWith('hover').map(x => [x.label, extraValue(x, f, { short: false })]).filter(([, v]) => v);
    tip.innerHTML = `<b>${esc(nameOf(f))}</b>` + extras.map(([k, v]) => `<div>${esc(k)}: ${esc(v)}</div>`).join('')
        + (S.src && S.join ? `<div>${esc(metricLabel())}: ${fmt(S.values.get(id))}</div>` : '');
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

function select(id, { lngLat, fromPopup = false, fly = false, noPopup = false } = {}) {
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
    if (noPopup) popup.remove();
    else popup.setLngLat(lngLat || anchor).setHTML(popupHTML(f)).addTo(map);
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

// Classes for coloring rows by a column: natural breaks on the contrasting ramp for numbers,
// the most common values for categories (the rest fold into Other).
function computeRowClasses() {
    const col = S.rowStyle.colorBy;
    if (!S.src || !col || !S.src.headers.includes(col)) return null;
    const rows = S.src.rows;
    const { numericCols } = JoinKit.classifyColumns(rows, [col]);
    if (numericCols.length) {
        const vals = rows.map(r => JoinKit.parseNum(r[col]));
        const sorted = vals.filter(v => v !== null).sort((a, b) => a - b);
        if (!sorted.length) return null;
        const ramp = rowRamp(), k = Math.min(ramp.length, new Set(sorted).size);
        const groups = ckmeans(sorted, k), uppers = groups.map(g => g[g.length - 1]);
        const colors = ramp.slice(ramp.length - k);
        return { type: 'numeric', col, colors,
            ranges: groups.map((g, i) => ({ lo: g[0], hi: g[g.length - 1], n: g.length, color: colors[i] })),
            none: vals.filter(v => v === null).length,
            classOf: i => { const v = vals[i]; if (v === null) return -1; const j = uppers.findIndex(u => v <= u); return j < 0 ? k - 1 : j; } };
    }
    const cellOf = r => { const v = r[col]; return Array.isArray(v) ? JoinKit.cellText(v[0]) : JoinKit.cellText(v); };
    const counts = new Map();
    rows.forEach(r => { const v = cellOf(r).trim(); if (v) counts.set(v, (counts.get(v) || 0) + 1); });
    const order = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const pal = rowCategorical();
    const shown = order.length > pal.length ? order.slice(0, pal.length - 1) : order;   // leave a slot's worth for Other
    const idx = new Map(shown.map(([v], i) => [v, i]));
    const otherN = order.slice(shown.length).reduce((s, [, n]) => s + n, 0);
    return { type: 'category', col, colors: pal.slice(0, shown.length),
        cats: shown.map(([v, n], i) => ({ v, n, color: pal[i] })), otherN,
        none: rows.length - order.reduce((s, [, n]) => s + n, 0),
        classOf: i => { const v = cellOf(rows[i]).trim(); return idx.has(v) ? idx.get(v) : -1; } };
}

function updateRowLayer() {
    const src = map.getSource('rows');
    if (!src) return;
    const show = S.src?.geoms && S.basemap.points;
    S.rowClasses = show ? computeRowClasses() : null;
    const k = i => S.rowClasses ? S.rowClasses.classOf(i) : 0;
    src.setData({ type: 'FeatureCollection', features: !show ? [] : S.src.geoms.map((g, i) => g && {
        type: 'Feature', geometry: g, properties: { _i: i, _in: S.rowArea[i] != null, _k: k(i) } }).filter(Boolean) });
    const labs = show ? S.rowStyle.labels.filter(c => S.src.headers.includes(c)) : [];
    map.getSource('rowlabels').setData({ type: 'FeatureCollection', features: !labs.length ? [] : S.src.points.map((p, i) => {
        if (!p) return null;
        const text = labs.map(c => JoinKit.cellText(S.src.rows[i][c]).trim()).filter(Boolean).join('\n');
        return text && { type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { _lab: text } };
    }).filter(Boolean) });
    applyPalette();
    renderLegend();
}

function applyLabelSize() {
    const z = CONFIG.labelSizes[S.labelSize] || CONFIG.labelSizes.small;
    map.setLayoutProperty('area-labels', 'text-size', z.areas);
    map.setLayoutProperty('rows-labels', 'text-size', z.rows);
}

function rowTitle(i) {
    const r = S.src.rows[i], col = rowLabelCol();
    return JoinKit.cellText(r[col]) || `Row ${i + 1}`;
}
function areaName(id) {
    const f = id != null && S.geo.get(S.layerId).features.find(f => f.id === id);
    return f ? nameOf(f) : null;
}
function showRowTip(point, i) {
    const tip = $('tip'), a = areaName(S.rowArea[i]);
    tip.innerHTML = `<b>${esc(rowTitle(i))}</b><div>${a ? esc(a) : 'Not placed in an area'}</div>`;
    tip.style.left = point.x + 'px'; tip.style.top = point.y + 'px';
    tip.hidden = false;
}
function rowPopupHTML(i) {
    const r = S.src.rows[i], a = areaName(S.rowArea[i]);
    const fields = S.src.headers.filter(h => !h.startsWith('_') && JoinKit.cellText(r[h]) !== '').slice(0, 30);
    // Value first, field name under it (long names are cut short; the full name is in the tooltip).
    return `<div class="pop"><h4>${esc(rowTitle(i))}</h4><div class="sub">${a ? `In ${esc(a)}` : 'Not placed in an area'}</div>
        <dl class="fields">${fields.map(h => `<div><dd>${esc(JoinKit.cellText(r[h]))}</dd><dt title="${esc(h)}">${esc(h)}</dt></div>`).join('')}</dl></div>`;
}

function popupHTML(f) {
    let html = `<div class="pop"><h4>${esc(nameOf(f))}</h4>`;
    for (const x of extrasWith('hover')) { const v = extraValue(x, f, { short: false }); if (v) html += `<div class="sub">${esc(x.label)}: ${esc(v)}</div>`; }
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
        src.points = src.geoms ? src.geoms.map(repPoint) : null;
        S.src = src;
        S.areaOf = new Map();
        S.rowStyle = { colorBy: '', labels: [] }; S.expanded = null;
        S.keyCols = {}; S.metric = 'count';
        const st = src.settings;
        if (st) {
            Object.assign(S.keyCols, st.keyCols || {});
            if (st.metric) S.metric = st.metric;
            if (st.palette && CONFIG.palettes[st.palette]) { S.palette = st.palette; applyPalette(); }
            if (st.rowStyle) S.rowStyle = { colorBy: st.rowStyle.colorBy || '', labels: st.rowStyle.labels || [] };
            if (st.labelSize && CONFIG.labelSizes[st.labelSize]) { S.labelSize = st.labelSize; applyLabelSize(); }
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
    const snap = JoinerSources.makeSnapshot(S.src, { layerId: S.layerId, keyCols: S.keyCols, metric: S.metric, palette: S.palette, rowStyle: S.rowStyle, labelSize: S.labelSize,
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
    // Opening the menu on an inactive tab switches to that tab, even if the same set is picked again.
    $('tabs').addEventListener('mousedown', e => {
        const sel = e.target.closest('select');
        if (sel && S.layers.get(S.layerId).tab !== sel.dataset.tab) setLayer(S.tabChoice[sel.dataset.tab]);
    });

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
    $('palette-seg').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        S.palette = b.dataset.palette; store.set('palette', S.palette);
        updateRowLayer(); paint(); renderList(); renderPaletteSeg(); renderFormatFeatures();
    };
    $('points-check').onchange = e => { S.basemap.points = e.target.checked; store.set('basemap', S.basemap); updateRowLayer(); renderFormatFeatures(); };
    $('row-color').onchange = e => { S.rowStyle.colorBy = e.target.value; updateRowLayer(); renderFormatFeatures(); };
    $('row-label-chips').onclick = e => {
        const b = e.target.closest('.chip'); if (!b) return;
        const c = b.dataset.col, l = S.rowStyle.labels;
        S.rowStyle.labels = l.includes(c) ? l.filter(x => x !== c) : [...l, c];
        updateRowLayer(); renderFormatFeatures();
    };
    $('size-seg').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        S.labelSize = b.dataset.size; store.set('labelSize', S.labelSize);
        applyLabelSize(); renderLabelControls();
    };
    // Remember which panel cards are open.
    for (const id of ['fmt-card', 'labels-card']) {
        const el = $(id), open = store.get('open.' + id, null);
        if (open !== null) el.open = open;
        el.addEventListener('toggle', () => store.set('open.' + id, el.open));
    }

    const list = $('area-list');
    list.addEventListener('click', e => {
        // A row inside an expanded area: go to it on the map when it has a location.
        const item = e.target.closest('.items li[data-row]');
        if (item) {
            const i = +item.dataset.row;
            if (item.dataset.row !== '' && S.src.points?.[i]) {
                map.flyTo({ center: S.src.points[i], zoom: Math.max(map.getZoom(), 15.5), duration: 600 });
                popup.setLngLat(S.src.points[i]).setHTML(rowPopupHTML(i)).addTo(map);
            }
            return;
        }
        if (e.target.closest('.items')) return;
        const li = e.target.closest('li[data-id]'); if (!li) return;
        // Clicking an area expands it to list its rows (no popup); clicking again collapses it.
        const id = li.dataset.id;
        S.expanded = S.expanded === id ? null : id;
        select(id, { fly: true, noPopup: true });
        renderList();
        document.querySelector(`#area-list li[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
    });
    list.addEventListener('mouseover', e => { const li = e.target.closest('li[data-id]'); if (li) setHover(li.dataset.id); });
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

window.Joiner = { version: _BUILD_VERSION, state: S, loadFile, ckmeans, get map() { return map; } };   // for debugging in the console
boot().catch(e => { console.error(e); alert('Joiner failed to start: ' + e.message); });
})();
