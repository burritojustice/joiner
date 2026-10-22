// Joiner — join table rows to SF boundaries and map counts and totals per area.
// Data stays in the browser. Join logic: JoinKit (window.JoinKit).
(function () {
'use strict';

// Bump on every release and add a matching section to CHANGELOG.md.
const _BUILD_VERSION = 'v30';

const CONFIG = {
    manifest: 'data/boundaries/index.json',
    boundaries: 'data/boundaries/',
    style: 'https://api.protomaps.com/styles/v5/white/en.json?key=ffc24a4325d458ce',
    // Area palettes, light→dark, each paired with a row color that stands out against it.
    // Checked with the dataviz palette validator: lightness steps and the row/area pairing.
    palettes: {
        blues:  { label: 'Blues', ramp: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'], rows: '#E8590C' },
        ylorrd: { label: 'Yellow–red', ramp: ['#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#800026'], rows: '#1c5cab' },
        // Diverging, low → high: ColorBrewer RdYlBu (5 classes), reversed so blue is low and red high.
        // With it, features are green (Greens when colored by a number) and the selected area purple.
        rdylbu: { label: 'Blue–yellow–red', ramp: ['#2c7bb6', '#abd9e9', '#ffffbf', '#fdae61', '#d7191c'], rows: '#1a9850', pick: '#7B3294', pickWash: '#F1E6F7' },
    },
    nodata: '#F0EFEC',         // 0 / no value in the list and legend; on the map those areas are left clear
    // Area and row label colors: text, halo, halo width. Auto picks black or white per area.
    // Area and row label colors: text, halo, halo width. Auto picks black or white per area.
    // Grouped in pairs that swap text and glow (click a chosen pair again to swap).
    labelColors: {
        black:         { label: 'Black',              text: '#1E2340', halo: 'rgba(255,255,255,0.92)', width: 2.5, pair: 'bw' },
        white:         { label: 'White',              text: '#ffffff', halo: 'rgba(10,22,56,0.6)', width: 1.2, pair: 'bw' },
        'navy-yellow': { label: 'Navy on yellow',     text: '#0D1B3E', halo: '#FFE27A', width: 1.6, pair: 'ny' },
        'yellow-navy': { label: 'Yellow on navy',     text: '#FFE27A', halo: '#0D1B3E', width: 1.4, pair: 'ny' },
        'navy-blue':   { label: 'Navy on light blue', text: '#0D1B3E', halo: '#CFE8FF', width: 1.6, pair: 'nb' },
        'blue-navy':   { label: 'Light blue on navy', text: '#CFE8FF', halo: '#0D1B3E', width: 1.4, pair: 'nb' },
        'white-red':   { label: 'White on deep red',  text: '#ffffff', halo: '#6B0020', width: 1.4, pair: 'wr' },
        'red-white':   { label: 'Deep red on white',  text: '#6B0020', halo: 'rgba(255,255,255,0.95)', width: 2.2, pair: 'wr' },
    },
    labelPairs: { bw: 'Black · white', ny: 'Navy · yellow', nb: 'Navy · lt blue', wr: 'White · red' },
    // Basemap street names: one of the label colors, the same on every palette (navy on light blue to start).
    streetColor: 'navy-blue',
    popupRows: 8,
    fonts: { bold: ['Noto Sans Medium'], regular: ['Noto Sans Regular'] },
    labelSizes: { small: { areas: 12, rows: 11 }, medium: { areas: 14, rows: 12.5 }, large: { areas: 16, rows: 14 } },
    // Point radius at zoom 10 / 13 / 16 for the "small" size; other sizes scale it.
    pointRadius: [3, 4.5, 7.5],
    // Pinpoint: a hint of where rows are, without outlines.
    pointSizes: { pinpoint: 0.4, tiny: 0.6, small: 1, medium: 1.45, big: 2, huge: 2.8 },
    // How points are drawn (from Selecter). Fill: solid with a ring that contrasts with its color.
    pointStyles: { fill: 'Fill', ring: 'Ring', ghost: 'Ghost', black: 'Black outline', white: 'White outline', bw: 'Black & white',
        // Click Ring or Ghost again for a white version: bright on dark bin colors.
        'ring-w': 'White ring', 'ghost-w': 'White ghost' },
    // "Smaller where crowded": points shrink as more of them are in view (visible rows → size factor).
    crowd: [[80, 1], [300, 0.85], [1200, 0.7], [5000, 0.55], [15000, 0.42], [Infinity, 0.32]],
    // Big files: pinpoints from bigFile.look rows with a location; features hidden from bigFile.hide.
    bigFile: { look: 2000, hide: 50000 },
    // The same control sets line widths, on a gentler scale (a 2.8× street would hide its block).
    lineSizes: { pinpoint: 0.4, tiny: 0.6, small: 1, medium: 1.3, big: 1.65, huge: 2.1 },
    linesFromZoom: 12,         // lines from the file draw from here in; zoomed out, a dot at each line's midpoint
    highlight: '#00A862',     // the selected area: green, apart from the blue, yellow–red and blue–red ramps
    // Auto picks the resolution whose hexagons are closest to this many pixels across at the map's zoom
    // and latitude, so it works the same for a city, a region or the world. 32 matches the old SF steps.
    hexTargetPx: 32,
    hexRange: [0, 12],
    hexZoomShift: [-2, 2],     // the ½ buttons shift the zoom side by up to this much
    hexCoverMax: 40000,        // most empty hexagons drawn to cover the naming areas
    hexBump: [-3, 3],          // the − / + buttons shift Auto by up to this many steps
    // Streets draw above the areas: major roads and highways from streetsMajorZoom, every street
    // from streetsOverZoom; all are named from streetNamesZoom.
    streetsMajorZoom: 13,
    streetsOverZoom: 14,
    streetNamesZoom: 14,
    streetHintWidth: 0.5, streetHintOpacity: 0.8,   // street copies over the areas: share of the basemap's width
    hover: { fill: '#FFC53D', ring: '#1E2340' },   // hovered rows: Civic Joy sun yellow, ink ring
    // Categorical colors for rows, in the validated order (dataviz reference palette).
    categorical: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'],
    other: '#8a8a85',
    // Label lines beyond the first two appear as you zoom in: the third one whole zoom
    // level in from the opening view, each further line one level after that. MapLibre
    // evaluates zoom steps in label text at whole tile zooms, so thresholds are integers.
    revealAfter: 0, revealStep: 1,
    prefixAfter: 2,            // default prefix zoom = opening zoom level + this
};

const $ = id => document.getElementById(id);
const pal = () => CONFIG.palettes[S.palette] || CONFIG.palettes.blues;
// v16's Blue–red ('rdbu') became Blue–yellow–red in v17.
const palKey = k => { k = k === 'rdbu' ? 'rdylbu' : k; return CONFIG.palettes[k] ? k : 'blues'; };
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
    keyCols: {},          // layer id → row column used as the join key (user choice), or LOCATION
    colKeys: {},          // layer id → column shown in the Match rows by menu
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
    basemap: { roads: true, places: false, points: true },
    palette: 'blues',
    labelSize: 'auto',    // 'auto' (by the size of the areas) | 'small' | 'medium' | 'large'
    revealAll: false,     // show every label line at once instead of adding them as you zoom in
    labelColor: 'auto',   // 'auto' or a key of CONFIG.labelColors
    rowStyle: { colorBy: '', labels: [], sizeBy: '', sizeLog: false },   // Format features: color rows by a column, label them with columns
    rowClasses: null,     // { type: 'numeric'|'category', colors, ranges|cats, classOf(row) }
    expanded: null,       // area id expanded in the list
    rowArea: [],          // row index → area id it was placed in (null = not placed), active layer
    areaOf: new Map(),    // layer id → row index → area id containing the row's location
    hoverId: null,
    selectedId: null,
    showAreas: true,
    hideEmpty: false,     // leave areas no row was placed in off the map      // draw the joining polygons (off = features only)
    pointSize: 'small',
    areaOrder: 'auto',    // areas over or under the basemap's water and roads: 'auto' | 'over' | 'under'
    hex: { auto: true, res: 8 },   // H3 layer: resolution follows the zoom, or a fixed one
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
    // H3 hexagons: a generated layer over SF's land, at a resolution that follows the zoom or a fixed one.
    const hexMeta = { id: 'h3', tab: 'H3 hexbins', label: 'H3 hexagons', short: 'H3 hexbins', key: 'h3', name: 'name', hex: true, match: {} };
    if (window.h3) { S.layers.set('h3', hexMeta); S.tabs.push({ tab: hexMeta.tab, layers: [hexMeta] }); }
    // Other: layers with tab "Other" in the config, plus polygon files uploaded here. Always last.
    const other = S.tabs.find(t => t.tab === OTHER) || { tab: OTHER, layers: [] };
    S.tabs = [...S.tabs.filter(t => t !== other), other];
    for (const t of S.tabs) S.tabChoice[t.tab] = (t.layers.find(l => l.default) || t.layers[0])?.id;
    const fromHash = new URLSearchParams(location.hash.slice(1)).get('layer');
    const first = S.layers.has(fromHash) ? fromHash : (S.manifest.layers.find(l => l.default) || S.manifest.layers[0]).id;
    S.tabChoice[S.layers.get(first).tab] = first;
    S.basemap = { ...S.basemap, ...store.get('basemap', {}) };
    S.palette = palKey(store.get('palette', 'blues'));
    S.streetColor = store.get('streetColor', CONFIG.streetColor); if (!CONFIG.labelColors[S.streetColor]) S.streetColor = CONFIG.streetColor;
    S.labelColor = store.get('labelColor', 'auto'); if (S.labelColor !== 'auto' && !CONFIG.labelColors[S.labelColor]) S.labelColor = 'auto';
    // Label size: Small to start (Dynamic sizes labels by the area's size, which can read as bigger values).
    { const ls = store.get('labelSize3', 'small'); S.labelSize = ls === 'auto' || CONFIG.labelSizes[ls] ? ls : 'small'; }
    S.classMethod = ['jenks', 'equal', 'quantile'].includes(store.get('classMethod')) ? store.get('classMethod') : 'jenks';
    S.classLog = store.get('classLog', false);
    S.outline = { color: 'auto', width: 'thin', ...store.get('outline', {}) };
    S.revealAll = !!store.get('revealAll', false);
    S.showAreas = store.get('showAreas', true);
    S.legendCompact = store.get('legendCompact', false);
    S.hideEmpty = !!store.get('hideEmpty', false);
    S.areaOrder = ['auto', 'over', 'under'].includes(store.get('areaOrder', 'auto')) ? store.get('areaOrder', 'auto') : 'auto';
    S.pointSize = CONFIG.pointSizes[store.get('pointSize', 'small')] ? store.get('pointSize', 'small') : 'small';
    // Hexagons are small, so rows default to tiny there; each mode keeps its own size.
    S.hexPointSize = CONFIG.pointSizes[store.get('hexPointSize', 'tiny')] ? store.get('hexPointSize', 'tiny') : 'tiny';
    S.pointStyle = CONFIG.pointStyles[store.get('pointStyle', 'fill')] ? store.get('pointStyle', 'fill') : 'fill';
    S.crowd = store.get('crowd', true); S.crowdK = 1;
    S.hex = { ...S.hex, ...store.get('hex', {}) };
    const lab = store.get('labels', null);
    if (lab) { S.labels = lab.fields ?? null; S.prefix = lab.prefix ?? true; S.prefixZoom = lab.prefixZoom != null ? Math.round(lab.prefixZoom) : null; }

    // One view for every boundary set, so switching tabs never moves the map.
    const home = unionBbox(S.manifest.layers.filter(l => !l.regional).map(l => l.bbox).filter(Boolean));
    map = new maplibregl.Map({ container: 'map', style: CONFIG.style, bounds: [[home[0], home[1]], [home[2], home[3]]],
        fitBoundsOptions: { padding: 24 }, attributionControl: { compact: true } });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    popup = new maplibregl.Popup({ closeButton: true, maxWidth: '320px' });
    // Popups now only show a feature's fields; closing one leaves the selected area alone.
    await new Promise(r => map.on('load', r));
    S.homeZoom = Math.floor(map.getZoom());
    if (S.prefixZoom == null) S.prefixZoom = S.homeZoom + CONFIG.prefixAfter;
    tidyBasemap();
    addMapLayers();
    applyBasemapToggles();   // after addMapLayers, so the street copies follow the Roads toggle too
    applyAreasVisible();
    renderOrderSeg();
    wireUI();
    map.on('zoom', () => { updateZoomReadout(); updateHexZoomNow(); });
    map.on('zoomend', async () => {
        if (!(isHex(S.layerId) && S.hex.auto && hexResNow() !== S.hexRes)) return;
        // Keep the open hexagon open: zooming in, its busiest smaller hexagon; zooming out, the bigger one around it.
        const was = S.expanded ?? S.selectedId, from = S.hexRes;
        await setLayer(S.layerId);
        if (!was) return;
        const n = c => S.join?.byId[c]?.rows.length || 0;
        const cands = S.hexRes > from ? h3.cellToChildren(was, S.hexRes) : [h3.cellToParent(was, S.hexRes)];
        const best = cands.reduce((a, c) => n(c) > n(a) ? c : a, cands[0]);
        if (n(best)) openArea(best, { fly: false });
    });
    await setLayer(first);
    renderAirtable();
    const atLink = AT() && AT().parseLink(new URLSearchParams(location.search).get('airtable'));
    if (atLink) {
        $('at-url').value = AT().linkFor(atLink);
        $('at-card').open = true;
        if (AT().token.get()) loadAirtable(atLink);
        else { atStatus('Paste your token to open this Airtable view.'); $('at-token').focus(); }
    }
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
// Place names from the basemap (city, neighborhoods, islands): off while areas are shown, so
// "San Francisco" and "Twin Peaks" don't sit on top of the areas' own labels.
const placeLayers = () => styleLayers().filter(l => /^places_/.test(l.id) || l.id === 'earth_label_islands').map(l => l.id);

// Always: no highway shields or one-way arrows, road labels for major streets only, and
// the creek fix shared with Block Party and Selecter.
function tidyBasemap() {
    for (const l of styleLayers()) {
        if (l.id === 'roads_shields' || l.id === 'roads_oneway') map.setLayoutProperty(l.id, 'visibility', 'none');
        if (l.id === 'roads_labels_major') map.setFilter(l.id, ['==', ['get', 'kind'], 'major_road']);
        if (l.id === 'roads_labels_major' || l.id === 'roads_labels_minor') {
            map.setLayerZoomRange(l.id, CONFIG.streetNamesZoom, 24);
            const z = CONFIG.labelColors[S.streetColor] || CONFIG.labelColors[CONFIG.streetColor];
            map.setPaintProperty(l.id, 'text-color', z.text);
            map.setPaintProperty(l.id, 'text-halo-color', z.halo);
            map.setPaintProperty(l.id, 'text-halo-width', z.width);
        }
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

// Copies of the basemap's street lines draw above the colored areas (and below the basemap's
// labels, so street names stay on top), so blocks read when zoomed in: major roads, highways
// and their links from streetsMajorZoom, every street from streetsOverZoom.
const isMajorRoad = id => /(major|highway|link)/.test(id);
// Just a hint of the network: no casings, half the width, a little transparent. Over areas left
// clear the copies sit on the basemap's own (wider) roads, so those look unchanged.
function scaleWidth(w, k) {
    if (typeof w === 'number') return w * k;
    if (Array.isArray(w) && (w[0] === 'interpolate' || w[0] === 'interpolate-hcl') && JSON.stringify(w[2]) === '["zoom"]')
        return [...w.slice(0, 3), ...w.slice(3).map((v, i) => i % 2 ? scaleWidth(v, k) : v)];
    if (Array.isArray(w) && w[0] === 'step' && JSON.stringify(w[1]) === '["zoom"]')
        return [w[0], w[1], scaleWidth(w[2], k), ...w.slice(3).map((v, i) => i % 2 ? scaleWidth(v, k) : v)];
    if (Array.isArray(w)) return ['*', k, w];
    return w;
}
function addStreetsOverAreas(beforeId) {
    for (const l of styleLayers()) {
        if (l.type !== 'line' || l['source-layer'] !== 'roads' || /casing/.test(l.id)) continue;
        const copy = JSON.parse(JSON.stringify(l));
        copy.id = 'over_' + l.id;
        copy.paint = { ...copy.paint, 'line-width': scaleWidth(copy.paint?.['line-width'] ?? 1, CONFIG.streetHintWidth), 'line-opacity': CONFIG.streetHintOpacity };
        copy.minzoom = Math.max(isMajorRoad(l.id) ? CONFIG.streetsMajorZoom : CONFIG.streetsOverZoom, l.minzoom || 0);
        map.addLayer(copy, beforeId);
    }
}

// Areas draw over the basemap (as before) or under its water, roads and buildings, with their
// outlines still on top. Auto: under for hexagons, whose grid ignores the coastline and streets;
// over for named areas.
const areasUnder = () => S.areaOrder === 'under' || (S.areaOrder === 'auto' && isHex(S.layerId));
// With the areas under the basemap (hexagons), its own streets get the same light touch as the
// copies over named areas: no casings, half the width, a little transparent. Restored when over.
const roadPaint = new Map();   // original line-width / line-opacity of the basemap's road lines
function applyRoadHint(on) {
    for (const l of styleLayers()) {
        if (l.type !== 'line' || l['source-layer'] !== 'roads' || l.id.startsWith('over_')) continue;
        if (/casing/.test(l.id)) { map.setLayoutProperty(l.id, 'visibility', on || !S.basemap.roads ? 'none' : 'visible'); continue; }
        if (!roadPaint.has(l.id)) roadPaint.set(l.id, { w: map.getPaintProperty(l.id, 'line-width') ?? 1, o: map.getPaintProperty(l.id, 'line-opacity') ?? 1 });
        const o = roadPaint.get(l.id);
        map.setPaintProperty(l.id, 'line-width', on ? scaleWidth(o.w, CONFIG.streetHintWidth) : o.w);
        map.setPaintProperty(l.id, 'line-opacity', on ? CONFIG.streetHintOpacity : o.o);
    }
}
function applyAreaOrder() {
    if (!map.getLayer('bounds-fill')) return;
    const water = styleLayers().find(l => l['source-layer'] === 'water')?.id;
    map.moveLayer('bounds-fill', areasUnder() && water ? water : 'bounds-glow');
    applyRoadHint(areasUnder() && S.showAreas);
    applyBasemapToggles();   // the street copies are redundant when the areas are under the streets
    renderOrderSeg();
}
function renderOrderSeg() {
    const el = $('order-seg'); if (!el) return;
    el.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.order === S.areaOrder));
    const a = el.querySelector('[data-order="auto"]');
    if (a) a.textContent = `Auto (${areasUnder() ? 'under' : 'over'})`;
}

function applyBasemapToggles() {
    const vis = on => on ? 'visible' : 'none';
    for (const id of roadLayers()) if (id !== 'roads_shields' && id !== 'roads_oneway')
        map.setLayoutProperty(id, 'visibility', vis(S.basemap.roads && !(id.startsWith('over_') && areasUnder())));
    for (const id of placeLayers()) map.setLayoutProperty(id, 'visibility', vis(S.basemap.places));
    if (areasUnder() && S.showAreas) applyRoadHint(true);   // keep casings hidden over hexagons
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
    map.addLayer({ id: 'bounds-line', type: 'line', source: 'bounds', paint: { 'line-color': '#1E2340', 'line-opacity': 0.5,
        'line-width': ['interpolate', ['linear'], ['zoom'], 11, 0.8, 14, 1.4, 16, 2] } }, before);
    // The selected area: a green line on a white casing, so it reads on dark blue or dark red.
    map.addLayer({ id: 'bounds-hl-case', type: 'line', source: 'bounds', paint: {
        'line-color': '#ffffff', 'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 7, 0],
    } });
    map.addLayer({ id: 'bounds-hl', type: 'line', source: 'bounds', paint: {
        'line-color': ['case', ['boolean', ['feature-state', 'selected'], false], pal().pick || CONFIG.highlight, '#1E2340'],
        'line-width': ['case', ['boolean', ['feature-state', 'selected'], false], 4, ['boolean', ['feature-state', 'hover'], false], 2.5, 0],
    } });
    // Rows from the loaded file that carry geometry: polygons, lines, points.
    map.addSource('rows', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Placed rows are solid; rows not placed in any area are hollow (white fill, colored ring)
    // or dashed, so the difference doesn't rely on color alone.
    const isPoly = ['==', ['geometry-type'], 'Polygon'], isPt = ['==', ['geometry-type'], 'Point'];
    addStreetsOverAreas(before);
    // Lines get thicker as you zoom in, most of all from the zoom where streets draw over the areas.
    const isLine = ['==', ['geometry-type'], 'LineString'];
    map.addLayer({ id: 'rows-fill', type: 'fill', source: 'rows', filter: ['all', isPoly, ['get', '_in']], paint: { 'fill-opacity': 0.18 } });
    // Lines from the file draw from linesFromZoom; zoomed out, each line is a dot at its midpoint.
    map.addLayer({ id: 'rows-line-glow', type: 'line', source: 'rows', filter: ['all', ['!', isPt], ['!', isLine]], paint: { 'line-width': 6, 'line-blur': 2.5, 'line-opacity': 0.9 } });
    // Lines: a dark casing under a colored core.
    map.addLayer({ id: 'rows-sline-casing', type: 'line', source: 'rows', minzoom: CONFIG.linesFromZoom, filter: isLine,
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': CONFIG.hover.ring, 'line-width': lineW(1.55), 'line-opacity': 0.85 } });
    map.addLayer({ id: 'rows-line', type: 'line', source: 'rows', filter: ['all', ['!', isPt], ['!', isLine], ['get', '_in']], paint: { 'line-width': 2.5, 'line-opacity': 0.9 } });
    map.addLayer({ id: 'rows-line-out', type: 'line', source: 'rows', filter: ['all', ['!', isPt], ['!', isLine], ['!', ['get', '_in']]],
        paint: { 'line-width': 2.5, 'line-opacity': 0.9, 'line-dasharray': [2, 2] } });
    map.addLayer({ id: 'rows-sline', type: 'line', source: 'rows', minzoom: CONFIG.linesFromZoom, filter: ['all', isLine, ['get', '_in']],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-width': lineW(1), 'line-opacity': 0.95 } });
    map.addLayer({ id: 'rows-sline-out', type: 'line', source: 'rows', minzoom: CONFIG.linesFromZoom, filter: ['all', isLine, ['!', ['get', '_in']]],
        paint: { 'line-width': lineW(1), 'line-opacity': 0.95, 'line-dasharray': [1.2, 0.8] } });
    // Points, and line midpoints below linesFromZoom (features with _mid).
    map.addLayer({ id: 'rows-mid', type: 'circle', source: 'rows', maxzoom: CONFIG.linesFromZoom, filter: ['get', '_mid'],
        paint: { 'circle-opacity': 1 } });
    map.addLayer({ id: 'rows-point', type: 'circle', source: 'rows', filter: ['all', isPt, ['!', ['get', '_mid']]],
        paint: { 'circle-opacity': 1 } });
    // Highlight: rows in the area under the cursor (map or list), or the row hovered in an expanded list.
    map.addSource('rows-hl', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    // Hovered rows draw bigger, in yellow with a dark ring, above every other row.
    map.addLayer({ id: 'rows-hl-casing', type: 'line', source: 'rows-hl', filter: ['!=', ['geometry-type'], 'Point'],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': CONFIG.hover.ring, 'line-width': hlW(1.6) } });
    map.addLayer({ id: 'rows-hl-line', type: 'line', source: 'rows-hl', filter: ['!=', ['geometry-type'], 'Point'],
        layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': CONFIG.hover.fill, 'line-width': hlW(1) } });
    map.addLayer({ id: 'rows-hl-point', type: 'circle', source: 'rows-hl', filter: ['==', ['geometry-type'], 'Point'],
        paint: { 'circle-color': CONFIG.hover.fill, 'circle-stroke-color': CONFIG.hover.ring, 'circle-stroke-width': 2, 'circle-radius': 6 } });
    applyPointSize();
    applyPalette();
    // Area labels sit above the basemap's own labels.
    map.addLayer({ id: 'area-labels', type: 'symbol', source: 'labels', layout: {
        'text-field': '', 'text-font': CONFIG.fonts.bold, 'text-size': 12, 'text-line-height': 1.15,
        'text-max-width': 9, 'text-padding': 3, 'symbol-sort-key': ['get', '_rank'],
    }, paint: { 'text-color': ['coalesce', ['get', '_lc'], '#1E2340'], 'text-halo-color': ['coalesce', ['get', '_hc'], 'rgba(255,255,255,0.92)'],
        'text-halo-width': ['coalesce', ['get', '_hw'], 1.4], 'text-halo-blur': 0.4 } });
    // Row labels from Format features, beside each row's point.
    map.addSource('rowlabels', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'rows-labels', type: 'symbol', source: 'rowlabels', minzoom: 13, layout: {
        'text-field': ['get', '_lab'], 'text-font': CONFIG.fonts.bold, 'text-size': 11, 'text-anchor': 'left',
        'text-offset': [0.8, 0], 'text-justify': 'left', 'text-max-width': 12, 'text-padding': 2, 'text-optional': true,
    }, paint: { 'text-color': '#1E2340', 'text-halo-color': 'rgba(255,255,255,0.95)', 'text-halo-width': 1.4 } });
    applyLabelSize();
    applyLabelColor(); applyStreetColor();

    // One handler for areas and rows: a row under the cursor wins over the area beneath it.
    const ROW_LAYERS = ['rows-point', 'rows-mid', 'rows-line', 'rows-line-out', 'rows-sline', 'rows-sline-out', 'rows-fill'];
    const hit = e => {
        const near = [[e.point.x - 4, e.point.y - 4], [e.point.x + 4, e.point.y + 4]];
        const row = map.queryRenderedFeatures(near, { layers: ROW_LAYERS.filter(l => l !== 'rows-fill') })[0]
            || map.queryRenderedFeatures(e.point, { layers: ['rows-fill'] })[0];
        if (row) return { row: row.properties._i };
        const area = S.showAreas && map.queryRenderedFeatures(e.point, { layers: ['bounds-fill'] })[0];
        return area ? { area: area.properties._jid } : {};
    };
    map.on('mousemove', e => {
        const h = hit(e);
        if (h.row != null && h.area == null) setHoverRow(h.row); else setHover(h.area ?? null);
        hlRows(h.row != null ? { row: h.row } : null);
        tableHover(h.row ?? null);
        if (h.row != null) showRowTip(e.point, h.row);
        else if (h.area != null) showTip(e.point, h.area);
        else $('tip').hidden = true;
        map.getCanvas().style.cursor = h.row != null || h.area != null ? 'pointer' : '';
    });
    map.on('mouseout', () => { setHover(null); hlRows(null); $('tip').hidden = true; });
    map.on('click', e => {
        const h = hit(e);
        // A feature: its fields in a popup, and its area opened in the list with the row marked.
        // An area: opened in the list and zoomed to (no popup).
        if (h.row != null) {
            pinRowCard(null);
            const a = S.rowArea[h.row];
            if (a != null) openArea(a, { fly: false });
            else select(null);
            popup.setLngLat(e.lngLat).setHTML(rowPopupHTML(h.row)).addTo(map);
            markListRow(h.row);
        }
        else if (h.area != null) { pinRowCard(null); openArea(h.area); }
        else { pinRowCard(null); if (S.selectedId != null) { select(null); S.expanded = null; renderList(); } }   // empty map: clear
    });
}

// Relative luminance, for choosing a white or dark glow around a color.
function luminance(hex) {
    const c = hex.replace('#', '').match(/../g).map(h => { const v = parseInt(h, 16) / 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
    return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const glowFor = hex => luminance(hex) > 0.4 ? 'rgba(30,35,64,0.6)' : '#ffffff';

// The ramp used for rows colored by a number: the palette the areas aren't using.
const ROW_RAMPS = { blues: 'ylorrd', ylorrd: 'blues', rdylbu: 'greens' };
const GREENS = { label: 'green', ramp: ['#c7e9c0', '#a1d99b', '#74c476', '#31a354', '#006d2c'] };   // ColorBrewer Greens
const rowRampPal = () => ROW_RAMPS[S.palette] === 'greens' ? GREENS : CONFIG.palettes[ROW_RAMPS[S.palette] || 'blues'];
const rowRamp = () => rowRampPal().ramp;
// Categorical colors for rows, minus hues that would blend into the area palette.
const ROW_CAT_SKIP = { blues: ['#2a78d6'], ylorrd: ['#eb6834', '#eda100', '#e34948'], rdylbu: ['#2a78d6', '#eb6834', '#eda100', '#e34948'] };
const rowCategorical = () => CONFIG.categorical.filter(c => !(ROW_CAT_SKIP[S.palette] || []).includes(c));

function applyPalette() {
    const p = pal();
    // The selected area's color: green, or purple where the palette's features are green.
    map.setPaintProperty('bounds-hl', 'line-color', ['case', ['boolean', ['feature-state', 'selected'], false], p.pick || CONFIG.highlight, '#1E2340']);
    document.documentElement.style.setProperty('--pick', p.pick || CONFIG.highlight);
    document.documentElement.style.setProperty('--pick-wash', p.pickWash || '#E2F5EA');
    map.setPaintProperty('bounds-fill', 'fill-color',
        ['match', ['coalesce', ['feature-state', 'c'], -1], ...p.ramp.flatMap((c, i) => [i, c]), 'rgba(0,0,0,0)']);
    // Rows: one contrasting color, or one per class when colored by a column (property _k).
    const rc = S.rowClasses;
    const colors = rc ? rc.colors : [p.rows];
    // Class -1 (no value, or a category folded into Other) is gray.
    const pick = (vals, other) => rc ? ['match', ['get', '_k'], ...vals.flatMap((v, i) => [i, v]), other] : vals[0];
    const color = pick(colors, CONFIG.other), glow = pick(colors.map(glowFor), glowFor(CONFIG.other));
    map.setPaintProperty('rows-fill', 'fill-color', color);
    map.setPaintProperty('rows-line', 'line-color', color);
    for (const id of ['rows-line', 'rows-line-out', 'rows-sline', 'rows-sline-out']) map.setPaintProperty(id, 'line-color', color);
    map.setPaintProperty('rows-line-glow', 'line-color', glow);
    // Line casing follows the line's color, as points' rings do: dark under light colors, white under dark ones.
    map.setPaintProperty('rows-sline-casing', 'line-color', glow);
    applyPointStyle(color, glow);
    applyOutline();
    document.documentElement.style.setProperty('--rows', p.rows);
}

// Points and lines in the chosen style. Rows not placed in an area are hollow or faded.
function applyPointStyle(color, glow) {
    const style = styleNow(), pin = sizeNow() === 'pinpoint', inA = ['get', '_in'];
    const cas = (a, b) => ['case', inA, a, b];
    const z = (a, b) => ['interpolate', ['linear'], ['zoom'], 10, a, 14, b];
    let fill = cas(color, '#ffffff'), fillOp = 1, ring = cas(glow, color), ringOp = 1,
        width = z(cas(0.8, 1.8), cas(1.4, 2.2));   // light colors (pale ramp ends, yellow) get a dark ring, others white
    const white = style.endsWith('-w'), tint = white ? '#ffffff' : color;
    if (style.startsWith('ring')) { fill = 'rgba(0,0,0,0)'; ring = tint; ringOp = cas(1, 0.45); width = z(1.3, 2.2); }
    else if (style.startsWith('ghost')) { fill = tint; fillOp = white ? cas(0.24, 0.1) : cas(0.18, 0.07); ring = tint; ringOp = white ? cas(0.8, 0.4) : cas(0.6, 0.3); width = white ? 0.8 : 0.6; }
    else if (style === 'black') { ring = 'rgba(30,30,30,0.85)'; width = z(1.1, 1.6); }
    else if (style === 'white') { fill = color; fillOp = cas(1, 0.4); ring = '#ffffff'; width = z(1.1, 1.6); }
    else if (style === 'bw') { fill = '#ffffff'; ring = cas('rgba(30,30,30,0.9)', 'rgba(30,30,30,0.4)'); width = z(1.1, 1.6); }
    if (pin) {   // pinpoints: no outline (a thin one for rings, which are only outline)
        if (style.startsWith('ring')) width = 0.8;
        else {
            width = 0;
            if (style === 'bw') fill = cas('#1e1e1e', '#9a9a9a');
            else if (style.startsWith('ghost')) { fill = tint; fillOp = white ? cas(0.7, 0.3) : cas(0.55, 0.2); }
            else { fill = color; fillOp = cas(1, 0.4); }
        }
    }
    for (const id of ['rows-point', 'rows-mid']) {
        map.setPaintProperty(id, 'circle-color', fill);
        map.setPaintProperty(id, 'circle-opacity', fillOp);
        map.setPaintProperty(id, 'circle-stroke-color', ring);
        map.setPaintProperty(id, 'circle-stroke-opacity', ringOp);
        map.setPaintProperty(id, 'circle-stroke-width', width);
    }
    // Lines: ghosted, or with a black or white casing, or black on white.
    const ghost = style.startsWith('ghost');
    for (const id of ['rows-sline', 'rows-sline-out']) {
        map.setPaintProperty(id, 'line-color', style === 'bw' ? '#1e1e1e' : white ? '#ffffff' : color);
        map.setPaintProperty(id, 'line-opacity', ghost ? 0.35 : 0.95);
    }
    map.setPaintProperty('rows-sline-casing', 'line-color', style === 'black' ? '#1e1e1e' : style === 'white' || style === 'bw' ? '#ffffff' : glow);
    map.setPaintProperty('rows-sline-casing', 'line-opacity', ghost || pin || style.startsWith('ring') ? 0 : 0.85);
    map.setPaintProperty('rows-line-glow', 'line-opacity', ghost || pin ? 0 : 0.9);
    for (const id of ['rows-line', 'rows-line-out']) map.setPaintProperty(id, 'line-opacity', ghost ? 0.35 : 0.9);
}

// ═════════════════════════════════════════════════════════════════════════
// Tabs and layers
// ═════════════════════════════════════════════════════════════════════════
const OTHER = 'Other', UPLOAD = '\u0000upload';
function renderTabs() {
    const active = S.layers.get(S.layerId)?.tab;
    $('tabs').innerHTML = S.tabs.map(t => {
        const sel = t.tab === active;
        const other = t.tab === OTHER;
        if (t.layers.length < 2 && !other) return `<div class="tab" role="tab" tabindex="0" aria-selected="${sel}" data-tab="${esc(t.tab)}">${esc(t.tab)}</div>`;
        // A tab with several sets shows the chosen set's name and a ▾; the native select sits over it.
        // Other says "Other" until one of its sets is showing, and ends with Upload.
        const choice = S.layers.get(S.tabChoice[t.tab]);
        const opt = l => `<option value="${esc(l.id)}"${sel && l.id === choice?.id ? ' selected' : ''}>${esc(shortLabel(l))}</option>`;
        const own = t.layers.filter(l => !l.uploaded), mine = t.layers.filter(l => l.uploaded);
        const options = other
            ? (sel ? '' : `<option value="" selected disabled>Other sets</option>`) + own.map(opt).join('')
                + (mine.length ? `<optgroup label="Your files">${mine.map(opt).join('')}</optgroup>` : '')
                + `<option value="${UPLOAD}">Upload polygons (GeoJSON)…</option>`
            : t.layers.map(opt).join('');
        const name = other && !sel ? OTHER : choice ? (choice.short || shortLabel(choice)) : OTHER;
        return `<div class="tab menu" role="tab" aria-selected="${sel}" data-tab="${esc(t.tab)}" title="${esc(t.tab)}: choose a set">
            <span>${esc(name)}</span><span class="tri" aria-hidden="true">▾</span>
            <select data-tab="${esc(t.tab)}" aria-label="${esc(t.tab)} set">${options}</select></div>`;
    }).join('');
}
const shortLabel = l => l.label.replace(/\s*\(\d+\)$/, '');

async function loadGeo(id) {
    if (S.layers.get(id).hex) return loadHex();
    if (!S.geo.has(id)) {
        const meta = S.layers.get(id);
        const fc = await (await fetch(CONFIG.boundaries + meta.file)).json();
        fc.features.forEach(f => { f.properties._jid = String(f.id); });
        S.geo.set(id, fc);
        const anchors = new Map();
        fc.features.forEach(f => anchors.set(f.id, focusOf(f.geometry, meta.bbox || fc.bbox)));
        S.anchors.set(id, anchors);
    }
    return S.geo.get(id);
}

// ── H3 hexagons ──
const isHex = id => !!S.layers.get(id)?.hex;
const clampRes = r => Math.max(CONFIG.hexRange[0], Math.min(CONFIG.hexRange[1], r));
// Hexagon width in pixels: flat side to flat side, at a zoom and latitude (512px tiles).
const EDGE_M = r => h3.getHexagonEdgeLengthAvg(r, 'm');
// Auto (JoinKit.hex): the resolution whose hexagons are closest to hexTargetPx across at this zoom
// and latitude; hexSwitchZoom: where it moves from base level r to r + 1.
const hexAutoBase = (z, lat) => JoinKit.hex.autoResolution(h3, z, lat, { targetPx: CONFIG.hexTargetPx });
const hexSwitchZoom = (r, lat) => JoinKit.hex.switchZoom(h3, r, lat, { targetPx: CONFIG.hexTargetPx });
const viewLat = () => map.getCenter().lat;
const hexResNow = () => S.hex.auto ? clampRes(hexAutoBase(map.getZoom() + (S.hex.zshift || 0), viewLat()) + (S.hex.bump || 0)) : clampRes(S.hex.res);
// The set that names hexagons ("Mission #82c7") and, where the data overlaps it, fills the grid
// with its empty hexagons. '' for none: only hexagons with rows, named by code.
const hexNameSet = () => S.hex.names === undefined ? 'analysis_neighborhoods' : S.layers.has(S.hex.names) ? S.hex.names : '';
S.hexCache = new Map();   // resolution|set → { fc, land, src }
// Cells covering the naming set (for SF, the analysis neighborhoods), plus the cell of every row
// from the loaded file, anywhere.
async function loadHex() {
    const res = S.hexRes = hexResNow(), set = hexNameSet();
    const setMeta = set ? S.layers.get(set) : null, land = set ? await loadGeo(set) : null;
    // Cover the set only when there's no file or the file has rows inside the set's bounds.
    const sb = land && bboxFC(land);
    const overlaps = !S.src?.points || S.src.points.some(p => p && sb && p[0] >= sb[0] && p[0] <= sb[2] && p[1] >= sb[1] && p[1] <= sb[3]);
    const fine = Math.min(15, res + 2);
    const tooMany = land && h3.getHexagonAreaAvg(fine, 'm2') * CONFIG.hexCoverMax * 49 < bboxArea(sb);
    const cover = !!land && overlaps && !tooMany;
    const key = `${res}|${cover ? set : ''}`;
    let c = S.hexCache.get(key);
    if (!c) {
        const cells = new Set(), votes = new Map();   // cell → { area name: fine cells }
        if (cover) for (const f of land.features) {
            const hood = String(nameOf(f, setMeta));
            const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
            for (const p of polys) for (const fc of h3.polygonToCells(p, fine, true)) {
                const cell = fine === res ? fc : h3.cellToParent(fc, res);
                cells.add(cell);
                const v = votes.get(cell) || votes.set(cell, {}).get(cell);
                v[hood] = (v[hood] || 0) + 1;
            }
        }
        // Each hexagon is named for the neighborhood covering most of it.
        const hoodOf = new Map([...votes].map(([cell, v]) => [cell, Object.entries(v).sort((a, b) => b[1] - a[1])[0][0]]));
        const features = [...cells].sort().map(cell => ({ type: 'Feature', id: cell, properties: { h3: cell, _jid: cell, hood: hoodOf.get(cell) },
            geometry: { type: 'Polygon', coordinates: [h3.cellToBoundary(cell, true)] } }));
        c = { fc: { type: 'FeatureCollection', features }, land: features.length };
        S.hexCache.set(key, c);
    }
    S.hexCover = { set, cover, tooMany: !!tooMany, overlaps };
    // Add cells for this file's rows (kept per file, so each file starts from the cover grid).
    if (c.src !== S.src || c.label !== S.hex.label) {
        c.fc.features = c.fc.features.slice(0, c.land);
        const seen = new Set(c.fc.features.map(f => f.id)), extra = [];
        for (const p of S.src?.points || []) {
            if (!p) continue;
            const cell = h3.latLngToCell(p[1], p[0], res);
            if (seen.has(cell)) continue;
            seen.add(cell);
            extra.push({ type: 'Feature', id: cell, properties: { h3: cell, _jid: cell, hood: '' }, geometry: { type: 'Polygon', coordinates: [h3.cellToBoundary(cell, true)] } });
        }
        // Hexagons outside the cover are named by the area their center falls in, if any.
        if (land && extra.length) {
            const at = JoinKit.assignPointsToPolygons(extra.map(f => { const [la, ln] = h3.cellToLatLng(f.id); return [ln, la]; }), land.features, { idOf: f => f.id });
            const byId = new Map(land.features.map(f => [f.id, f]));
            extra.forEach((f, i) => { f.properties.hood = at[i] != null ? String(nameOf(byId.get(at[i]), setMeta)) : ''; });   // outside every area: code only
        }
        c.fc.features.push(...extra);
        hexNames(c.fc.features);
        c.src = S.src; c.label = S.hex.label;
    }
    const anchors = new Map();
    for (const f of c.fc.features) {
        const [lat, lng] = h3.cellToLatLng(f.id), b = bbox(f.geometry);
        anchors.set(f.id, { anchor: [lng, lat], fit: b, area: (b[2] - b[0]) * (b[3] - b[1]) });
    }
    S.geo.set('h3', c.fc); S.anchors.set('h3', anchors);
    S.areaOf.delete('h3');
    return c.fc;
}

// A short code for each hexagon: its H3 index without the digits every hexagon here shares and
// without the trailing f's (unused finer levels). "8928308280fffff" → "#280".
function bboxFC(fc) { return unionBbox(fc.features.map(f => bbox(f.geometry))); }
const bboxArea = b => { if (!b) return 0; const mid = (b[1] + b[3]) / 2; return (b[2] - b[0]) * 111320 * Math.cos(mid * Math.PI / 180) * (b[3] - b[1]) * 110540; };
function hexNames(features) {
    const codes = JoinKit.hex.shortCodes(h3, features.map(f => f.id));   // "#82c7": without the shared digits and unused f's
    for (const f of features) {
        const code = codes.get(f.id);
        f.properties.code = code;
        // Friendly: "Mission #82c7" (or just the code with no naming set); H3: the full index.
        f.properties.name = S.hex.label === 'h3' ? f.id : f.properties.hood ? `${f.properties.hood} ${code}` : code;
    }
}

// A polygon GeoJSON from the user's computer, added to Other as a set to join to. The key is the
// property that names each polygon: a name-like one with a different value for each, else any
// such property, else the polygon's number.
async function addPolygonLayer(file) {
    let gj;
    try { gj = JSON.parse(await file.text()); } catch { toast(`${file.name} isn’t JSON`, { ms: 5000 }); return; }
    const feats = (gj.type === 'FeatureCollection' ? gj.features : gj.type === 'Feature' ? [gj] : [])
        .filter(f => /^(Multi)?Polygon$/.test(f?.geometry?.type));
    if (!feats.length) { toast(`${file.name} has no polygons`, { sub: 'Upload a GeoJSON file of areas (Polygon or MultiPolygon features).', ms: 6000 }); return; }
    const props = [...new Set(feats.flatMap(f => Object.keys(f.properties || {})))].filter(k => !k.startsWith(':') && !k.startsWith('_'));
    const unique = k => { const v = feats.map(f => f.properties?.[k]); return v.every(x => x !== null && x !== undefined && String(x).trim() !== '' && typeof x !== 'object') && new Set(v.map(String)).size === v.length; };
    const nameLike = k => /(^|_)(name|label|title|nhood|neighbo|district|county|zip|zcta|geoid|code|id)(_|$)|name$/i.test(k);
    const key = props.filter(unique).sort((a, b) => nameLike(b) - nameLike(a) || /name/i.test(b) - /name/i.test(a))[0] || null;
    const base = file.name.replace(/\.(geo)?json$/i, '');
    let id = 'upload_' + base.toLowerCase().replace(/[^a-z0-9]+/g, '_').slice(0, 40), n = 2;
    while (S.layers.has(id)) id = id.replace(/_\d+$/, '') + '_' + n++;
    const features = feats.map((f, i) => {
        const k = key ? String(f.properties[key]).trim() : String(i + 1);
        return { type: 'Feature', id: k, properties: { ...(f.properties || {}), ...(key ? {} : { number: k }), _jid: k }, geometry: f.geometry };
    });
    const fc = { type: 'FeatureCollection', features };
    const meta = { id, label: `${base} (${features.length})`, short: base, tab: OTHER, key: key || 'number', name: key || 'number',
        match: { caseInsensitive: true, collapseSpace: true }, uploaded: true, bbox: bboxFC(fc) };
    S.layers.set(id, meta); S.geo.set(id, fc);
    const anchors = new Map(); features.forEach(f => anchors.set(f.id, focusOf(f.geometry, meta.bbox))); S.anchors.set(id, anchors);
    S.tabs.find(t => t.tab === OTHER).layers.push(meta);
    await setLayer(id);
    toast(`Added ${base}: ${features.length.toLocaleString()} polygons`, { sub: key ? `Each is named by “${key}”, which rows can match.` : 'No property names each polygon, so they’re numbered.', ms: 6000 });
}

async function setLayer(id) {
    const meta = S.layers.get(id);
    S.layerId = id;
    S.tabChoice[meta.tab] = id;
    history.replaceState(null, '', '#layer=' + id);
    renderTabs();
    // Big files on hexagons take a moment: say what's happening, and let the toast paint first.
    const busy = (S.src?.rows.length || 0) >= (meta.hex ? 3000 : 20000);
    const busyMsg = () => meta.hex ? `Counting ${S.src.rows.length.toLocaleString()} rows into hexagons` : `Matching ${S.src.rows.length.toLocaleString()} rows to ${shortLabel(meta)}`;
    if (busy) { toast(busyMsg(), { busy: true, sub: meta.hex ? `Resolution ${hexResNow()}` : 'Loading the areas' }); await nextFrame(); }
    const fc = await loadGeo(id);
    renderHexControls();
    applyPointSize(); renderFormatFeatures();
    applyAreaOrder();
    applyLabelSize();   // Auto size follows the set's typical area
    // Thousands of hexagons: keep their outlines light.
    applyOutline();
    // Clear hover and selection by id. removeFeatureState({ source }) here was applied after the
    // new layer's colors were set in the same frame, wiping some of them (areas with rows left blank).
    if (S.selectedId !== null) map.setFeatureState({ source: 'bounds', id: S.selectedId }, { selected: false });
    if (S.hoverId !== null) map.setFeatureState({ source: 'bounds', id: S.hoverId }, { hover: false });
    selectAlso([]);
    S.selectedId = null; S.hoverId = null; S.expanded = null; popup.remove();
    map.getSource('bounds').setData(fc);
    boundsKey = id + '|all|' + fc.features.length;
    // Sets beyond SF (Bay Area, uploads): show all of the set; coming back to SF, return to the city.
    const wasWide = S.wideView;
    S.wideView = !!(meta.regional || meta.uploaded);
    if (S.wideView) { const b = meta.bbox || bboxFC(fc); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 30, duration: 600 }); }
    else if (wasWide && !meta.hex) { const h = unionBbox(S.manifest.layers.filter(l => !l.regional).map(l => l.bbox).filter(Boolean)); map.fitBounds([[h[0], h[1]], [h[2], h[3]]], { padding: 24, duration: 600 }); }
    $('list-title').textContent = shortLabel(meta);
    if (busy) await prepare();   // places and counts in chunks, with progress
    recompute();
    // Keep the toast until the map has drawn the new areas (much of the wait is drawing, not counting).
    if (busy) map.once('idle', () => toast(null));
}

// ═════════════════════════════════════════════════════════════════════════
// Joining
// ═════════════════════════════════════════════════════════════════════════
// "Match rows by" can be a column, or the row's own location when the file has geometry.
const LOCATION = '\u0000location';
const AREA_COL = '\u0000area';
// The area set's name for one area: "ZIP Code", "Planning Neighborhood Group", "hexagon".
const oneArea = (meta = S.layers.get(S.layerId)) => meta.hex ? 'hexagon'
    : shortLabel(meta).replace(/\s*\d{4}$/, '').replace(/(Groups|Neighborhoods|Neighbourhoods|Tracts|Codes|Districts)$/, m => m.slice(0, -1));
const keyLabel = col => col === LOCATION ? `Location (inside the ${oneArea()})` : col;

// One point per row for placing it in an area: the point itself, a line's middle vertex,
// or a spot well inside a polygon.
function repPoint(g) {
    if (!g) return null;
    switch (g.type) {
        case 'Point': return g.coordinates;
        case 'MultiPoint': return g.coordinates[0];
        case 'LineString': return alongMid(g.coordinates);
        case 'MultiLineString': return alongMid(g.coordinates.reduce((a, l) => lineLen(l) > lineLen(a) ? l : a, g.coordinates[0]));
        case 'Polygon': case 'MultiPolygon': return focusOf(g).anchor;
        // Several shapes (e.g. a row linked to blocks and an intersection): the first line, else the first shape.
        case 'GeometryCollection': return repPoint(g.geometries.find(x => /LineString/.test(x.type)) || g.geometries[0]);
        default: return null;
    }
}

// The point halfway along a line (by length, with longitude scaled for latitude).
const segLen = (a, b) => { const k = Math.cos(a[1] * Math.PI / 180); return Math.hypot((b[0] - a[0]) * k, b[1] - a[1]); };
const lineLen = l => { let d = 0; for (let i = 1; i < l.length; i++) d += segLen(l[i - 1], l[i]); return d; };
function alongMid(l) {
    if (!l?.length) return null;
    let half = lineLen(l) / 2;
    for (let i = 1; i < l.length; i++) {
        const d = segLen(l[i - 1], l[i]);
        if (d >= half && d > 0) { const t = half / d; return [l[i - 1][0] + (l[i][0] - l[i - 1][0]) * t, l[i - 1][1] + (l[i][1] - l[i - 1][1]) * t]; }
        half -= d;
    }
    return l[l.length - 1];
}

// The same, in chunks with a progress bar, for files with many located rows; afterwards areasForRows
// finds the answer ready. Run before recompute when a set is shown.
async function placeRowsAsync(layerId) {
    const pts = S.src?.points;
    if (!pts || S.areaOf.has(layerId)) return;
    const n = pts.length;
    if (n < 30000) return;
    const meta = S.layers.get(layerId), label = meta.hex ? 'hexagons' : shortLabel(meta);
    const out = new Array(n), CH = 20000;
    let locate;
    if (isHex(layerId)) {
        const ids = new Set(S.geo.get(layerId).features.map(f => f.id));
        locate = slice => slice.map(p => { if (!p) return null; const c = h3.latLngToCell(p[1], p[0], S.hexRes); return ids.has(c) ? c : null; });
    } else {
        S.areaOf.set(layerId, await JoinKit.assignPointsToPolygonsChunked(pts, S.geo.get(layerId).features, { idOf: f => f.id, yieldFn: nextFrame,
            onProgress: (i, t) => toast(`Placing rows in ${label}`, { busy: true, progress: i / t, sub: `${i.toLocaleString()} of ${t.toLocaleString()}` }) }));
        return;
    }
    for (let i = 0; i < n; i += CH) {
        toast(`Placing rows in ${label}`, { busy: true, progress: i / n, sub: `${i.toLocaleString()} of ${n.toLocaleString()}` });
        await nextFrame();
        const got = locate(pts.slice(i, i + CH));
        for (let j = 0; j < got.length; j++) out[i + j] = got[j];
    }
    S.areaOf.set(layerId, out);
}
function areasForRows(layerId) {
    if (!S.areaOf.has(layerId)) {
        const pts = S.src.points;
        if (isHex(layerId)) {
            const ids = new Set(S.geo.get(layerId).features.map(f => f.id));
            S.areaOf.set(layerId, pts.map(p => { if (!p) return null; const c = h3.latLngToCell(p[1], p[0], S.hexRes); return ids.has(c) ? c : null; }));
        } else S.areaOf.set(layerId, JoinKit.assignPointsToPolygons(pts, S.geo.get(layerId).features, { idOf: f => f.id }));
    }
    return S.areaOf.get(layerId);
}
// A layer's normalizer, made forgiving with its own names (JoinKit.makeLooseNormalizer): case,
// spaces and punctuation don't count ("Downtown / Civic Center", "Sea Cliff"), each side of a
// slashed name matches it ("Treasure Island" → "Treasure Island/YBI"), and names of 8+ letters
// match one or two letters off ("Downton/Civic Center", "Outer Susnet").
const normCache = new WeakMap();   // feature collection → { layer id: normalizer }
function normalizerFor(meta, fc = S.geo.get(meta.id)) {
    const m = meta.match || {};
    const base = JoinKit.makeKeyNormalizer({
        stripPrefix: m.stripPrefix ? new RegExp(m.stripPrefix, 'i') : undefined,
        caseInsensitive: !!m.caseInsensitive, collapseSpace: !!m.collapseSpace,
    });
    if (!fc || meta.hex) return base;
    const byFc = normCache.get(fc) || normCache.set(fc, {}).get(fc);
    return byFc[meta.id] ||= JoinKit.makeLooseNormalizer(fc.features.map(f => f.properties[meta.key]), base);
}
// A column listing several areas in a cell ("Mission, South of Market"): when at least 5% of its
// values hold a comma, semicolon, pipe or line break, each part counts. Slashes stay (they're in names).
const MULTI = JoinKit.MULTI_DELIMITER;
const delimCache = new WeakMap();   // source → { column: delimiter }
function delimFor(col, meta = S.layers.get(S.layerId)) {
    if (!S.src || !col || col === LOCATION) return meta.match?.delimiter;
    const bySrc = delimCache.get(S.src) || delimCache.set(S.src, {}).get(S.src);
    if (!(col in bySrc)) bySrc[col] = JoinKit.detectDelimiter(S.src.rows, col);
    return bySrc[col] || meta.match?.delimiter;
}

const rawValues = (row, col, delimiter) => {
    const v = row[col];
    return (Array.isArray(v) || delimiter) ? JoinKit.cellValues(v, delimiter).map(JoinKit.cellText) : [v];
};

// Up to n rows spread through the file (all of them when it's smaller): enough to judge a column's
// type or how well it matches, without reading 300,000 rows each time.
const sampleCache = new WeakMap();
function sampleRows(n = 5000) {
    const rows = S.src.rows;
    if (rows.length <= n) return rows;
    const byN = sampleCache.get(S.src) || sampleCache.set(S.src, {}).get(S.src);
    return byN[n] ||= JoinKit.sampleRows(rows, n);
}
// Every column scored by how many rows it would place on this layer (in a big file, from 20,000
// rows spread through it, scaled up).
function keyCandidates(meta, fc, normalize) {
    const index = JoinKit.buildFeatureIndex(fc.features, meta.key, { normalize, idOf: f => f.id });
    const loc = [];
    if (S.src.points) {
        const areas = areasForRows(S.layerId);
        loc.push({ col: LOCATION, hits: areas.filter(a => a != null).length, filled: S.src.points.filter(Boolean).length });
    }
    // Location first on a tie: it doesn't depend on how names are spelled.
    return [...loc, ...S.src.headers.filter(c => !(S.src.geomCols || []).includes(c)).map(col => {
        let hits = 0, filled = 0;
        const rows = sampleRows(20000), scale = S.src.rows.length / rows.length;
        for (const row of rows) {
            const keys = JoinKit.rowKeys(row, col, normalize, delimFor(col, meta));
            if (!keys.length) continue;
            filled++;
            if (keys.some(k => index.has(k))) hits++;
        }
        return scale > 1 ? { col, hits: Math.round(hits * scale), filled: Math.round(filled * scale), approx: true } : { col, hits, filled };
    })].sort((a, b) => b.hits - a.hits || (a.col === LOCATION ? -1 : b.col === LOCATION ? 1 : a.col.localeCompare(b.col)));
}

// Which area set a column's name points to: ZIP, district, tract, or one of the neighborhood sets.
// Returns a layer id, 'neighborhood' when the set is ambiguous, or null.
function layerForColumn(col) {
    const c = String(col).toLowerCase();
    if (/\bzip|postal/.test(c)) return 'zip_codes';
    if (/census|tract|geoid/.test(c)) return 'census_tracts';
    if (/supervisor|\bdistrict|\bsup\b|\bbos\b/.test(c)) return 'supervisor_districts';
    if (/neighbo|nhood|\bhood\b/.test(c)) {
        if (/analysis/.test(c)) return 'analysis_neighborhoods';
        if (/sf ?find|\bfind\b/.test(c)) return 'sf_find_neighborhoods';
        if (/planning/.test(c)) return 'planning_neighborhoods';
        if (/realtor/.test(c)) return 'realtor_neighborhoods';
        if (/\bwof\b|who.?s on first/.test(c)) return 'wof_neighbourhoods';
        return 'neighborhood';
    }
    return null;
}
// Matching by a column that names another kind of area: switch to that set and say so (with Undo).
// For neighborhoods, ask which set unless one is already showing.
async function matchByColumn(col) {
    const want = layerForColumn(col), cur = S.layers.get(S.layerId), from = S.layerId;
    const go = async id => {
        S.keyCols[id] = S.colKeys[id] = col;
        await setLayer(id);
        const placed = (S.rowArea || []).filter(a => a != null).length;
        toast(`Switched to ${shortLabel(S.layers.get(id))} to match “${col}”`, { sub: `${placed.toLocaleString()} of ${S.src.rows.length.toLocaleString()} rows matched`,
            actions: [{ label: 'Undo', fn: () => setLayer(from) }], ms: 9000 });
    };
    if (want === 'neighborhood' && cur.tab !== 'Neighborhood') {
        const sets = [...S.layers.values()].filter(l => l.tab === 'Neighborhood' && !l.hex);
        toast(`“${col}” looks like neighborhood names. Which neighborhood set?`, { sub: 'Pick the one the names come from. You can switch later from the Neighborhood tab.',
            actions: [...sets.map(l => ({ label: shortLabel(l), fn: () => go(l.id) })), { label: `Stay on ${shortLabel(cur)}`, fn: () => { S.keyCols[S.layerId] = S.colKeys[S.layerId] = col; refresh(); } }] });
        return;
    }
    if (want && want !== 'neighborhood' && want !== S.layerId && S.layers.has(want)) return go(want);
    S.keyCols[S.layerId] = S.colKeys[S.layerId] = col;
    await refresh();
}

// Which column rows match by on this layer (or their location): the user's pick, else the best.
function pickKey(meta, fc, normalize) {
    S.candidates = keyCandidates(meta, fc, normalize);
    let keyCol = S.keyCols[S.layerId];
    if (!keyCol || !S.candidates.some(c => c.col === keyCol)) keyCol = S.candidates[0]?.hits ? S.candidates[0].col : null;
    // The column the menu shows (also when placing by location): the user's pick, else the best column.
    const cols = S.candidates.filter(c => c.col !== LOCATION);
    if (!S.colKeys[S.layerId] || !cols.some(c => c.col === S.colKeys[S.layerId])) S.colKeys[S.layerId] = keyCol !== LOCATION && keyCol ? keyCol : cols[0]?.col ?? null;
    if (keyCol) { S.keyCols[S.layerId] = keyCol; if (keyCol !== LOCATION) S.colKeys[S.layerId] = keyCol; }
    return keyCol;
}
// A join is kept until what it depends on changes (the file, the set, the column, the hexagons), so
// changing the statistic, classes or colors doesn't count everything again.
const tokOf = (() => { const m = new WeakMap(); let n = 0; return o => o && typeof o === 'object' ? (m.get(o) || (m.set(o, ++n), n)) : 0; })();
function joinKey(meta, fc, keyCol) {
    return [tokOf(S.src), S.layerId, tokOf(fc), fc.features.length, keyCol, keyCol === LOCATION ? tokOf(S.areaOf.get(S.layerId)) : String(delimFor(keyCol, meta))].join('|');
}
let joined = null;   // { key, join, rowArea, rowAreas, unmatched, rowIndex }
const BIG_JOIN = 20000;

function recompute() {
    const meta = S.layers.get(S.layerId);
    const fc = S.geo.get(S.layerId);
    S.join = null; S.values = new Map(); S.classes = null; S.unmatched = []; S.rowAreas = null;
    if (S.src && fc) {
        const normalize = normalizerFor(meta, fc);
        const keyCol = pickKey(meta, fc, normalize);
        S.rowArea = new Array(S.src.rows.length).fill(null);
        const key = keyCol && joinKey(meta, fc, keyCol);
        const res = !keyCol ? null : joined?.key === key ? joined : (joined = { key, ...joinNow(meta, fc, keyCol, normalize) });
        if (res) { S.join = res.join; S.rowArea = res.rowArea; S.rowAreas = res.rowAreas; S.unmatched = res.unmatched; S.rowIndex = res.rowIndex; }
        updateRowLayer();
        if (!metricOptions().some(m => m.value === S.metric)) S.metric = 'count';
        for (const f of fc.features) S.values.set(f.id, statFor(f.id, S.metric));
        S.classes = classify([...S.values.values()].filter(v => v !== null && v > 0));
    }
    paint();
    renderPanel();
    renderTable();
    renderLabelControls();
    updateLabels();
}

// New classes only (method, log): the counts stay, so just re-class, repaint the areas, the legend,
// the list and the labels. Instant even with a big file.
function recolor() {
    if (!S.join) return recompute();
    S.classes = classify([...S.values.values()].filter(v => v !== null && v > 0));
    paint(); renderLegend(); renderList(); updateLabels();
}

// The join, all at once (JoinKit, as before): fine for files up to some tens of thousands of rows.
function joinNow(meta, fc, keyCol, normalize) {
    const out = { rowArea: new Array(S.src.rows.length).fill(null), rowAreas: null, unmatched: [] };
    if (keyCol === LOCATION) {
        const areas = areasForRows(S.layerId);
        const rows = S.src.rows.map((r, i) => ({ ...r, [AREA_COL]: areas[i] ?? '' }));
        out.rowIndex = new Map(rows.map((r, i) => [r, i]));
        out.join = JoinKit.buildJoin({ rows, headers: [...S.src.headers, AREA_COL], keyCol: AREA_COL, features: fc.features,
            propKey: '_jid', idOf: f => f.id });
        out.join.keyCol = keyCol;
        out.join.numericCols = out.join.numericCols.filter(c => !(S.src.geomCols || []).includes(c));
        areas.forEach((a, i) => { out.rowArea[i] = a; });
        const outside = S.src.points.filter((p, i) => p && areas[i] == null).length;
        out.unmatched = outside ? [{ label: 'Outside every area', n: outside }] : [];
        out.join.nullRows = S.src.points.filter(p => !p).length;
        return out;
    }
    const delimiter = delimFor(keyCol, meta);
    out.join = JoinKit.buildJoin({ rows: S.src.rows, headers: S.src.headers, keyCol, features: fc.features,
        propKey: meta.key, normalize, delimiter, idOf: f => f.id });
    out.join.keyCol = keyCol;
    out.join.numericCols = out.join.numericCols.filter(c => !(S.src.geomCols || []).includes(c));
    const idx = out.rowIndex = new Map(S.src.rows.map((r, i) => [r, i]));
    // Every area a row is in (several when its cell lists several), in the cell's order.
    out.rowAreas = S.src.rows.map(() => []);
    for (const [id, e] of Object.entries(out.join.byId)) for (const r of e.rows) { const i = idx.get(r); if (i != null && !out.rowAreas[i].includes(id)) out.rowAreas[i].push(id); }
    const order = new Map(fc.features.map(f => [f.id, f]));
    out.rowAreas.forEach((ids, i) => {
        if (ids.length > 1) { const keys = JoinKit.rowKeys(S.src.rows[i], keyCol, normalize, delimiter); ids.sort((a, b) => keys.indexOf(normalize(order.get(a)?.properties[meta.key])) - keys.indexOf(normalize(order.get(b)?.properties[meta.key]))); }
        out.rowArea[i] = ids[0] ?? null;
    });
    // Unmatched values with row counts, labelled with the text as it appears in the data.
    const index = JoinKit.buildFeatureIndex(fc.features, meta.key, { normalize, idOf: f => f.id });
    const tally = new Map();
    for (const row of S.src.rows) for (const raw of rawValues(row, keyCol, delimiter)) {
        const k = normalize(raw);
        if (!k || index.has(k)) continue;
        const t = tally.get(k) || { label: String(JoinKit.cellText(raw)).trim(), n: 0 };
        t.n++; tally.set(k, t);
    }
    out.unmatched = [...tally.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label));
    return out;
}

// The same join for big files (JoinKit.buildJoinChunked): one pass in chunks with a progress bar
// that places each row, adds its numbers to its areas' totals and tallies unmatched values.
async function joinInChunks(meta, fc, keyCol, normalize) {
    const label = meta.hex ? 'hexagons' : shortLabel(meta), loc = keyCol === LOCATION;
    const j = await JoinKit.buildJoinChunked({
        rows: S.src.rows, headers: S.src.headers, features: fc.features, idOf: f => f.id, exclude: S.src.geomCols || [],
        ...(loc ? { areaOf: areasForRows(S.layerId) } : { keyCol, propKey: meta.key, normalize, delimiter: delimFor(keyCol, meta) }),
        yieldFn: nextFrame,
        onProgress: (done, total) => toast(`Counting rows in ${label}`, { busy: true, progress: done / total, sub: `${done.toLocaleString()} of ${total.toLocaleString()}` }),
    });
    const join = { keyCol, byId: j.byId, numericCols: j.numericCols, currencyCols: j.currencyCols, matchedRows: j.matchedRows, nullRows: j.nullRows };
    let unmatched = j.unmatched;
    if (loc) {
        const areas = areasForRows(S.layerId), outside = S.src.points.filter((p, i) => p && areas[i] == null).length;
        join.nullRows = S.src.points.filter(p => !p).length;
        unmatched = outside ? [{ label: 'Outside every area', n: outside }] : [];
    }
    return { join, rowArea: j.rowArea, rowAreas: j.rowAreas, unmatched, rowIndex: rowIndexOf(S.src) };
}
const rowIndexCache = new WeakMap();
const rowIndexOf = src => rowIndexCache.get(src) || rowIndexCache.set(src, new Map(src.rows.map((r, i) => [r, i]))).get(src);

// Before recompute, for a big file: place rows and join them in chunks (with progress), so
// recompute finds the join ready. Small files skip this.
// Join (in chunks when big), then redraw; the toast goes once the map has drawn.
async function refresh() {
    const big = S.src && S.src.rows.length >= BIG_JOIN;
    await prepare();
    recompute();
    if (big) map.once('idle', () => toast(null));
}
async function prepare() {
    if (!S.src || S.src.rows.length < BIG_JOIN) return;
    const meta = S.layers.get(S.layerId), fc = S.geo.get(S.layerId);
    if (!fc) return;
    await placeRowsAsync(S.layerId);
    const normalize = normalizerFor(meta, fc);
    const keyCol = pickKey(meta, fc, normalize);
    if (!keyCol) return;
    const key = joinKey(meta, fc, keyCol);
    if (joined?.key !== key) joined = { key, ...(await joinInChunks(meta, fc, keyCol, normalize)) };
    toast(`Coloring ${meta.hex ? 'hexagons' : shortLabel(meta)}`, { busy: true }); await nextFrame();
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
    const opts = [{ value: 'count', label: 'Count', short: 'count' },
                  { value: 'pct_count', label: '% of total count', short: '% of count' }];
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
// Also: street segment ids (CNN), addresses, row numbers, ZIPs, parcels and census ids; and,
// from the data, numbers that count up 1, 2, 3… (row numbers) or are fixed-length codes
// (every value an integer with the same 5+ digits, mostly unique: CNNs, CDS codes, GEOIDs).
const ID_NAMES = /^(_airtable_id|id|fid|objectid|record ?id|row ?id|unique ?id|cnn|address|addr|street|source_?row|row|row_?(num|number|no)|index|zip|zip_?code|zipcode|postal_?code|apn|blklot|block|lot|parcel|geoid|fips|tract|phone)$|[\s_-](id|code|cnn|row|zip|address|geoid|fips|number|no)$/i;
// Address ranges, part numbers and the like are numbers but not stats.
const NOT_STAT = /^((address|addr|house|street)[\s_-]?(low|high|from|to|start|end|min|max|range|num|number)s?|parts?|nearby_cnns|cnns|year|latitude|longitude)$/i;
// Columns that name a place (ZIP, district, tract…), even with extra words like "zip (matched)".
const PLACE_WORDS = /\b(zip|zipcode|postal|district|supervisor|tract|geoid|fips|cnn|apn|blklot|parcel)\b/i;
function isIdColumn(col) {
    const base = col.includes(': ') ? col.split(': ').pop().trim() : col.trim();   // linked fields: "Link: Field"
    if (ID_NAMES.test(base) || NOT_STAT.test(base) || PLACE_WORDS.test(base)) return true;
    if (!S.src) return false;
    const memo = S.src._idCols || (S.src._idCols = new Map());
    if (!memo.has(col)) memo.set(col, looksLikeIds(S.src.rows.map(r => JoinKit.cellText(r[col]).trim()).filter(Boolean)));
    return memo.get(col);
}
function looksLikeIds(vals) {
    if (vals.length < 10 || !vals.every(v => /^\d+$/.test(v))) return false;
    const nums = vals.map(Number), uniq = new Set(nums);
    const sorted = [...uniq].sort((a, b) => a - b);
    if (uniq.size === nums.length && sorted[sorted.length - 1] - sorted[0] === sorted.length - 1) return true;   // 1, 2, 3…
    const len = vals[0].length;
    return len >= 5 && vals.every(v => v.length === len) && uniq.size / nums.length > 0.8;
}
// Coordinates are numbers but never amounts.
const isCoordColumn = col => /^(lat|lng|lon|long|latitude|longitude|x|y|point_?[xy])$|[\s_-](lat|lng|lon|latitude|longitude)$/i.test(col.trim());
const statLabel = s => metricOptions().find(m => m.value === s)?.label || s;
const metricLabel = () => statLabel(S.metric);

// Classes for the area colors: natural breaks (around gaps in the values), equal width (the same
// span of values each) or quantiles (the same number of areas each); with Log, natural breaks and
// equal width work on the values' logarithms, so a long tail doesn't squeeze everything else into
// the lightest class. Values are > 0 here.
const CLASS_METHODS = { jenks: 'Natural breaks', equal: 'Equal width', quantile: 'Quantiles' };
function classify(vals) {
    if (!vals.length) return null;
    const cb = JoinKit.classBreaks(vals, { method: S.classMethod, k: ramp().length, log: S.classLog });
    const offset = ramp().length - cb.k;   // few classes → use the darker end of the ramp
    return { classOf: v => (v === null || !(v > 0)) ? -1 : cb.classOf(v) + offset,
        ranges: cb.ranges.map(r => ({ ...r, c: r.cls + offset })), stats: cb.stats, method: cb.method, log: cb.log };
}

// "Hide areas without data": areas no row was placed in are left off the map, the labels and the list.
const hidingEmpty = () => !!(S.hideEmpty && S.src && S.join);
const isEmptyArea = id => hidingEmpty() && !S.join.byId[id];
let boundsKey = null;
function applyBoundsData() {
    const fc = S.geo.get(S.layerId);
    if (!fc) return;
    const key = hidingEmpty() ? S.layerId + '|' + Object.keys(S.join.byId).sort().join(',') : S.layerId + '|all|' + fc.features.length;
    if (key === boundsKey) return;
    boundsKey = key;
    map.getSource('bounds').setData(hidingEmpty() ? { type: 'FeatureCollection', features: fc.features.filter(f => S.join.byId[f.id]) } : fc);
}

function paint() {
    const fc = S.geo.get(S.layerId);
    if (!fc) return;
    applyBoundsData();
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

// Numbers, as in Selecter: abbreviated values (1K, 1M, 1B, 1T) get one decimal below 100
// of the unit and none above ($79.4K, $104K, 1.2M); plain values get two decimals below 1,
// one below 100 and none above. Dollar amounts never show cents.
const NF = [];   // number formats by decimals: toLocaleString builds one per call, slow over thousands of labels
function fmtNumber(v, { money = false, abbrev = false, whole = false } = {}) {
    if (v === null || v === undefined || !isFinite(v)) return '—';
    const a = Math.abs(v), sign = v < 0 ? '-' : '';
    const dec = (x, max) => (NF[max] ||= new Intl.NumberFormat('en-US', { maximumFractionDigits: max, minimumFractionDigits: 0 })).format(x);
    let out;
    const unit = abbrev && [[1e12, 'T'], [1e9, 'B'], [1e6, 'M'], [1e3, 'K']].find(([d]) => a >= d);
    if (unit) { const u = a / unit[0]; out = (u >= 100 ? String(Math.round(u)) : String(+u.toFixed(1))) + unit[1]; }
    else if (money || whole) out = dec(Math.round(a), 0);
    else out = dec(a, a < 1 ? 2 : a < 100 ? 1 : 0);
    if (out === '0' && a > 0 && !money) out = a < 0.01 ? '<0.01' : out;
    return sign + (money ? '$' : '') + out;
}
const fmtPct = v => (v === 0 ? '0' : v < 0.1 ? '<0.1' : v.toFixed(1)) + '%';

function fmt(v, stat = S.metric) {
    if (v === null || v === undefined) return '—';
    if (stat.startsWith('pct_')) return fmtPct(v);
    return fmtNumber(v, { money: isMoney(stat), whole: !/^avg_/.test(stat) && Number.isInteger(v) });
}

// Short form for map labels: $104K, $79.4K, 1.2M.
function fmtShort(v, stat) {
    if (v === null || v === undefined) return '—';
    if (stat.startsWith('pct_')) return fmtPct(v);
    return fmtNumber(v, { money: isMoney(stat), abbrev: true });
}

// A column of dollar amounts (for rows colored or sized by it).
function isMoneyCol(col) {
    if (!S.src) return false;
    const memo = S.src._money || (S.src._money = new Map());
    if (!memo.has(col)) memo.set(col, JoinKit.classifyColumns(sampleRows(), [col]).currencyCols.has(col));
    return memo.get(col);
}
const fmtCol = (v, col) => fmtNumber(v, { money: isMoneyCol(col) });
// A cell as shown in popups, lists and row labels: dollar amounts without cents.
function cellShow(v) {
    const t = JoinKit.cellText(v);
    const m = /^\s*(-?)\$\s?([\d,]+(?:\.\d+)?)\s*$/.exec(t);
    return m ? m[1] + '$' + Math.round(Number(m[2].replace(/,/g, ''))).toLocaleString('en-US') : t;
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
    if (S.labels) ids = S.labels.filter(id => avail.has(id) && !(id === 'id' && S.layers.get(S.layerId).hex));
    else {
        const meta = S.layers.get(S.layerId);
        ids = [...(meta.hex ? [] : ['id']), ...(S.src && S.join ? [S.metric] : []), ...(meta.labelExtras || []).filter(x => x.default).map(x => 'x:' + x.id)];
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
    if (!S.revealAll) for (let i = 2; i < nLines; i++) z.add(S.homeZoom + CONFIG.revealAfter + (i - 2) * CONFIG.revealStep);
    if (S.prefix) z.add(S.prefixZoom);
    return [...z].sort((a, b) => a - b);
}
const visibleLines = (n, zoom) => n <= 2 || S.revealAll ? n : 2 + [...Array(n - 2).keys()].filter(i => zoom >= S.homeZoom + CONFIG.revealAfter + i * CONFIG.revealStep - 1e-6).length;

function updateLabels() {
    const fc = S.geo.get(S.layerId);
    if (!fc || !map.getSource('labels')) return;
    const fields = activeLabelFields(), meta = S.layers.get(S.layerId);
    const steps = labelSteps(fields.length);
    const zooms = [-Infinity, ...steps];
    const anchors = S.anchors.get(S.layerId);
    const ranked = [...fc.features].sort((a, b) => anchors.get(b.id).area - anchors.get(a.id).area);
    const rank = new Map(ranked.map((f, i) => [f.id, i]));
    const features = fc.features.filter(f => !isEmptyArea(f.id) && !(meta.hex && !(S.values.get(f.id) > 0))).map(f => {   // empty hexagons have no label
        const texts = fields.map(fl => labelText(fl, f));
        const a = anchors.get(f.id).area * 111 * 88;
        const props = { _rank: rank.get(f.id), _ts: Math.max(0.85, Math.min(1.2, Math.sqrt(a / (S._medianArea || a)) ** 0.5)), ...labelColors(f.id) };
        zooms.forEach((z, k) => {
            const n = visibleLines(fields.length, z), pre = S.prefix && z >= S.prefixZoom - 1e-6;
            const lines = fields.slice(0, n).map((fl, i) => {
                const t = texts[i];
                if (!t) return '';
                return pre && fl.prefix ? `${fl.prefix}: ${t}` : t;
            });
            if (meta.hex && !(S.values.get(f.id) > 0)) { props['_h' + k] = props['_r' + k] = ''; return; }
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

// Contrast ratio (WCAG) between two colors.
const contrast = (a, b) => { const [x, y] = [luminance(a), luminance(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
// Label colors on an area: dark text with a white halo on light fills, white text with a dark
// halo on dark ones, whichever has more contrast. With the areas hidden, labels are dark.
function labelColors(id) {
    const fixed = CONFIG.labelColors[S.labelColor];
    if (fixed) return { _lc: fixed.text, _hc: fixed.halo, _hw: fixed.width };
    const c = S.classes && S.showAreas ? S.classes.classOf(S.values.get(id)) : -1;
    const fill = c >= 0 ? ramp()[c] : CONFIG.nodata, ink = '#1E2340';
    return contrast('#ffffff', fill) > contrast(ink, fill)
        ? { _lc: '#ffffff', _hc: 'rgba(10,22,56,0.45)', _hw: 1 }
        : { _lc: ink, _hc: 'rgba(255,255,255,0.9)', _hw: 2.5 };
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
    if (!S.revealAll) for (let i = 2; i < n; i++) hints.push(`line ${i + 1} from zoom ${S.homeZoom + CONFIG.revealAfter + (i - 2) * CONFIG.revealStep}`);
    if (hints.length) hints[0] = hints[0][0].toUpperCase() + hints[0].slice(1);
    $('labels-n').textContent = activeLabelFields().map(f => f.label).join(', ') || 'none';
    $('labels-top-n').textContent = $('labels-n').textContent;
    $('label-hint').textContent = hints.length ? hints.join(', ') + '.' : '';
    $('prefix-check').checked = S.prefix;
    $('prefix-zoom').value = S.prefixZoom;
    $('prefix-zoom').disabled = !S.prefix;
    $('prefix-zoom-val').textContent = S.prefixZoom;
    $('label-auto').hidden = !S.labels;
    $('roads-check').checked = S.basemap.roads;
    $('hoods-check').checked = S.basemap.places;
    $('areas-check').checked = S.showAreas;
    renderPaletteSeg();
    $('size-seg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.size === S.labelSize));
    $('reveal-seg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', (b.dataset.reveal === 'all') === S.revealAll));
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
        : rc.type === 'numeric' ? `A number: ${rc.colors.length} classes by natural breaks, on the ${rowRampPal().label.toLowerCase()} ramp so rows stand out from the areas.`
        : `${rc.cats.length} most common values${rc.otherN ? ', the rest as Other' : ''}.` + (rc.cats.length > 3 ? ' More than 3 colors can be hard to tell apart; hover names the value.' : '');
    const nums = JoinKit.classifyColumns(sampleRows(), cols).numericCols.filter(c => !isIdColumn(c) && !isCoordColumn(c));
    $('row-size').innerHTML = `<option value="">Same size</option>` + nums.map(c => `<option value="${esc(c)}"${c === S.rowStyle.sizeBy ? ' selected' : ''}>${esc(c)}</option>`).join('');
    $('size-log').checked = !!S.rowStyle.sizeLog;
    $('size-log').disabled = !S.rowStyle.sizeBy;
    const z = S.rowSizes;
    $('row-size-hint').textContent = !nums.length ? 'No numeric columns.' : !z ? 'Size points by a number.'
        : `${fmtCol(z.min, z.col)} to ${fmtCol(z.max, z.col)}; ` + (z.log ? 'log scale, so small values stay visible.' : 'circle area follows the value.');
    $('psize-seg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.psize === sizeNow()));
    $('psize-name').textContent = $('psize-seg').querySelector(`[data-psize="${sizeNow()}"]`)?.title || '';
    $('pstyle-seg').querySelectorAll('button').forEach(b => {
        const on = b.dataset.pstyle === styleNow().replace('-w', '');
        b.setAttribute('aria-pressed', on);
        b.classList.toggle('w', on && styleNow().endsWith('-w'));
        if (b.dataset.pstyle === 'ring' || b.dataset.pstyle === 'ghost') b.title = `${CONFIG.pointStyles[b.dataset.pstyle]} (click again for white)`;
    });
    $('pstyle-name').textContent = CONFIG.pointStyles[styleNow()];
    $('crowd-check').checked = S.crowd;
    const located = S.src.points.filter(Boolean).length;
    $('look-hint').hidden = !S.fileLook;
    if (S.fileLook) $('look-hint').textContent = `${located.toLocaleString()} rows with a location: drawn ${S.fileLook.size === 'pinpoint' ? 'as pinpoints' : 'as set here'} for this file${S.autoHid ? ', and hidden until you show them' : ''}.`;
    const labs = S.rowStyle.labels;
    $('rowlabels-n').textContent = labs.length ? labs.join(', ') : 'none';
    $('row-label-chips').innerHTML = cols.map(c => {
        const i = labs.indexOf(c);
        return `<button type="button" class="chip" data-col="${esc(c)}" title="${esc(c)}" aria-pressed="${i >= 0}">${i >= 0 ? `<b>${i + 1}</b>` : ''}<span>${esc(c)}</span></button>`;
    }).join('');
}

function renderPaletteSeg() {   // the same picker under Color by and in Format areas & map
    const html = Object.entries(CONFIG.palettes).map(([k, p]) =>
        `<button type="button" data-palette="${k}" aria-pressed="${k === S.palette}" title="${esc(p.label)}"><i style="background:linear-gradient(90deg,${p.ramp.join(',')})"></i>${esc(p.label)}</button>`).join('');
    document.querySelectorAll('.palette-seg').forEach(el => { el.innerHTML = html; });
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
    if (S.src) {   // the source's name as the card title; when collapsed, the match and color in brief
        $('src-title').textContent = S.src.name;
        const placed = (S.rowArea || []).filter(x => x != null).length, by = S.join?.keyCol === LOCATION ? 'location' : S.join?.keyCol;
        $('src-meta').textContent = `${S.src.rows.length.toLocaleString()} rows · ${placed.toLocaleString()} placed` + (by ? ` by ${by}` : '') + ` · color: ${metricLabel()}`;
    }

    if (S.src) {
        const total = S.src.rows.length;
        const byLoc = S.join?.keyCol === LOCATION, loc = S.candidates.find(c => c.col === LOCATION);
        $('loc-row').hidden = !loc;
        $('loc-check').checked = byLoc;
        if (loc) $('loc-n').textContent = `${loc.hits.toLocaleString()} of ${total.toLocaleString()} inside one`;
        $('loc-label').textContent = `Location (inside the ${oneArea()})`;
        const cols = S.candidates.filter(c => c.col !== LOCATION), shown = S.colKeys[S.layerId];
        $('key-select').innerHTML = cols.map(c => `<option value="${esc(c.col)}"${c.col === shown ? ' selected' : ''}>${esc(c.col)}${c.hits ? ` — ${c.approx ? 'about ' : ''}${c.hits.toLocaleString()} of ${total.toLocaleString()} rows match` : ''}</option>`).join('')
            + (shown ? '' : '<option value="" selected>— no column matches this layer —</option>');
        $('key-select').disabled = byLoc;
        $('key-row').classList.toggle('off', byLoc);
        const meta = S.layers.get(S.layerId);
        $('key-hint').textContent = byLoc
            ? `Each row is placed in the ${meta.hex ? 'hexagon' : 'area'} that contains its location (${S.src.geomFrom}).`
                + (S.src.geoms?.some(g => g && /LineString/.test(g.type)) ? ' Lines are placed, and counted, by their midpoint.' : '')
                + ' Turn this off to match by a column.'
            : `Compared with ${shortLabel(meta)} “${meta.key}”` + (delimFor(S.join?.keyCol, meta) === MULTI ? '; cells listing several (split on commas, semicolons or line breaks) count toward each' : meta.match?.delimiter ? `; cells with “${meta.match.delimiter}” count toward each value` : '') + '.';
        $('metric-select').innerHTML = metricOptions().map(m => `<option value="${esc(m.value)}"${m.value === S.metric ? ' selected' : ''}>${esc(m.label)}</option>`).join('');
        $('metric-select').disabled = !S.join;
        $('metric-hint').textContent = S.metric.startsWith('pct_') ? `Share of the total across all ${total.toLocaleString()} rows, including rows that matched no area.` +
            (delimFor(S.join?.keyCol, meta) ? ' A row listed in two areas counts in both, so shares can add up to more than 100%.' : '') : '';

        if (S.join) {
            const j = S.join, unmatchedRows = total - j.matchedRows - j.nullRows;
            const pct = Math.round(j.matchedRows / total * 100);
            const areas = Object.keys(j.byId).length, nAreas = S.geo.get(S.layerId).features.length;
            $('match-summary').innerHTML = `<b>${j.matchedRows.toLocaleString()}</b> of ${total.toLocaleString()} rows placed (${pct}%) in <b>${areas}</b> of ${nAreas} areas
                <div class="bar-track"><div class="bar-fill" style="width:${pct}%"></div></div>
                <span class="hint">${unmatchedRows ? (j.keyCol === LOCATION ? `${unmatchedRows} rows are outside every area` : `${unmatchedRows} rows have a value that matches no area`) : 'Every row placed'}${j.nullRows ? ` · ${j.nullRows} rows have ${j.keyCol === LOCATION ? 'no location' : 'a blank value'}` : ''}</span>`;
            const nEmpty = nAreas - areas;
            $('empty-row').hidden = !nEmpty || !!S.layers.get(S.layerId).hex;
            $('empty-check').checked = S.hideEmpty;
            $('empty-n').textContent = `${nEmpty.toLocaleString()} area${nEmpty === 1 ? '' : 's'}`;
            const um = $('unmatched');
            um.hidden = !S.unmatched.length;
            um.querySelector('summary').textContent = S.join.keyCol === LOCATION ? `${S.unmatched[0]?.n || 0} rows outside every area`
                : `${S.unmatched.length} unmatched value${S.unmatched.length === 1 ? '' : 's'}`;
            um.querySelector('ul').innerHTML = S.unmatched.map(u => `<li><span>${esc(u.label)}</span><span>${u.n}</span></li>`).join('');
        } else {
            $('match-summary').innerHTML = `<span class="hint">No column in ${esc(S.src.name)} matches ${esc(shortLabel(S.layers.get(S.layerId)))}. Try another tab, or pick a column above.</span>`;
            $('unmatched').hidden = true;
            $('empty-row').hidden = true;
        }
    }
    $('clear-btn').hidden = !S.src;
    $('table-toggle').hidden = !S.src;
    if (!S.src && T.open) setTableOpen(false);
    syncBarToggles();
    renderList();
}

const NAME_ORDER = new Intl.Collator('en', { numeric: true });   // one collator: localeCompare with options builds one per call
function renderList() {
    const fc = S.geo.get(S.layerId);
    if (!fc) return;
    const showV = !!(S.src && S.join);
    const listExtras = extrasWith('list');
    const meta = S.layers.get(S.layerId);
    const friendly = f => meta.hex && S.hex.label !== 'h3' && f.properties.hood;   // name the area, code beside it
    const rows = fc.features.map(f => ({ id: f.id, name: friendly(f) ? f.properties.hood : String(nameOf(f)), v: S.values.get(f.id) ?? null,
        sub: [friendly(f) ? f.properties.code : '', ...listExtras.map(x => extraValue(x, f))].filter(Boolean).join(' · ') }));
    let list = rows;
    if (meta.hex) list = showV ? rows.filter(r => r.v > 0) : [];
    else if (hidingEmpty()) list = rows.filter(r => !isEmptyArea(r.id));
    const max = Math.max(0, ...list.map(r => r.v || 0));
    list.sort(S.sort === 'name' || !showV ? (a, b) => NAME_ORDER.compare(a.name, b.name)
        : (a, b) => (b.v ?? -Infinity) - (a.v ?? -Infinity) || NAME_ORDER.compare(a.name, b.name));
    // Thousands of hexagons: list the first 500 (the open one always), and say so.
    const LIST_MAX = 500, total = list.length;
    if (meta.hex && total > LIST_MAX) { const open = list.find(r => r.id === S.expanded); list = list.slice(0, LIST_MAX); if (open && !list.includes(open)) list.push(open); }
    $('area-list').innerHTML = (meta.hex ? `<li class="note">${showV ? `${total.toLocaleString()} of ${rows.length.toLocaleString()} hexagons have rows${total > LIST_MAX ? ` · first ${LIST_MAX} listed` : ''}` : `${rows.length.toLocaleString()} hexagons at resolution ${S.hexRes}`}</li>` : '') + list.map(r => {
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
        `<li data-row="${it.i ?? ''}" class="${it.i != null && S.src.points?.[it.i] ? 'has-loc' : ''}${it.i != null && it.i === cardPinned ? ' cur' : ''}"><span>${esc(title(it))}</span>${perRow ? `<span class="iv">${it.v === null ? '—' : fmt(it.v, 'sum_' + col)}</span>` : ''}</li>`).join('')}
        ${items.length > MAX ? `<li class="none">and ${items.length - MAX} more</li>` : ''}</ul>`;
}

// The legend folds to one bar per layer (the ▸ in its heading): the classes as equal blocks,
// min and max at the ends, the median as a line and the mean as a diamond where they fall.
const legendHead = () => `<button type="button" class="lg-fold" aria-expanded="${!S.legendCompact}" title="${S.legendCompact ? 'Show every class' : 'Fold to one bar per layer'}">Legend</button>`;
function renderLegend() {
    const lg = $('legend');
    if (!S.src || (!S.join && !S.rowClasses && !S.rowSizes)) { lg.hidden = true; return; }
    lg.classList.toggle('compact', S.legendCompact);
    if (S.legendCompact) { const h = compactLegendHTML(); lg.hidden = !h; lg.innerHTML = h && legendHead() + h; return; }
    if (!S.join || !S.showAreas) { const h = rowLegendHTML(); lg.hidden = !h; lg.innerHTML = h && legendHead() + h; return; }
    lg.hidden = false;
    const zeroLabel = S.metric.startsWith('avg_') ? 'No rows' : fmt(0);
    const nZero = [...S.values.values()].filter(v => !(v > 0)).length;
    lg.innerHTML = legendHead() + `<h4>${esc(metricLabel())}</h4>` + [...(S.classes?.ranges || [])].reverse().map(r =>
        `<div class="row"><i style="background:${ramp()[r.c]}"></i><span>${r.lo === r.hi ? fmtShort(r.hi, S.metric) : `${fmtShort(r.lo, S.metric)} – ${fmtShort(r.hi, S.metric)}`}</span><span class="n">${r.n}</span></div>`).join('')
        + `<div class="row"><i class="clear"></i><span>${zeroLabel}${hidingEmpty() ? ' (hidden)' : ''}</span><span class="n">${nZero}</span></div>`
        + `<div class="foot">${CLASS_METHODS[S.classes?.method] || 'Natural breaks'}${S.classes?.log ? ' · log' : ''} · areas per class</div>` + rowLegendHTML();
}

function compactLegendHTML() {
    const parts = [];
    const meta = S.layers.get(S.layerId);
    if (S.join && S.showAreas && S.classes) {
        const nZero = [...S.values.values()].filter(v => !(v > 0)).length;
        const unit = meta.hex ? 'hexagons' : 'areas';
        parts.push(legendBar({ name: metricLabel(), right: `${S.classes.stats.n.toLocaleString()} ${unit}${nZero ? ` · ${nZero.toLocaleString()} empty` : ''}`,
            blocks: S.classes.ranges.map(r => ({ color: ramp()[r.c], lo: r.lo, hi: r.hi })), stats: S.classes.stats, f: v => fmtShort(v, S.metric) }));
    }
    const rc = S.rowClasses;
    if (rc?.type === 'numeric') parts.push(legendBar({ name: `Features · ${rc.col}`, right: rc.stats.n.toLocaleString() + (rc.none ? ` · ${rc.none.toLocaleString()} blank` : ''),
        blocks: rc.ranges.map(r => ({ color: r.color, lo: r.lo, hi: r.hi })), stats: rc.stats, f: v => fmtCol(v, rc.col) }));
    else if (rc) parts.push(`<div class="lg-row"><div class="lg-name">Features · ${esc(rc.col)}</div><div class="lg-cats">`
        + rc.cats.map(c => `<span><i style="background:${c.color}"></i>${esc(c.v)}</span>`).join('')
        + (rc.otherN ? `<span><i style="background:${CONFIG.other}"></i>Other</span>` : '') + '</div></div>');
    if (!parts.length) return sizeLegendHTML();
    const anyBar = parts.some(p => p.includes('lg-bar'));
    return parts.join('') + sizeLegendHTML() + (anyBar ? '<div class="lg-key"><span><i class="med"></i>median</span><span><i class="mean"></i>mean</span></div>' : '');
}
// One bar: equal blocks per class; a value's place is its class plus how far it is through it.
function legendBar({ name, right, blocks, stats, f }) {
    const k = blocks.length;
    const at = v => {
        for (let j = 0; j < k; j++) {
            const b = blocks[j];
            if (v <= b.hi) return 100 * (j + (v < b.lo ? 0 : b.hi > b.lo ? (v - b.lo) / (b.hi - b.lo) : 0.5)) / k;
        }
        return 100;
    };
    const med = at(stats.median), mean = at(stats.mean);
    // Labels under the markers: one shared label when they're close; kept clear of the ends.
    const clamp = x => Math.max(16, Math.min(84, x));
    const same = f(stats.median) === f(stats.mean);
    let labs = Math.abs(med - mean) < 16 || same
        ? [{ x: clamp((med + mean) / 2), t: same ? f(stats.median) : `${f(stats.median)} · ${f(stats.mean)}` }]
        : [{ x: clamp(med), t: f(stats.median) }, { x: clamp(mean), t: f(stats.mean) }];
    labs = labs.filter(l => l.t !== f(stats.min) && l.t !== f(stats.max));   // already shown at an end
    return `<div class="lg-row" title="Min ${esc(f(stats.min))} · median ${esc(f(stats.median))} · mean ${esc(f(stats.mean))} · max ${esc(f(stats.max))}">
        <div class="lg-name">${esc(name)}<span>${esc(right)}</span></div>
        <div class="lg-bar">${blocks.map(b => `<b style="background:${b.color}"></b>`).join('')}<span class="mk med" style="left:${med}%"></span><span class="mk mean" style="left:${mean}%"></span></div>
        <div class="lg-ticks"><span class="l">${esc(f(stats.min))}</span>${labs.map(l => `<span class="m" style="left:${l.x}%">${esc(l.t)}</span>`).join('')}<span class="r">${esc(f(stats.max))}</span></div></div>`;
}

function rowLegendHTML() {
    const rc = S.rowClasses;
    if (!rc) return S.rowSizes ? `<h4 class="rows-h">Rows</h4>` + sizeLegendHTML() : '';
    const dot = c => `<i class="dot" style="background:${c}"></i>`;
    const rows = rc.type === 'numeric'
        ? [...rc.ranges].reverse().map(r => `<div class="row">${dot(r.color)}<span>${r.lo === r.hi ? fmtCol(r.hi, rc.col) : `${fmtCol(r.lo, rc.col)} – ${fmtCol(r.hi, rc.col)}`}</span><span class="n">${r.n}</span></div>`)
        : rc.cats.map(c => `<div class="row">${dot(c.color)}<span>${esc(c.v)}</span><span class="n">${c.n}</span></div>`)
            .concat(rc.otherN ? [`<div class="row">${dot(CONFIG.other)}<span>Other</span><span class="n">${rc.otherN}</span></div>`] : []);
    if (rc.none) rows.push(`<div class="row">${dot(CONFIG.other)}<span>No value</span><span class="n">${rc.none}</span></div>`);
    return `<h4 class="rows-h">Rows: ${esc(rc.col)}</h4>` + rows.join('') + sizeLegendHTML();
}
function sizeLegendHTML() {
    const z = S.rowSizes;
    if (!z) return '';
    return `<div class="foot">Size: ${esc(z.col)}${z.log ? ' (log)' : ''} · ${fmtCol(z.min, z.col)} – ${fmtCol(z.max, z.col)}</div>`;
}

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

// Highlight rows on the map: those in an area ({ area }) or one row ({ row }); null clears.
let hlKey = null;
function hlRows(t) {
    const key = t ? (t.area != null ? 'a:' + t.area : 'r:' + t.row) : null;
    if (key === hlKey || !map.getSource('rows-hl')) return;
    hlKey = key;
    let feats = [];
    if (t && S.src?.geoms && S.basemap.points) {
        const idx = t.row != null ? [t.row] : S.rowArea.map((a, i) => a === t.area ? i : -1).filter(i => i >= 0);
        feats = idx.slice(0, 5000).filter(i => S.src.geoms[i]).map(i => ({ type: 'Feature', geometry: S.src.geoms[i], properties: { _s: sizeOf(i) } }));
    }
    map.getSource('rows-hl').setData({ type: 'FeatureCollection', features: feats });
}

// Hovering a row that lists several areas lights them all; id is the main one (outlined in the list).
S.hoverAlso = [];
function setHoverRow(i, main) {
    const ids = i == null ? [] : areasOfRow(i);
    setHover(main ?? ids[0] ?? null);
    for (const id of S.hoverAlso) if (id !== S.hoverId) map.setFeatureState({ source: 'bounds', id }, { hover: false });
    S.hoverAlso = ids.filter(id => id !== S.hoverId);
    for (const id of S.hoverAlso) map.setFeatureState({ source: 'bounds', id }, { hover: true });
}
function setHover(id) {
    if (S.hoverAlso?.length && id !== S.hoverId) { for (const a of S.hoverAlso) if (a !== id) map.setFeatureState({ source: 'bounds', id: a }, { hover: false }); S.hoverAlso = []; }
    if (id === S.hoverId) return;
    if (S.hoverId !== null) map.setFeatureState({ source: 'bounds', id: S.hoverId }, { hover: false });
    S.hoverId = id;
    if (id !== null) map.setFeatureState({ source: 'bounds', id }, { hover: true });
    document.querySelectorAll('#area-list li.hover').forEach(li => li.classList.remove('hover'));
    if (id !== null) document.querySelector(`#area-list li[data-id="${CSS.escape(id)}"]`)?.classList.add('hover');
}

// ═════════════════════════════════════════════════════════════════════════
// Table (bottom drawer)
// ═════════════════════════════════════════════════════════════════════════
// Every row of the file, sortable. Show: all rows, the rows in the selected area, or those in view.
// Hovering a row highlights it on the map (or its area); hovering a feature on the map highlights
// its row here; clicking a row goes to it.
const TABLE_MAX = 1000;
// Below the map (height defaults to about three rows) or beside it (width). The area and name
// columns stay put while scrolling sideways.
const T = { open: false, filter: 'all', sort: null, dir: 1, dock: 'bottom', height: 160, width: 460, pin: null, shown: [] };
const AREA_SORT = '__area';
const saveTablePrefs = () => store.set('tableDock', { open: T.open, dock: T.dock, height: T.height, width: T.width });
function applyTableDock() {
    const wrap = document.querySelector('.map-wrap'), side = T.dock === 'side';
    wrap.classList.toggle('side-dock', side && T.open);
    wrap.style.setProperty('--drawer', T.open && !side ? T.height + 'px' : '0px');
    wrap.style.setProperty('--drawer-w', T.open && side ? T.width + 'px' : '0px');
    $('dock-seg').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.dock === T.dock));
    map.resize();
}
function tableCols() {
    // Every column but internal ones and raw geometry text (WKT); latitude/longitude stay.
    // The row's name column comes first.
    const cols = (S.src?.headers || []).filter(h => !h.startsWith('_') && !/^(wkt|geom|geometry|the_geom|shape)$/i.test(h.trim()) && !(S.src.geomCols || []).includes(h) && !/: (wkt|geom|geometry|the_geom|shape)$/i.test(h));
    const name = rowLabelCol();
    return cols.includes(name) ? [name, ...cols.filter(c => c !== name)] : cols;
}
function setTableOpen(on) {
    T.open = on && !!S.src;
    $('table-drawer').hidden = !T.open;
    $('table-toggle').setAttribute('aria-pressed', T.open);
    applyTableDock();
    saveTablePrefs();
    if (T.open) renderTable();
}
function tableRowIdx() {
    const n = S.src?.rows.length || 0;
    let idx = [...Array(n).keys()];
    if (T.filter === 'area') idx = S.selectedId == null ? [] : idx.filter(i => areasOfRow(i).includes(S.selectedId));
    else if (T.filter === 'view') {
        const b = map.getBounds();
        idx = idx.filter(i => { const p = S.src.points?.[i]; return p && b.contains(p); });
    }
    if (T.sort) {
        const c = T.sort, num = c !== AREA_SORT && JoinKit.classifyColumns(sampleRows(), [c]).numericCols.length > 0;
        const key = c === AREA_SORT ? i => (S.rowArea[i] != null ? areaName(S.rowArea[i]) || '' : '').toLowerCase()
            : i => { const v = S.src.rows[i][c]; return num ? JoinKit.parseNum(v) : JoinKit.cellText(v).toLowerCase(); };
        idx.sort((a, b) => { const x = key(a), y = key(b); return (x === null || x === '') - (y === null || y === '') || (x < y ? -T.dir : x > y ? T.dir : 0); });
    }
    return idx;
}
function renderTable() {
    if (!T.open || !S.src) return;
    const cols = tableCols(), idx = tableRowIdx(), shown = T.shown = idx.slice(0, TABLE_MAX);
    const area = i => areaNamesOf(i).join(', ');
    $('table-count').textContent = `${idx.length.toLocaleString()} of ${S.src.rows.length.toLocaleString()} rows`
        + (T.filter === 'area' ? (S.selectedId == null ? ' · click an area to show its rows' : ` in ${areaName(S.selectedId)}`) : T.filter === 'view' ? ' in view' : '')
        + (idx.length > TABLE_MAX ? ` · showing the first ${TABLE_MAX.toLocaleString()}` : '');
    $('table-filter').querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.filter === T.filter));
    // Every header sorts. One column is pinned at the left while scrolling sideways: the row's name
    // column to start; the pin in any header moves it there.
    const sortCls = c => T.sort === c ? (T.dir > 0 ? 'asc' : 'desc') : '';
    const areaLabel = shortLabel(S.layers.get(S.layerId));
    const all = [AREA_SORT, ...cols];
    const pinned = all.includes(T.pin) ? T.pin : (cols.includes(rowLabelCol()) ? rowLabelCol() : AREA_SORT);
    const order = [pinned, ...all.filter(c => c !== pinned)];
    const title = c => c === AREA_SORT ? areaLabel : c;
    const PIN = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10.5 1.5l4 4-2 1-2.6 2.6.4 3.2-1.3 1.2-3-3L2 14.5l-.5-.5 4-4-3-3 1.2-1.3 3.2.4L9.5 3.5z"/></svg>';
    const head = `<tr>${order.map(c => `<th data-col="${esc(c)}" class="${sortCls(c)}${c === pinned ? ' pinned' : ''}${c === AREA_SORT ? ' area' : ''}" title="Sort by ${esc(title(c))}"><span class="th-t">${esc(title(c))}</span><button type="button" class="pin" data-pin="${esc(c)}" title="${c === pinned ? 'Pinned at the left' : 'Pin this column at the left'}" aria-pressed="${c === pinned}">${PIN}</button></th>`).join('')}</tr>`;
    const cell = (i, c) => {
        if (c === AREA_SORT) return `<td class="area${c === pinned ? ' pinned' : ''}">${esc(area(i))}</td>`;
        const t = cellShow(S.src.rows[i][c]);
        return `<td class="${c === pinned ? 'pinned' : ''}" title="${esc(t.length > 40 ? t : '')}">${esc(t)}</td>`;
    };
    const body = shown.map(i => `<tr data-row="${i}" class="${S.src.points?.[i] ? 'has-loc' : ''}">${order.map(c => cell(i, c)).join('')}</tr>`).join('');
    const grid = $('table-grid');
    grid.innerHTML = `<thead>${head}</thead><tbody>${body}</tbody>`;
}
// An area hovered in the list: tint its rows in the table.
let tableAreaId = null;
function tableAreaHover(id) {
    if (id === tableAreaId) return;
    tableAreaId = id;
    if (!T.open) return;
    const grid = $('table-grid');
    grid.querySelectorAll('tr.hl-area').forEach(tr => tr.classList.remove('hl-area'));
    if (id == null) return;
    for (const tr of grid.tBodies[0]?.rows || []) if (areasOfRow(+tr.dataset.row).includes(id)) tr.classList.add('hl-area');
}
// A feature hovered on the map: highlight and reveal its row.
let tableHoverRow = null;
function tableHover(i) {
    if (!T.open || i === tableHoverRow) return;
    const grid = $('table-grid');
    grid.querySelector('tr.hl')?.classList.remove('hl');
    tableHoverRow = i;
    if (i == null) return;
    const tr = grid.querySelector(`tr[data-row="${i}"]`);
    if (tr) {   // scroll vertically only, so the columns in view stay put
        tr.classList.add('hl');
        const box = tr.closest('.table-scroll'), head = grid.tHead?.offsetHeight || 0;
        if (tr.offsetTop - head < box.scrollTop) box.scrollTop = tr.offsetTop - head;
        else if (tr.offsetTop + tr.offsetHeight > box.scrollTop + box.clientHeight) box.scrollTop = tr.offsetTop + tr.offsetHeight - box.clientHeight;
    }
}

// A row listing several areas: the others are marked too (as selected), until the next selection.
S.alsoSel = [];
function selectAlso(ids) {
    for (const id of S.alsoSel) if (id !== S.selectedId) map.setFeatureState({ source: 'bounds', id }, { selected: false });
    S.alsoSel = ids.filter(id => id !== S.selectedId);
    for (const id of S.alsoSel) map.setFeatureState({ source: 'bounds', id }, { selected: true });
}
function select(id, { lngLat, fromPopup = false, fly = false, noPopup = false } = {}) {
    selectAlso([]);
    if (S.selectedId !== null) map.setFeatureState({ source: 'bounds', id: S.selectedId }, { selected: false });
    S.selectedId = id;
    document.querySelectorAll('#area-list li.selected').forEach(li => li.classList.remove('selected'));
    if (id === null) { if (!fromPopup) popup.remove(); return; }
    map.setFeatureState({ source: 'bounds', id }, { selected: true });
    if (T.filter === 'area') renderTable();
    const li = document.querySelector(`#area-list li[data-id="${CSS.escape(id)}"]`);
    li?.classList.add('selected');
    if (!fly) li?.scrollIntoView({ block: 'nearest' });
    const f = S.geo.get(S.layerId).features.find(f => f.id === id);
    const { fit, anchor } = S.anchors.get(S.layerId).get(id);
    // Hexagons pan without zooming: a new zoom would bring a different grid under the cursor.
    if (fly && isHex(S.layerId)) map.easeTo({ center: anchor, duration: 500 });
    else if (fly) map.fitBounds([[fit[0], fit[1]], [fit[2], fit[3]]], { padding: 80, maxZoom: 15, duration: 500 });
    if (noPopup) popup.remove();   // areas don't get a popup: their rows are in the list
}

// Where to zoom, where to pin a popup or label, and how big an area is. Small outlying
// parts (Treasure Island, the Farallones, rocks in the bay) are left out of the zoom, and
// the anchor is a point inside the largest part rather than a bbox center in the water.
// clip: the layer's mainland bbox. Parts outside it (District 4's Farallones, whose ocean
// outline has a bigger bbox than its Sunset part) never hold the label.
function focusOf(geom, clip) {
    const polys = geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    const within = b => !clip || (b[0] < clip[2] && b[2] > clip[0] && b[1] < clip[3] && b[3] > clip[1]);
    let parts = polys.map(p => { const b = bbox({ coordinates: p[0] }); return { p, b, a: ringArea(p[0]), inClip: within(b) }; });
    if (parts.some(x => x.inClip)) parts = parts.filter(x => x.inClip);
    parts.sort((x, y) => y.a - x.a);
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

function ringArea(r) {
    let a = 0;
    for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
    return Math.abs(a / 2);
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
        const groups = JoinKit.ckmeans(sorted, k), uppers = groups.map(g => g[g.length - 1]);
        const colors = ramp.slice(ramp.length - k);
        return { type: 'numeric', col, colors, stats: JoinKit.summaryStats(sorted),
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

// Point size from a numeric column: 0–1 by area (square root), or by log; -1 = no value.
function computeRowSizes() {
    const col = S.rowStyle.sizeBy;
    if (!S.src || !col || !S.src.headers.includes(col)) return null;
    const vals = S.src.rows.map(r => JoinKit.parseNum(r[col]));
    const nums = vals.filter(v => v !== null);
    if (!nums.length) return null;
    const lo = Math.min(0, ...nums), hi = Math.max(...nums), log = !!S.rowStyle.sizeLog;
    const scale = v => v === null ? -1 : hi === lo ? 1 : log ? Math.log1p(v - lo) / Math.log1p(hi - lo) : Math.sqrt((v - lo) / (hi - lo));
    return { col, log, min: Math.min(...nums), max: hi, s: vals.map(scale) };
}
const sizeOf = i => S.rowSizes ? S.rowSizes.s[i] : 0;

// Radius at zoom 10 / 13 / 16, times the size setting; sized points range from 0.45× to 2×.
// A big file gets its own look (S.fileLook) until it's unloaded; otherwise hexagons and other areas each keep a size.
const sizeNow = () => S.fileLook?.size ?? (isHex(S.layerId) ? S.hexPointSize : S.pointSize);
const styleNow = () => S.fileLook?.style ?? S.pointStyle;
// Smaller where crowded: count the rows in view and pick a size factor.
function updateCrowd() {
    let k = 1;
    if (S.crowd && S.src?.points && S.basemap.points) {
        const b = map.getBounds(), w = b.getWest(), e = b.getEast(), so = b.getSouth(), n = b.getNorth();
        let c = 0;
        for (const p of S.src.points) if (p && p[0] >= w && p[0] <= e && p[1] >= so && p[1] <= n) c++;
        k = CONFIG.crowd.find(([max]) => c <= max)[1];
    }
    if (k !== S.crowdK) { S.crowdK = k; applyPointSize(); }
}
const lineW = k => ['interpolate', ['linear'], ['zoom'], 12, 4.5 * k, 14, 7 * k, 16, 11 * k, 18, 14 * k];
const hlW = k => ['interpolate', ['linear'], ['zoom'], 10, 5 * k, 12, 7 * k, 14, 10.5 * k, 16, 16 * k, 18, 20 * k];
function radiusExpr(extra = 0, mul = 1) {
    const m = (CONFIG.pointSizes[sizeNow()] || 1) * mul * (sizeNow() === 'pinpoint' ? 1 : S.crowdK);   // pinpoints are already as small as they go
    const r = base => S.rowSizes ? ['+', extra, ['*', base * m, ['+', 0.45, ['*', 1.55, ['max', 0, ['get', '_s']]]]]] : base * m + extra;
    const [a, b, c] = CONFIG.pointRadius;
    return ['interpolate', ['linear'], ['zoom'], 10, r(a), 13, r(b), 16, r(c)];
}
function applyPointSize() {
    for (const id of ['rows-point', 'rows-mid']) {
        map.setPaintProperty(id, 'circle-radius', radiusExpr());
        // Big circles under small ones.
        map.setLayoutProperty(id, 'circle-sort-key', S.rowSizes ? ['-', 0, ['get', '_s']] : 0);
    }
    map.setPaintProperty('rows-hl-point', 'circle-radius', radiusExpr(2, 1.6));
    // Lines follow the same control.
    const k = (CONFIG.lineSizes[sizeNow()] || 1) * Math.sqrt(S.crowdK);
    map.setPaintProperty('rows-sline-casing', 'line-width', lineW(1.55 * k));
    for (const id of ['rows-sline', 'rows-sline-out']) map.setPaintProperty(id, 'line-width', lineW(k));
    for (const id of ['rows-line', 'rows-line-out']) map.setPaintProperty(id, 'line-width', 2.5 * k);
    map.setPaintProperty('rows-line-glow', 'line-width', 6 * k);
    map.setPaintProperty('rows-hl-casing', 'line-width', hlW(1.6 * k));
    map.setPaintProperty('rows-hl-line', 'line-width', hlW(k));
}

let rowLayerKey = {};
function updateRowLayer() {
    const src = map.getSource('rows');
    if (!src) return;
    const show = S.src?.geoms && S.basemap.points;
    S.rowClasses = show ? computeRowClasses() : null;
    S.rowSizes = show ? computeRowSizes() : null;
    const k = i => S.rowClasses ? S.rowClasses.classOf(i) : 0;
    // Switching hexagon levels re-runs this with the same rows; skip resending thousands of features
    // when nothing they carry has changed (which rows are placed, their class and size).
    const key = show ? JSON.stringify([S.rowStyle, S.palette]) + S.rowArea.map(a => a == null ? 0 : 1).join('') : '';
    if (show && rowLayerKey.src === S.src && rowLayerKey.key === key) { applyPointSize(); applyPalette(); return; }
    rowLayerKey = { src: S.src, key };
    const feats = [];
    if (show) S.src.geoms.forEach((g, i) => {
        if (!g) return;
        const props = { _i: i, _in: S.rowArea[i] != null, _k: k(i), _s: sizeOf(i), _mid: false };
        feats.push({ type: 'Feature', geometry: g, properties: props });
        // Zoomed out, a line shows as a dot at its midpoint.
        if (/LineString$/.test(g.type) && S.src.points[i]) feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: S.src.points[i] }, properties: { ...props, _mid: true } });
    });
    src.setData({ type: 'FeatureCollection', features: feats });
    hlKey = undefined; hlRows(null);   // force a reset: rows changed
    S.crowdK = 0; updateCrowd();   // (forces applyPointSize)
    const labs = show ? S.rowStyle.labels.filter(c => S.src.headers.includes(c)) : [];
    map.getSource('rowlabels').setData({ type: 'FeatureCollection', features: !labs.length ? [] : S.src.points.map((p, i) => {
        if (!p) return null;
        const text = labs.map(c => cellShow(S.src.rows[i][c]).trim()).filter(Boolean).join('\n');
        return text && { type: 'Feature', geometry: { type: 'Point', coordinates: p }, properties: { _lab: text } };
    }).filter(Boolean) });
    applyPalette();
    renderLegend();
}

function applyAreasVisible() {
    const v = S.showAreas ? 'visible' : 'none';
    // Places follow the areas: hidden while areas show, back when they're hidden (the checkbox can override until the next change).
    if (S.basemap.places === S.showAreas) { S.basemap.places = !S.showAreas; applyBasemapToggles(); $('hoods-check').checked = S.basemap.places; }
    syncBarToggles();
    for (const id of ['bounds-fill', 'bounds-glow', 'bounds-line', 'bounds-hl', 'area-labels']) map.setLayoutProperty(id, 'visibility', v);
    applyRoadHint(areasUnder() && S.showAreas);
    store.set('showAreas', S.showAreas);
    updateLabels();
    renderLegend();
}

// Areas / Features buttons next to the tabs (pressed = shown).
function syncBarToggles() {
    const a = $('areas-toggle'), f = $('features-toggle');
    a.setAttribute('aria-pressed', S.showAreas); a.title = S.showAreas ? 'Hide the areas' : 'Show the areas';
    $('areas-check').checked = S.showAreas;
    f.hidden = !S.src?.geoms;
    f.setAttribute('aria-pressed', !!S.basemap.points); f.title = S.basemap.points ? 'Hide the features from the file' : 'Show the features from the file';
}
function setFeaturesVisible(on) {
    S.autoHid = false;
    S.basemap.points = on; store.set('basemap', S.basemap);
    updateRowLayer(); renderFormatFeatures(); syncBarToggles();
}

function clearFile() {
    S.src = null; S.areaOf = new Map(); S.expanded = null; S.rowArea = []; pinRowCard(null);
    S.fileLook = null; if (S.autoHid) { S.autoHid = false; S.basemap.points = true; }
    S.keyCols = {}; S.colKeys = {}; S.metric = 'count'; S.rowStyle = { colorBy: '', labels: [], sizeBy: '', sizeLog: false };
    popup.remove();
    updateRowLayer();
    if (isHex(S.layerId)) setLayer(S.layerId); else recompute();
}

const fmtSide = m => m < 1000 ? `${Math.round(m)} m` : m < 10000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000).toLocaleString()} km`;
const fmtArea = m2 => m2 < 100000 ? `${(m2 < 1000 ? Math.round(m2) : Math.round(m2 / 100) * 100).toLocaleString()} m²`
    : m2 < 1e7 ? `${(m2 / 1e6).toFixed(m2 < 1e6 ? 2 : 1)} km²` : `${Math.round(m2 / 1e6).toLocaleString()} km²`;
function renderHexControls() {
    const on = isHex(S.layerId);
    $('hex-card').hidden = !on;
    if (!on) return;
    const auto = S.hex.auto, bump = S.hex.bump || 0, zs = S.hex.zshift || 0, lat = viewLat(), cur = S.hexRes;
    $('hex-auto').setAttribute('aria-pressed', auto); $('hex-fixed').setAttribute('aria-pressed', !auto);
    $('hex-sum').textContent = `${cur} · ${fmtSide(EDGE_M(cur))} sides`;
    // The level in use and the one either side. In Auto, each with the zooms where Auto picks it.
    const [lo, hi] = CONFIG.hexRange;
    const zoomsFor = r => {
        if (!auto) return r === cur ? 'every zoom' : '';
        const b = r - bump, from = hexSwitchZoom(b - 1, lat) - zs, to = hexSwitchZoom(b, lat) - zs;
        const f = z => Math.max(0, z).toFixed(1);
        return r <= lo ? `to ${f(to)}` : r >= hi ? `${f(from)} +` : `${f(from)} – ${f(to)}`;
    };
    $('hex-rows').innerHTML = [cur - 1, cur, cur + 1].map(r => r < lo || r > hi ? '<tr class="none"><td colspan="4">&nbsp;</td></tr>'
        : `<tr${r === cur ? ' class="cur"' : ''}><td>${zoomsFor(r)}</td><td>${r}</td><td>${fmtSide(EDGE_M(r))}</td><td>${fmtArea(h3.getHexagonAreaAvg(r, 'm2'))}</td></tr>`).join('');
    $('hex-z-down').disabled = !auto || zs <= CONFIG.hexZoomShift[0];
    $('hex-z-up').disabled = !auto || zs >= CONFIG.hexZoomShift[1];
    $('hex-coarser').disabled = auto ? bump <= -3 : cur <= lo;
    $('hex-finer').disabled = auto ? bump >= 3 : cur >= hi;
    updateHexZoomNow();
    // Names
    document.querySelectorAll('[data-hlabel]').forEach(b => b.setAttribute('aria-pressed', (S.hex.label || 'friendly') === b.dataset.hlabel));
    const set = hexNameSet();
    $('hex-set').innerHTML = `<option value=""${set ? '' : ' selected'}>Named by: nothing (code only)</option>`
        + [...S.layers.values()].filter(l => !l.hex).map(l => `<option value="${esc(l.id)}"${l.id === set ? ' selected' : ''}>Named by: ${esc(shortLabel(l))}</option>`).join('');
    $('hex-set').disabled = S.hex.label === 'h3';
    const hc = S.hexCover || {};
    $('hex-names-hint').textContent = S.hex.label === 'h3' ? 'Each hexagon’s full H3 index.'
        : !set ? 'Only hexagons with rows are drawn, named by a short code.'
        : (hc.cover ? `Empty hexagons fill out the ${shortLabel(S.layers.get(set))}; each is named for the area covering most of it, with a short code.`
            : `Named for the ${oneArea(S.layers.get(set))} at its center, with a short code.` + (hc.tooMany ? ' (Too many to fill out the empty ones at this resolution.)' : !hc.overlaps ? ' The rows are outside these areas, so only hexagons with rows are drawn.' : ''));
}
// The live zoom in the table caption, and what the shifts do.
function updateHexZoomNow() {
    if ($('hex-card').hidden) return;
    const zs = S.hex.zshift || 0, bump = S.hex.bump || 0;
    const parts = [`Map zoom ${map.getZoom().toFixed(2)}`];
    if (S.hex.auto) {
        if (zs) parts.push(`zoom side ${zs > 0 ? '+' : '−'}${Math.abs(zs) % 1 ? (Math.abs(zs) === 0.5 ? '' : Math.floor(Math.abs(zs))) + '½' : Math.abs(zs)}`);
        if (bump) parts.push(`${Math.abs(bump)} step${Math.abs(bump) === 1 ? '' : 's'} ${bump < 0 ? 'bigger' : 'smaller'}`);
        parts.push(`Auto aims for hexagons about ${CONFIG.hexTargetPx} px across`);
    } else parts.push('fixed resolution');
    $('hex-hint').textContent = parts.join(' · ') + '.';
}

// Color chips: Auto (area labels only) and one chip per pair. A chip keeps its name and size; its
// sample shows the side in use, and clicking the chosen pair again swaps text and glow.
const colorSample = c => `<i style="color:${c.text};text-shadow:${[...Array(8)].map((_, k) => { const t = k * Math.PI / 4; return `${(Math.cos(t) * 1.3).toFixed(1)}px ${(Math.sin(t) * 1.3).toFixed(1)}px 0.5px ${c.halo}`; }).join(',')}">Aa</i>`;
function renderColorChips(el, current, auto) {
    const cur = CONFIG.labelColors[current];
    const chips = Object.entries(CONFIG.labelPairs).map(([p, name]) => {
        const keys = Object.keys(CONFIG.labelColors).filter(k => CONFIG.labelColors[k].pair === p);
        const on = cur?.pair === p, k = on ? current : (S.lastPair?.[el + p] || keys[0]), c = CONFIG.labelColors[k];
        const other = CONFIG.labelColors[keys.find(x => x !== k)];
        return `<button type="button" class="chip pair" data-lcolor="${k}" data-pair="${p}" aria-pressed="${on}" title="${esc(c.label)}${on ? ` — click again for ${esc(other.label.toLowerCase())}` : ''}">${colorSample(c)}<span class="nm">${esc(name)}</span><span class="swap" aria-hidden="true">⇄</span></button>`;
    });
    $(el).innerHTML = (auto ? `<button type="button" class="chip" data-lcolor="auto" aria-pressed="${current === 'auto'}" title="Black or white per area">${colorSample({ text: '#1E2340', halo: '#fff' })}<span class="nm">Auto</span></button>` : '') + chips.join('');
}
// Which color a click on a chip picks (a second click on the chosen pair swaps it).
function chipChoice(el, b) {
    let k = b.dataset.lcolor;
    if (b.dataset.pair && b.getAttribute('aria-pressed') === 'true')
        k = Object.keys(CONFIG.labelColors).find(x => CONFIG.labelColors[x].pair === b.dataset.pair && x !== k);
    if (b.dataset.pair) (S.lastPair ||= {})[el + b.dataset.pair] = k;
    return k;
}
function applyStreetColor() {
    for (const id of ['roads_labels_major', 'roads_labels_minor']) if (map.getLayer(id)) {
        const z = CONFIG.labelColors[S.streetColor];
        map.setPaintProperty(id, 'text-color', z.text);
        map.setPaintProperty(id, 'text-halo-color', z.halo);
        map.setPaintProperty(id, 'text-halo-width', z.width);
    }
    renderColorChips('scolor-seg', S.streetColor, false);
}

function applyLabelColor() {
    const z = CONFIG.labelColors[S.labelColor] || CONFIG.labelColors.black;
    map.setPaintProperty('rows-labels', 'text-color', z.text);
    map.setPaintProperty('rows-labels', 'text-halo-color', z.halo);
    map.setPaintProperty('rows-labels', 'text-halo-width', z.width);
    renderColorChips('lcolor-seg', S.labelColor, true);
    updateLabels();
}

// Auto: bigger labels for bigger areas. The set's typical area picks the base size (districts
// ~14px, ZIPs ~13, neighborhoods ~11.5, tracts ~11, fine hexagons 10); each area's own size nudges
// its label (0.85×–1.2×, property _ts), and labels grow a little as you zoom in.
function autoLabelBase() {
    const anchors = S.anchors.get(S.layerId);
    if (!anchors?.size) return 12;
    const km2 = [...anchors.values()].map(a => a.area * 111 * 88).sort((a, b) => a - b);   // bbox area, roughly km²
    S._medianArea = km2[km2.length >> 1];
    return Math.max(10, Math.min(15, 11.3 + 2.2 * Math.log10(S._medianArea)));
}
// Area outlines (as in Selecter): Auto (dark lines, light grey on hexagons), the area's own color,
// a faint version of it, grey, white, black or none; and a width.
const OUTLINES = { auto: 'Auto', palette: 'Area color', ghost: 'Ghost', grey: 'Grey', white: 'White', black: 'Black', none: 'None' };
const OUTLINE_W = { hair: 0.4, thin: 1, mid: 1.8, thick: 3 };
function applyOutline() {
    if (!map.getLayer('bounds-line')) return;
    const hex = isHex(S.layerId), o = S.outline, k = OUTLINE_W[o.width] || 1;
    const own = ['match', ['coalesce', ['feature-state', 'c'], -1], ...ramp().flatMap((c, i) => [i, c]), '#9aa0b4'];
    const [color, op, glow] = {
        auto: [hex ? '#c4c4c0' : '#1E2340', hex ? 0.7 : 0.5, 0.85],
        palette: [own, 1, 0.85], ghost: [own, 0.35, 0], grey: ['#8a8f9c', 0.85, 0.6],
        white: ['#ffffff', 1, 0], black: ['#1e1e1e', 0.85, 0.6], none: ['#000000', 0, 0],
    }[o.color] || [hex ? '#c4c4c0' : '#1E2340', 0.5, 0.85];
    map.setPaintProperty('bounds-line', 'line-color', color);
    map.setPaintProperty('bounds-line', 'line-opacity', op);
    map.setPaintProperty('bounds-line', 'line-width', ['interpolate', ['linear'], ['zoom'], 11, 0.8 * k, 14, 1.4 * k, 16, 2 * k]);
    map.setPaintProperty('bounds-glow', 'line-opacity', glow);
    map.setPaintProperty('bounds-glow', 'line-width', 3.5 * Math.max(1, k * 0.8));
    document.querySelectorAll('#outline-seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.outline === o.color));
    document.querySelectorAll('#outline-w button').forEach(b => b.setAttribute('aria-pressed', b.dataset.w === o.width));
    if ($('outline-name')) $('outline-name').textContent = OUTLINES[o.color] || '';
}
function renderClassControls() {
    document.querySelectorAll('.class-seg button').forEach(b => b.setAttribute('aria-pressed', b.dataset.method === S.classMethod));
    document.querySelectorAll('.class-log').forEach(c => { c.checked = S.classLog; c.disabled = S.classMethod === 'quantile'; c.closest('label').title = S.classMethod === 'quantile' ? 'Quantiles split by rank, so a log scale changes nothing' : 'Classes on the logarithm of the values: for long tails'; });
}
function applyLabelSize() {
    const fixed = CONFIG.labelSizes[S.labelSize];
    const auto = autoLabelBase(), base = fixed ? fixed.areas : auto, hz = S.homeZoom;
    const per = fixed ? 1 : ['coalesce', ['get', '_ts'], 1];
    map.setLayoutProperty('area-labels', 'text-size',
        ['interpolate', ['linear'], ['zoom'], hz, ['*', base, per], hz + 4, ['*', base * 1.25, per]]);
    map.setLayoutProperty('rows-labels', 'text-size', fixed ? fixed.rows : 11);
    $('size-seg')?.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', b.dataset.size === S.labelSize));
}

function rowTitle(i) {
    const r = S.src.rows[i], col = rowLabelCol();
    return JoinKit.cellText(r[col]) || `Row ${i + 1}`;
}
// The areas a row is in: several when its cell lists several, else its one area.
const areasOfRow = i => S.rowAreas?.[i] || (S.rowArea[i] != null ? [S.rowArea[i]] : []);
const areaNamesOf = i => areasOfRow(i).map(areaName).filter(Boolean);
function areaName(id) {
    const f = id != null && S.geo.get(S.layerId).features.find(f => f.id === id);
    return f ? nameOf(f) : null;
}
function showRowTip(point, i) {
    const tip = $('tip'), a = areaNamesOf(i);
    tip.innerHTML = `<b>${esc(rowTitle(i))}</b><div>${a.length ? esc(a.length > 3 ? `${a.slice(0, 3).join(', ')} and ${a.length - 3} more` : a.join(', ')) : 'Not placed in an area'}</div>`;
    tip.style.left = point.x + 'px'; tip.style.top = point.y + 'px';
    tip.hidden = false;
}
// A row's fields in a card at the map's left edge, whether or not the row has a location (rows
// matched by a column have none). Hovering a row in an expanded area previews it, level with the
// row; clicking a row there or in the table pins it, so the card stays (scroll it, select text)
// until it's closed or another row is pinned.
let cardPinned = null;   // row index of the pinned card
// With the table open, the card sits in a corner clear of it: bottom left when the table is
// beside the map, bottom right when it's below. Otherwise at the left edge, level with the row.
function placeCard(card, item) {
    const wrap = card.parentElement.getBoundingClientRect();
    if (T.open) {
        const side = T.dock === 'side', mapW = wrap.width - (side ? T.width : 0), mapH = wrap.height - (side ? 0 : T.height);
        card.style.left = (side ? 8 : Math.max(8, mapW - card.offsetWidth - 8)) + 'px';
        card.style.top = Math.max(8, mapH - card.offsetHeight - 8) + 'px';
        return;
    }
    card.style.left = '';
    const r = item?.getBoundingClientRect();
    const top = r ? r.top - wrap.top - 8 : 8;
    card.style.top = Math.max(8, Math.min(top, wrap.height - card.offsetHeight - 8)) + 'px';
}
function fillCard(card, i, pinned) {
    if (card.dataset.row === String(i) && card.dataset.pinned === String(pinned)) return;
    card.innerHTML = (pinned ? '<button type="button" class="card-x" aria-label="Close" title="Close (Esc)">✕</button>' : '') + rowPopupHTML(i, { all: pinned });
    card.dataset.row = i; card.dataset.pinned = pinned;
    card.classList.toggle('pinned', pinned);
}
function showRowCard(item) {
    const card = $('rowcard');
    if (!item) {   // back to the pinned card, if any
        if (cardPinned != null) { fillCard(card, cardPinned, true); card.hidden = false; placeCard(card, card._item?.isConnected ? card._item : null); }
        else { card.hidden = true; card.dataset.row = ''; }
        return;
    }
    fillCard(card, +item.dataset.row, +item.dataset.row === cardPinned);
    card.hidden = false;
    placeCard(card, item);
}
function pinRowCard(i, item = null) {
    const card = $('rowcard');
    if (i == null) { cardPinned = null; card.hidden = true; card.dataset.row = ''; markListRow(null); return; }
    cardPinned = i; card._item = item;
    fillCard(card, i, true); card.hidden = false; placeCard(card, item);
    markListRow(i);
}
// The row shown in the card (or clicked on the map), marked in the expanded area's list.
function markListRow(i) {
    document.querySelectorAll('#area-list .items li.cur').forEach(li => li.classList.remove('cur'));
    if (i == null) return;
    const li = document.querySelector(`#area-list .items li[data-row="${i}"]`);
    if (li) { li.classList.add('cur'); li.scrollIntoView({ block: 'nearest' }); }
}
// Open an area in the list (closing any other), select it and zoom to it. Used for clicks on the
// map, in the table and in the list.
function openArea(id, { fly = true, toggle = false } = {}) {
    if (id == null) return;
    S.expanded = toggle && S.expanded === id ? null : id;
    select(id, { fly, noPopup: true });
    renderList();
    document.querySelector(`#area-list li[data-id="${CSS.escape(id)}"]`)?.scrollIntoView({ block: 'nearest' });
}

function rowPopupHTML(i, { all = false } = {}) {
    const r = S.src.rows[i], names = areaNamesOf(i);
    // A cell listing several areas: name them all (in a hover card, the first few), and any part that isn't one.
    const meta = S.layers.get(S.layerId), keyCol = S.join?.keyCol, delim = keyCol && keyCol !== LOCATION && delimFor(keyCol, meta);
    let off = [];
    if (delim) { const norm = normalizerFor(meta); off = rawValues(r, keyCol, delim).map(v => String(v).trim()).filter(v => v && !norm.names?.has(norm(v))); }
    const shown = all || names.length <= 4 ? names : [...names.slice(0, 3), `and ${names.length - 3} more`];
    const a = names.length ? (names.length > 1 ? `In ${names.length} ${meta.hex ? 'hexagons' : 'areas'}: ` : 'In ') + shown.join(', ') : '';
    const fields = S.src.headers.filter(h => !h.startsWith('_') && JoinKit.cellText(r[h]) !== '' && !(S.src.geomCols || []).includes(h)).slice(0, all ? Infinity : 30);
    // Value first, field name under it (long names are cut short; the full name is in the tooltip).
    return `<div class="pop"><h4>${esc(rowTitle(i))}</h4><div class="sub">${a ? esc(a) : 'Not placed in an area'}${off.length ? `<br>Not on the map: ${esc(off.join(', '))}` : ''}</div>
        <dl class="fields">${fields.map(h => `<div><dd>${esc(cellShow(r[h]))}</dd><dt title="${esc(h)}">${esc(h)}</dt></div>`).join('')}</dl></div>`;
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
    if (geom.type === 'GeometryCollection') geom.geometries.forEach(g => walk(g.coordinates)); else walk(geom.coordinates);
    return b;
}

// ═════════════════════════════════════════════════════════════════════════
// Loading and saving data
// ═════════════════════════════════════════════════════════════════════════
// Big files say what's happening as they load: reading (with how far), finding locations, placing rows.
async function loadFile(file) {
    const big = file.size > 5 * 1024 * 1024;
    const mb = (file.size / 1048576).toFixed(file.size < 1e7 ? 1 : 0);
    try {
        let last = 0;
        const src = await JoinerSources.readFile(file, { onProgress: big ? (step, f, n) => {
            if (Date.now() - last < 120 && f != null && f < 1) return;   // a few updates a second is plenty
            last = Date.now();
            if (step === 'read') toast(`Reading ${file.name}`, { busy: true, progress: f, sub: `${Math.round(f * 100)}% of ${mb} MB${n ? ` · ${n.toLocaleString()} rows` : ''}` });
            else if (step === 'parse') toast(`Reading ${file.name}`, { busy: true, sub: `${mb} MB of JSON` });
            else if (step === 'locate') toast(`Finding locations`, { busy: true, progress: f, sub: `${Math.round(f * 100)}%` });
        } : undefined });
        if (big) { toast(`Matching ${src.rows.length.toLocaleString()} rows`, { busy: true, sub: 'Getting the areas ready' }); await nextFrame(); }
        await useSource(src);
        if (big && !$('toast').querySelector('.toast-actions').childElementCount) toast(`Loaded ${src.rows.length.toLocaleString()} rows`, { sub: file.name, ms: 3000 });
    } catch (e) {
        toast(null);
        alert(e.message);
        console.error(e);
    }
}

// Show a loaded source. keep: the same table reloaded (e.g. with a field added back), so the
// match, statistic and formatting choices stay.
// A file with thousands of located rows starts as pinpoints (its own look, so the next file
// starts from the usual settings); with tens of thousands, its features start hidden.
function bigFileLook(src) {
    const n = src.points ? src.points.filter(Boolean).length : 0;
    if (S.autoHid && !S.basemap.points) S.basemap.points = true;
    S.autoHid = false;
    S.fileLook = n >= CONFIG.bigFile.look ? { size: 'pinpoint', style: S.pointStyle } : null;
    if (n >= CONFIG.bigFile.hide && S.basemap.points) { S.basemap.points = false; S.autoHid = true; syncBarToggles(); }   // not stored: the next file shows its features
}
async function useSource(src, { keep = false } = {}) {
        src.points = src.geoms ? src.geoms.map(repPoint) : null;
        S.src = src; pinRowCard(null);
        S.areaOf = new Map();
        S.expanded = null;
        if (!keep) { S.rowStyle = { colorBy: '', labels: [], sizeBy: '', sizeLog: false }; S.keyCols = {}; S.colKeys = {}; S.metric = 'count'; bigFileLook(src); }
        renderAirtable();
        const st = src.settings;
        if (st) {
            Object.assign(S.keyCols, st.keyCols || {});
            if (st.metric) S.metric = st.metric;
            if (st.palette && CONFIG.palettes[palKey(st.palette)]) { S.palette = palKey(st.palette); applyPalette(); }
            if (st.rowStyle) S.rowStyle = { colorBy: st.rowStyle.colorBy || '', labels: st.rowStyle.labels || [], sizeBy: st.rowStyle.sizeBy || '', sizeLog: !!st.rowStyle.sizeLog };
            if (st.pointSize && CONFIG.pointSizes[st.pointSize]) S.pointSize = st.pointSize;
            if (st.hexPointSize && CONFIG.pointSizes[st.hexPointSize]) S.hexPointSize = st.hexPointSize;
            if (st.pointStyle && CONFIG.pointStyles[st.pointStyle]) S.pointStyle = st.pointStyle;
            if (CLASS_METHODS[st.classMethod]) S.classMethod = st.classMethod;
            if (typeof st.classLog === 'boolean') S.classLog = st.classLog;
            if (st.outline && OUTLINES[st.outline.color]) { S.outline = { ...S.outline, ...st.outline }; applyOutline(); }
            renderClassControls();
            if ('look' in st) S.fileLook = st.look && CONFIG.pointSizes[st.look.size] && CONFIG.pointStyles[st.look.style] ? { ...st.look } : null;
            if (st.hex) S.hex = { ...S.hex, ...st.hex };
            if (typeof st.hideEmpty === 'boolean') S.hideEmpty = st.hideEmpty;
            if (['auto', 'over', 'under'].includes(st.areaOrder)) { S.areaOrder = st.areaOrder; applyAreaOrder(); }
            if (st.labelSize && (st.labelSize === 'auto' || CONFIG.labelSizes[st.labelSize])) { S.labelSize = st.labelSize; applyLabelSize(); }
            if (typeof st.revealAll === 'boolean') S.revealAll = st.revealAll;
            if (st.labelColor && (st.labelColor === 'auto' || CONFIG.labelColors[st.labelColor])) { S.labelColor = st.labelColor; applyLabelColor(); }
            if (st.labels) { S.labels = st.labels.fields ?? null; S.prefix = st.labels.prefix ?? S.prefix; S.prefixZoom = st.labels.prefixZoom ?? S.prefixZoom; }
            if (st.layerId && S.layers.has(st.layerId) && st.layerId !== S.layerId) { await setLayer(st.layerId); return; }
        }
        T.sort = null; if (!keep) T.pin = null;
        if (T.wanted && !T.open) setTableOpen(true);
        if (isHex(S.layerId)) { await setLayer(S.layerId); return; }   // the grid gains the file's cells
        await refresh();
}

// ═════════════════════════════════════════════════════════════════════════
// Toast: what's happening (loading steps), what changed (area set switched), or a question.
// ═════════════════════════════════════════════════════════════════════════
let toastTimer = null;
// progress: 0–1 draws a bar under the message (null: no bar).
function toast(msg, { sub = '', busy = false, actions = [], ms = 0, progress = null } = {}) {
    const el = $('toast');
    clearTimeout(toastTimer);
    if (!msg) { el.hidden = true; return; }
    el.classList.toggle('busy', busy);
    const bar = el.querySelector('.toast-bar');
    bar.hidden = progress == null;
    if (progress != null) bar.firstElementChild.style.width = `${Math.round(progress * 100)}%`;
    el.querySelector('.toast-msg').textContent = msg;
    const subEl = el.querySelector('.toast-sub'); subEl.textContent = sub; subEl.hidden = !sub;
    const act = el.querySelector('.toast-actions');
    act.innerHTML = actions.map((a, i) => `<button type="button" class="${a.primary ? 'btn' : 'btn ghost'}" data-i="${i}">${esc(a.label)}</button>`).join('');
    act.hidden = !actions.length;
    act.onclick = e => { const b = e.target.closest('button'); if (!b) return; const a = actions[+b.dataset.i]; toast(''); a.fn?.(); };
    el.hidden = false;
    if (ms) toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}
const nextFrame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));   // let the toast paint before heavy work

// ═════════════════════════════════════════════════════════════════════════
// Airtable
// ═════════════════════════════════════════════════════════════════════════
// A view link in ?airtable= (shareable: it carries no token) opens that view; the token is asked
// for once per tab and kept in sessionStorage.
const AT = () => window.JoinerAirtable;
let atBusy = false;
function atStatus(msg, kind = '') { const el = $('at-status'); el.textContent = msg; el.className = 'at-status ' + kind; }

async function loadAirtable(link, { include = [], skipLinks = [], keep = false } = {}) {
    if (atBusy) return;
    const tok = $('at-token').value.trim() || AT().token.get();
    if (!link) { atStatus('Paste a link to an Airtable view (or table).', 'err'); return; }
    if (!tok) { atStatus('Paste your personal access token.', 'err'); $('at-token-row').hidden = false; $('at-token').focus(); return; }
    atBusy = true; $('at-load').disabled = true;
    atStatus('Loading from Airtable…');
    const t0 = performance.now(), secs = () => ((performance.now() - t0) / 1000).toFixed(1) + 's';
    let label = 'the table';
    // Each step of the load, in the toast and the panel.
    const step = (msg, sub) => { toast(msg, { sub, busy: true }); atStatus(msg); };
    const onProgress = p => {
        if (p.step === 'schema') step('Connecting to Airtable…', 'Reading the base’s tables and fields');
        else if (p.step === 'fields') { label = `“${p.table}”${p.view ? ' · ' + p.view : ''}`; step(`Reading ${label}…`, `${p.fields} field${p.fields === 1 ? '' : 's'}` + (p.skipped ? `, ${p.skipped} contact field${p.skipped === 1 ? '' : 's'} left out` : '')); }
        else if (p.step === 'records') step(`Reading ${label}…`, `${p.rows.toLocaleString()} records so far (page ${p.page}${p.more ? ', more to come' : ''}) · ${secs()}`);
        else if (p.step === 'linked') step(`Reading linked records in “${p.table}”…`, `For “${p.field}”: ${p.rows.toLocaleString()} records so far · ${secs()}`);
    };
    try {
        const first = S.src?.kind !== 'airtable';   // collapse the card after a first load, not when switching or reloading
        const raw = await AT().load(link, tok, { include, skipLinks, onProgress });
        step(`Looking for locations in ${raw.rows.length.toLocaleString()} records…`, 'Coordinates, WKT or GeoJSON columns');
        await nextFrame();
        const src = JoinerSources.finishSource(raw);
        AT().token.set(tok); $('at-token').value = '';
        const q = new URLSearchParams(location.search); q.set('airtable', AT().linkFor(src.airtable));
        history.replaceState(null, '', location.pathname + '?' + q.toString() + location.hash);
        step(`Placing ${src.rows.length.toLocaleString()} rows in ${shortLabel(S.layers.get(S.layerId))}…`, src.geomFrom ? `Using the ${src.geomFrom}` : 'Matching by column');
        await nextFrame();
        await useSource(src, { keep });
        atStatus('');
        const placed = (S.rowArea || []).filter(a => a != null).length;
        toast(`Loaded ${src.rows.length.toLocaleString()} rows from ${label}`, { sub: `${placed.toLocaleString()} placed in ${shortLabel(S.layers.get(S.layerId))} · ${secs()}`, ms: 4500 });
        if (first) $('at-card').open = false;
    } catch (e) {
        atStatus(e.message, 'err');
        toast('Couldn’t load from Airtable', { sub: e.message, ms: 9000 });
        if (/token/i.test(e.message)) $('at-token-row').hidden = false;
        if (/couldn’t find|isn’t in/i.test(e.message)) startCatalog(tok, { force: true });   // a table moved or was deleted
        console.error(e);
    } finally { atBusy = false; $('at-load').disabled = false; renderAirtable(); }
}

// Other bases and tables this token can read. The list comes from the tab's catalog (read in the
// background as soon as there's a token), so it's usually there at once; it fills in as bases are read.
const ago = t => { const m = Math.round((Date.now() - t) / 60000); return m < 1 ? 'just now' : m === 1 ? '1 min ago' : `${m} min ago`; };
function renderBrowse(c, refreshing) {
    const box = $('at-browse');
    if (box.hidden) return;
    const open = new Set([...box.querySelectorAll('details.at-base[open]')].map(d => d.dataset.base));
    if (!box.dataset.drawn && S.src?.airtable?.base) open.add(S.src.airtable.base);
    box.dataset.drawn = '1';
    if (!c) { box.innerHTML = '<p class="hint loading">Loading the bases this token can open</p>'; return; }
    const cur = S.src?.airtable?.table;
    box.innerHTML = (c.bases.length ? c.bases.map(b => `<details class="at-base" data-base="${b.id}"${open.has(b.id) ? ' open' : ''}><summary>${esc(b.name)}${b.tables ? ` <span class="why">${b.tables.length} table${b.tables.length === 1 ? '' : 's'}</span>` : ''}</summary><ul class="at-tables">`
        + (b.tables ? b.tables.map(t => `<li><button type="button" class="linkish" data-table="${t.id}"${cur === t.id ? ' aria-current="true"' : ''}>${esc(t.name)}</button> <span class="why">${t.fields} fields</span></li>`).join('')
            : b.error ? `<li class="hint err">${esc(b.error)}</li>` : '<li class="hint loading">Loading tables</li>')
        + '</ul></details>').join('')
        : '<p class="hint">This token can’t open any bases. Add bases to it under Access on the token’s page.</p>')
        + `<p class="hint at-fresh">${refreshing ? '<span class="loading">Updating</span>' : `Updated ${ago(c.at)}`} · <button type="button" class="linkish" id="at-refresh">Refresh</button></p>`;
}
function startCatalog(tok, { force = false } = {}) {
    if (!tok) return;
    const { catalog, refreshing } = AT().catalog(tok, { force, onUpdate: c => renderBrowse(c, !!atCatalogBusy) });
    atCatalogBusy = refreshing;
    refreshing?.then(c => { atCatalogBusy = null; renderBrowse(c, false); }, e => { atCatalogBusy = null; if (!$('at-browse').hidden && !AT().readCatalog(tok)) $('at-browse').innerHTML = `<p class="hint err">${esc(e.message)}</p>`; });
    return catalog;
}
let atCatalogBusy = null;
function browseAirtable() {
    const box = $('at-browse'), tok = $('at-token').value.trim() || AT().token.get();
    if (!box.hidden) { box.hidden = true; $('at-browse-btn').textContent = 'Show other tables'; return; }
    if (!tok) { atStatus('Paste your personal access token to see the tables it can open.', 'err'); $('at-token').focus(); return; }
    box.hidden = false; box.dataset.drawn = ''; $('at-browse-btn').textContent = 'Hide other tables';
    const c = startCatalog(tok);
    renderBrowse(c, !!atCatalogBusy);
    box.onclick = e => {
        if (e.target.closest('#at-refresh')) { startCatalog(tok, { force: true }); renderBrowse(AT().readCatalog(tok), true); return; }
        const b = e.target.closest('button[data-table]'); if (!b) return;
        const base = b.closest('details').dataset.base;
        loadAirtable({ base, table: b.dataset.table, view: null });
        box.hidden = true; $('at-browse-btn').textContent = 'Show other tables';
    };
}

function renderAirtable() {
    const hasTok = !!AT()?.token.get();
    $('at-token-row').hidden = hasTok;
    $('at-remembered').hidden = !hasTok;
    const at = S.src?.kind === 'airtable' && S.src.airtable;
    $('at-info').hidden = !at;
    if (!at) return;
    $('at-url').value = AT().linkFor(at);
    $('at-open').href = AT().linkFor(at);
    $('at-table').innerHTML = at.tables.map(t => `<option value="${t.id}"${t.id === at.table ? ' selected' : ''}>${esc(t.name)}</option>`).join('');
    const views = at.tables.find(t => t.id === at.table)?.views || [];
    $('at-view').innerHTML = `<option value="">All records</option>` + views.map(v => `<option value="${v.id}"${v.id === at.view ? ' selected' : ''}>${esc(v.name)}</option>`).join('');
    $('at-skipped-n').textContent = at.skipped.length ? `${at.skipped.length} field${at.skipped.length === 1 ? '' : 's'} not loaded` : 'All fields loaded';
    $('at-skipped').innerHTML = at.skipped.map(f => `<li><label class="check"><input type="checkbox" data-field="${esc(f.name)}"> ${esc(f.name)} <span class="why">${esc(f.why)}</span></label></li>`).join('')
        + (at.include.length ? at.include.map(n => `<li><label class="check"><input type="checkbox" data-field="${esc(n)}" checked> ${esc(n)} <span class="why">added back</span></label></li>`).join('') : '');
    $('at-reload').hidden = true;
    const links = at.links || [];
    $('at-links-sub').hidden = !links.length;
    $('at-links-n').textContent = `Linked records: ${links.filter(l => l.resolved).length} of ${links.length} brought in`;
    $('at-links').innerHTML = links.map(l => `<li><label class="check"><input type="checkbox" data-link="${esc(l.field)}"${l.resolved ? ' checked' : ''}${l.tableId ? '' : ' disabled'}> ${esc(l.field)} <span class="why">→ ${esc(l.table)}${l.resolved ? `, ${l.fields} field${l.fields === 1 ? '' : 's'}` : ''}</span></label></li>`).join('');
    const shared = links.filter(l => l.resolved && l.shared);
    $('at-links-shared').textContent = shared.map(l => `${l.shared} linked record${l.shared === 1 ? '' : 's'} in “${l.field}” appear${l.shared === 1 ? 's' : ''} on more than one row here, so ${l.shared === 1 ? 'its' : 'their'} numbers count once per row.`).join(' ');
    $('at-links-shared').hidden = !shared.length;
    $('at-links-reload').hidden = true;
}

function saveSnapshot() {
    const snap = JoinerSources.makeSnapshot(S.src, { layerId: S.layerId, keyCols: S.keyCols, metric: S.metric, palette: S.palette, rowStyle: S.rowStyle, labelSize: S.labelSize, revealAll: S.revealAll, labelColor: S.labelColor, classMethod: S.classMethod, classLog: S.classLog, outline: S.outline, pointSize: S.pointSize, hexPointSize: S.hexPointSize, pointStyle: S.pointStyle, look: S.fileLook, hex: S.hex, areaOrder: S.areaOrder, hideEmpty: S.hideEmpty,
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
        // Clicking any tab brings hidden areas back.
        if (e.target.closest('.tab') && !S.showAreas) { S.showAreas = true; applyAreasVisible(); }
        if (e.target.closest('select')) return;
        const tab = e.target.closest('.tab')?.dataset.tab;
        if (tab && S.layers.get(S.layerId).tab !== tab && S.tabChoice[tab]) setLayer(S.tabChoice[tab]);
    });
    $('tabs').addEventListener('keydown', e => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target.classList.contains('tab')) { e.preventDefault(); e.target.click(); }
    });
    $('tabs').addEventListener('change', e => {
        if (!e.target.matches('select')) return;
        if (e.target.value === UPLOAD) { renderTabs(); $('poly-input').click(); return; }
        setLayer(e.target.value);
    });
    $('poly-input').onchange = e => { const f = e.target.files[0]; if (f) addPolygonLayer(f); e.target.value = ''; };
    // Opening the menu on an inactive tab switches to that tab, even if the same set is picked again.
    $('tabs').addEventListener('mousedown', e => {
        const sel = e.target.closest('select');
        if (sel && sel.dataset.tab !== OTHER && S.layers.get(S.layerId).tab !== sel.dataset.tab) setLayer(S.tabChoice[sel.dataset.tab]);
    });

    $('load-btn').onclick = $('empty-load').onclick = () => $('file-input').click();
    $('file-input').onchange = e => { const f = e.target.files[0]; if (f) loadFile(f); e.target.value = ''; };
    $('save-btn').onclick = saveSnapshot;

    // Pointing at the area list for a moment folds the other cards away, so the list has the room.
    { let t = null;
      const card = document.querySelector('.list-card');
      card.addEventListener('mouseenter', () => { t = setTimeout(() => {
          document.querySelectorAll('#panel details.card[open]').forEach(d => { d.open = false; });
      }, 450); });
      card.addEventListener('mouseleave', () => clearTimeout(t)); }
    $('labels-jump').onclick = () => {
        $('labels-card').open = true; $('labels-sub').open = true;
        $('labels-card').scrollIntoView({ behavior: 'smooth', block: 'start' });
        $('labels-card').classList.add('flash'); setTimeout(() => $('labels-card').classList.remove('flash'), 1200);
    };
    $('join-card').open = store.get('joinOpen', true);
    $('join-card').addEventListener('toggle', () => store.set('joinOpen', $('join-card').open));
    $('key-select').onchange = e => { if (e.target.value) matchByColumn(e.target.value); };
    $('loc-check').onchange = e => {
        S.keyCols[S.layerId] = e.target.checked ? LOCATION : (S.colKeys[S.layerId] || S.candidates.find(c => c.col !== LOCATION)?.col);
        refresh();
    };
    $('clear-btn').onclick = clearFile;
    $('at-form').onsubmit = e => { e.preventDefault(); loadAirtable(AT().parseLink($('at-url').value)); };
    $('at-forget').onclick = () => { AT().token.set(''); AT().forgetCatalog(); $('at-browse').hidden = true; renderAirtable(); atStatus('Token forgotten.'); };
    // Read the bases and tables in the background as soon as there's a token: remembered, or pasted.
    if (AT().token.get()) startCatalog(AT().token.get());
    $('at-token').addEventListener('input', e => { const t = e.target.value.trim(); if (/^pat\w{10,}\.\w{20,}$/.test(t)) startCatalog(t); });
    $('at-browse-btn').onclick = browseAirtable;
    $('toast').querySelector('.toast-x').onclick = () => toast('');
    // Switching views keeps fields added back; a different table starts from the default fields.
    const atSwitch = () => {
        const at = S.src.airtable, same = $('at-table').value === at.table;
        loadAirtable({ base: at.base, table: $('at-table').value, view: same ? $('at-view').value || null : null }, { include: same ? at.include : [], skipLinks: same ? at.skipLinks || [] : [] });
    };
    $('at-table').onchange = atSwitch;
    $('at-view').onchange = atSwitch;
    $('at-skipped').onchange = () => { $('at-reload').hidden = false; };
    $('at-reload').onclick = () => {
        const at = S.src.airtable;
        const include = [...$('at-skipped').querySelectorAll('input:checked')].map(i => i.dataset.field);
        loadAirtable({ base: at.base, table: at.table, view: at.view }, { include, skipLinks: at.skipLinks || [], keep: true });
    };
    $('at-links').onchange = () => { $('at-links-reload').hidden = false; };
    $('at-links-reload').onclick = () => {
        const at = S.src.airtable;
        const skipLinks = [...$('at-links').querySelectorAll('input:not(:checked)')].map(i => i.dataset.link);
        loadAirtable({ base: at.base, table: at.table, view: at.view }, { include: at.include, skipLinks, keep: true });
    };
    $('at-copy').onclick = async () => {
        try { await navigator.clipboard.writeText(location.href); atStatus('Map link copied. It doesn’t include your token.'); }
        catch { atStatus('Copy this page’s address to share the map; it doesn’t include your token.'); }
    };
    $('areas-check').onchange = e => { S.showAreas = e.target.checked; applyAreasVisible(); };
    $('order-seg').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        S.areaOrder = b.dataset.order; store.set('areaOrder', S.areaOrder);
        applyAreaOrder();
    };
    $('row-size').onchange = e => { S.rowStyle.sizeBy = e.target.value; updateRowLayer(); renderFormatFeatures(); };
    $('size-log').onchange = e => { S.rowStyle.sizeLog = e.target.checked; updateRowLayer(); renderFormatFeatures(); };
    $('psize-seg').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        if (S.fileLook) S.fileLook.size = b.dataset.psize;
        else if (isHex(S.layerId)) { S.hexPointSize = b.dataset.psize; store.set('hexPointSize', S.hexPointSize); }
        else { S.pointSize = b.dataset.psize; store.set('pointSize', S.pointSize); }
        applyPointSize(); applyPalette(); renderFormatFeatures();
    };
    $('pstyle-seg').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        // Ring and Ghost: clicking the chosen one again switches between colored and white.
        const cur = styleNow(), base = b.dataset.pstyle;
        const next = (base === 'ring' || base === 'ghost') && cur.replace('-w', '') === base ? (cur.endsWith('-w') ? base : base + '-w') : base;
        if (S.fileLook) S.fileLook.style = next;
        else { S.pointStyle = next; store.set('pointStyle', S.pointStyle); }
        applyPalette(); renderFormatFeatures();
    };
    $('crowd-check').onchange = e => {
        S.crowd = e.target.checked; store.set('crowd', S.crowd);
        S.crowdK = 0; updateCrowd();
    };
    const setHex = h => { S.hex = { ...S.hex, ...h }; store.set('hex', S.hex); setLayer('h3'); };
    $('hex-auto').onclick = e => { e.preventDefault(); setHex({ auto: true }); };   // in the card's heading: don't fold it
    $('hex-fixed').onclick = e => { e.preventDefault(); setHex({ auto: false, res: S.hexRes }); };   // fix at the level in use
    // − / +: bigger or smaller hexagons. In Auto they shift the zoom-to-resolution steps; fixed, they change the level.
    const hexStep = d => setHex(S.hex.auto ? { bump: Math.max(-3, Math.min(3, (S.hex.bump || 0) + d)) } : { res: clampRes(S.hexRes + d) });
    $('hex-coarser').onclick = () => hexStep(-1);
    $('hex-finer').onclick = () => hexStep(1);
    // ½: move the zoom side, so each level arrives half a zoom level sooner or later.
    const zStep = d => setHex({ zshift: Math.max(CONFIG.hexZoomShift[0], Math.min(CONFIG.hexZoomShift[1], (S.hex.zshift || 0) + d)) });
    $('hex-z-down').onclick = () => zStep(-0.5);
    $('hex-z-up').onclick = () => zStep(0.5);
    document.querySelectorAll('[data-hlabel]').forEach(b => b.onclick = () => setHex({ label: b.dataset.hlabel }));
    $('hex-set').onchange = e => setHex({ names: e.target.value });
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
    $('hoods-check').onchange = e => { S.basemap.places = e.target.checked; applyBasemapToggles(); };
    document.querySelectorAll('.palette-seg').forEach(el => el.onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        S.palette = b.dataset.palette; store.set('palette', S.palette);
        updateRowLayer(); paint(); renderList(); renderPaletteSeg(); renderFormatFeatures(); updateLabels();
    });
    $('points-check').onchange = e => setFeaturesVisible(e.target.checked);
    $('empty-check').onchange = e => { S.hideEmpty = e.target.checked; store.set('hideEmpty', S.hideEmpty); recompute(); };
    // Table drawer
    { const t = store.get('tableDock', {});
      if (t.height) T.height = Math.max(110, Math.min(t.height, innerHeight * 0.7));
      if (t.width) T.width = Math.max(280, Math.min(t.width, innerWidth * 0.6));
      if (t.dock === 'side' || t.dock === 'bottom') T.dock = t.dock;
      T.wanted = !!(t.open ?? store.get('table', {}).open); }
    $('dock-seg').onclick = e => { const b = e.target.closest('button'); if (!b) return; T.dock = b.dataset.dock; applyTableDock(); saveTablePrefs(); renderTable(); };
    $('table-toggle').onclick = () => setTableOpen(!T.open);
    $('table-close').onclick = () => setTableOpen(false);
    $('table-filter').onclick = e => { const b = e.target.closest('button'); if (!b) return; T.filter = b.dataset.filter; renderTable(); };
    map.on('moveend', () => { if (T.filter === 'view') renderTable(); updateCrowd(); });
    $('table-grid').addEventListener('click', e => {
        const pin = e.target.closest('button.pin');
        if (pin) { T.pin = pin.dataset.pin; renderTable(); return; }
        const th = e.target.closest('th[data-col]');
        if (th) { const c = th.dataset.col; T.dir = T.sort === c ? -T.dir : 1; T.sort = c; renderTable(); return; }
        const tr = e.target.closest('tr[data-row]'); if (!tr) return;
        // A row: its area opened in the list and its fields pinned in the card; zoom to the row
        // when it has a location, else to its area.
        const i = +tr.dataset.row, p = S.src.points?.[i];
        popup.remove();
        const ids = areasOfRow(i);
        if (ids.length) openArea(ids[0], { fly: !p && ids.length === 1 });
        if (ids.length > 1) {   // all of the row's areas marked, and in view when the row has no location
            selectAlso(ids);
            if (!p) { const an = S.anchors.get(S.layerId), b = unionBbox(ids.map(id => an.get(id)?.fit).filter(Boolean)); map.fitBounds([[b[0], b[1]], [b[2], b[3]]], { padding: 60, maxZoom: 15, duration: 500 }); }
        }
        if (p) map.flyTo({ center: p, zoom: isHex(S.layerId) ? map.getZoom() : Math.max(map.getZoom(), 15), duration: 600 });
        pinRowCard(i, document.querySelector(`#area-list .items li[data-row="${i}"]`));
    });
    $('table-grid').addEventListener('mouseover', e => {
        const tr = e.target.closest('tr[data-row]'); if (!tr) return;
        const i = +tr.dataset.row;
        hlRows({ row: i }); setHoverRow(i);
    });
    $('table-grid').addEventListener('mouseleave', () => { hlRows(null); setHover(null); });
    // Drag the drawer's inner edge (top below the map, left beside it) to resize it.
    $('table-grip').addEventListener('pointerdown', e => {
        e.preventDefault();
        const x0 = e.clientX, y0 = e.clientY, h0 = T.height, w0 = T.width, wrap = document.querySelector('.map-wrap');
        const move = ev => {
            if (T.dock === 'side') T.width = Math.max(280, Math.min(w0 + x0 - ev.clientX, wrap.clientWidth - 240));
            else T.height = Math.max(110, Math.min(h0 + y0 - ev.clientY, wrap.clientHeight - 120));
            applyTableDock();
        };
        const up = () => { removeEventListener('pointermove', move); removeEventListener('pointerup', up); saveTablePrefs(); };
        addEventListener('pointermove', move); addEventListener('pointerup', up);
    });
    $('areas-toggle').onclick = () => { S.showAreas = !S.showAreas; applyAreasVisible(); };
    $('features-toggle').onclick = () => setFeaturesVisible(!S.basemap.points);
    $('lcolor-seg').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        S.labelColor = chipChoice('lcolor-seg', b); store.set('labelColor', S.labelColor);
        applyLabelColor();
    };
    $('scolor-seg').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        S.streetColor = chipChoice('scolor-seg', b); store.set('streetColor', S.streetColor);
        applyStreetColor();
    };
    $('row-color').onchange = e => { S.rowStyle.colorBy = e.target.value; updateRowLayer(); renderFormatFeatures(); };
    $('row-label-chips').onclick = e => {
        const b = e.target.closest('.chip'); if (!b) return;
        const c = b.dataset.col, l = S.rowStyle.labels;
        S.rowStyle.labels = l.includes(c) ? l.filter(x => x !== c) : [...l, c];
        updateRowLayer(); renderFormatFeatures();
    };
    $('reveal-seg').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        S.revealAll = b.dataset.reveal === 'all'; store.set('revealAll', S.revealAll);
        renderLabelControls(); updateLabels();
    };
    // Classes: method and log, in the top section.
    document.addEventListener('click', e => {
        const b = e.target.closest('.class-seg button'); if (!b) return;
        S.classMethod = b.dataset.method; store.set('classMethod', S.classMethod); recolor(); renderClassControls();
    });
    document.addEventListener('change', e => {
        if (!e.target.matches('.class-log')) return;
        S.classLog = e.target.checked; store.set('classLog', S.classLog); recolor(); renderClassControls();
    });
    renderClassControls();
    $('outline-seg').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.outline = { ...S.outline, color: b.dataset.outline }; store.set('outline', S.outline); applyOutline(); };
    $('outline-w').onclick = e => { const b = e.target.closest('button'); if (!b) return; S.outline = { ...S.outline, width: b.dataset.w }; store.set('outline', S.outline); applyOutline(); };
    $('size-seg').onclick = e => {
        const b = e.target.closest('button'); if (!b) return;
        S.labelSize = b.dataset.size; store.set('labelSize3', S.labelSize);
        applyLabelSize(); renderLabelControls();
    };
    // Remember which panel cards are open.
    for (const id of ['fmt-card', 'labels-card', 'labels-sub', 'rowlabels-sub']) {
        const el = $(id), open = store.get('open.' + id, null);
        if (open !== null) el.open = open;
        el.addEventListener('toggle', () => store.set('open.' + id, el.open));
    }

    const list = $('area-list');
    list.addEventListener('click', e => {
        // A row inside an expanded area: go to it on the map when it has a location.
        const item = e.target.closest('.items li[data-row]');
        if (item) {   // pin its card (click again to unpin); go to it when it has a location
            if (item.dataset.row === '') return;
            const i = +item.dataset.row;
            if (cardPinned === i) { pinRowCard(null); selectAlso([]); return; }
            popup.remove();
            pinRowCard(i, item);
            selectAlso(areasOfRow(i));   // a row listing several areas: mark the others too
            if (S.src.points?.[i]) map.flyTo({ center: S.src.points[i], zoom: isHex(S.layerId) ? map.getZoom() : Math.max(map.getZoom(), 15.5), duration: 600 });
            return;
        }
        if (e.target.closest('.items')) return;
        const li = e.target.closest('li[data-id]'); if (!li) return;
        // Clicking an area expands it to list its rows (no popup); clicking again collapses it.
        pinRowCard(null); popup.remove();
        openArea(li.dataset.id, { toggle: true });
    });
    // Hovering an area in the list highlights it and its rows on the map; hovering a row in an
    // expanded area highlights just that row.
    list.addEventListener('mouseover', e => {
        const li = e.target.closest('li[data-id]'); if (!li) return;
        // Only a row in an expanded area is enlarged on the map; hovering the area just outlines it.
        const item = e.target.closest('.items li[data-row]');
        if (item && item.dataset.row !== '') setHoverRow(+item.dataset.row, li.dataset.id); else setHover(li.dataset.id);   // a row: all its areas
        hlRows(item && item.dataset.row !== '' ? { row: +item.dataset.row } : null);
        showRowCard(item && item.dataset.row !== '' ? item : null);
        // With the table open: the hovered row is highlighted there (and scrolled to); an area's rows are tinted.
        tableHover(item && item.dataset.row !== '' ? +item.dataset.row : null);
        tableAreaHover(item ? null : li.dataset.id);
    });
    list.addEventListener('mouseleave', () => { setHover(null); hlRows(null); showRowCard(null); tableHover(null); tableAreaHover(null); });
    // The pinned card: hover it to scroll; ✕ or Esc closes it.
    $('rowcard').addEventListener('click', e => { if (e.target.closest('.card-x')) pinRowCard(null); });
    $('legend').addEventListener('click', e => {
        if (!e.target.closest('.lg-fold')) return;
        S.legendCompact = !S.legendCompact; store.set('legendCompact', S.legendCompact); renderLegend();
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape' && cardPinned != null) pinRowCard(null); });

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

// Console tool for trying label styles: Joiner.labelStyle({ width: 2.5, blur: 0.5, halo: '#fff', text: '#000' }).
// Applies to area labels (and row labels with rows: true) until the next Color or Size click, or
// Joiner.labelStyle('reset'). Returns the settings in effect.
function labelStyle(o = {}) {
    if (o === 'reset') { applyLabelColor(); applyLabelSize(); return 'Labels back to the panel settings.'; }
    const ids = ['area-labels', ...(o.rows ? ['rows-labels'] : [])];
    const P = { text: 'text-color', halo: 'text-halo-color', width: 'text-halo-width', blur: 'text-halo-blur', opacity: 'text-opacity' };
    for (const id of ids) {
        for (const [k, prop] of Object.entries(P)) if (o[k] != null) map.setPaintProperty(id, prop, o[k]);
        if (o.size != null) map.setLayoutProperty(id, 'text-size', o.size);
        if (o.font) map.setLayoutProperty(id, 'text-font', [o.font]);
        if (o.spacing != null) map.setLayoutProperty(id, 'text-letter-spacing', o.spacing);
    }
    // The first line of an area label is set in bold inside text-field; o.font changes the other lines.
    const g = (prop, lay) => JSON.stringify(lay ? map.getLayoutProperty('area-labels', prop) : map.getPaintProperty('area-labels', prop));
    return { text: g('text-color'), halo: g('text-halo-color'), width: g('text-halo-width'), blur: g('text-halo-blur'), size: g('text-size', 1), font: g('text-font', 1),
        fonts: ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'],
        note: 'Halos stop growing past about a quarter of the text size (MapLibre’s glyph buffer).' };
}

window.Joiner = { version: _BUILD_VERSION, state: S, table: T, loadFile, labelStyle, get map() { return map; } };   // for debugging in the console
boot().catch(e => { console.error(e); alert('Joiner failed to start: ' + e.message); });
})();
