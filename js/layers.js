// Layers: sf-blocks' map layers (points, lines and areas: Muni, the bike network, schools, street trees,
// businesses…) drawn over Joiner's areas, off until turned on. The list comes from sf-blocks itself
// (data/layers/index.json and data/tiles/index.json), so new layers show up here without a Joiner change.
// Each layer has Show (draw it) and Count (load it as the data, so its features join to the areas like a
// loaded file), and its categories as chips, drawn in their own colors: a click shows only that category,
// and filters the count too while it's counted (v55).
//   ?layers=schools,bike   turns those on (kept in the link and in snapshots)
const CityLayers = (() => {
    // one color per layer, in order; none of them the areas' palettes' darkest steps
    const COLORS = ['#E8590C', '#7048E8', '#0C8599', '#C2255C', '#2F9E44', '#1971C2', '#F08C00', '#5C940D', '#862E9C', '#495057'];
    // until sf-blocks has data/layers/index.json (sf-blocks#50), its seven small layers
    const FALLBACK = [
        ['muni', 'Muni routes', 'LineString', 'service', 'route'], ['bike', 'Bike network', 'LineString', 'cls', 'kind'],
        ['slow', 'Slow Streets', 'LineString', 'status', 'corridor'], ['schools', 'Schools', 'Point', 'type', 'name'],
        ['stations', 'Fire and police stations', 'Point', 'kind', 'name'], ['health', 'Health care facilities', 'Point', 'kind', 'name'],
        ['lands', 'City-owned land', 'Polygon', 'cat', 'name'],
    ].map(([id, label, geometry, category, name]) => ({ id, label, file: id + '.geojson', format: 'geojson', geometry, category, name }));
    const NAME_FIELDS = ['name', 'label', 'title', 'dba', 'stopname', 'common', 'species', 'route', 'corridor', 'kind'];
    const SKIP = /^(_|geom|the_geom|shape|wkt|point_[xy]|latitude|longitude|lat|lon|lng)$/i;
    // a few layers keep a color that suits them (trees green, businesses orange)
    const OWN_COLOR = { street_trees: '#2F9E44', businesses: '#E8590C' };
    const KEY = 'joiner.cityLayers', CAT_KEY = 'joiner.cityLayerCats';
    const GRAY = '#ADB5BD', SHOW_CATS = 8, PAL_N = 10;
    // fields a big layer's chips follow first, when it has them
    const CAT_PREF = ['cat', 'genus', 'kind', 'type', 'status', 'service', 'cls', 'survey'];
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let map, opts = {}, list = [], tip = null, readyP = null;
    const on = new Set(), byId = new Map();

    const geomsOf = l => [].concat(l.geometry || []).map(g => String(g).replace('Multi', ''));
    const kindOf = l => { const g = geomsOf(l); return g.includes('Polygon') ? 'Polygon' : g.includes('LineString') ? 'LineString' : 'Point'; };
    const ids = l => ['fill', 'line', 'pt'].map(k => `cl-${l.id}-${k}`);
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...on])); } catch (e) { } };
    const nameField = l => l.name || NAME_FIELDS.find(f => l.fields && f in l.fields) || null;

    // ---- categories (v55) ----
    // The fields a layer's chips can follow, each with its values and counts: a small layer's manifest
    // `category`; a big layer's text fields from its stats file (only fields on the features themselves).
    function catFields(l) {
        if (l.group !== 'tiles') return l.category && l.categories && Object.keys(l.categories).length > 1 ? [{ field: l.category, values: l.categories }] : [];
        const fs = l.stats_data?.fields || {};
        const out = Object.entries(fs).filter(([k, f]) => f.values && l.fields?.[k] === 'text' && Object.keys(f.values).length > 1)
            .map(([k, f]) => ({ field: k, values: f.values, others: f.others || 0 }));
        const rank = k => { const i = CAT_PREF.indexOf(k); return i < 0 ? 99 : i; };
        return out.sort((a, b) => rank(a.field) - rank(b.field));
    }
    // HSL shades of one color: the layer's own first, then lighter and darker by turns
    function shades(hex, n) {
        const h = hex.replace('#', ''), [r, g, b] = [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16) / 255);
        const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let hu = 0, sa = 0; const li = (mx + mn) / 2;
        if (d) { sa = d / (1 - Math.abs(2 * li - 1)); hu = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; hu *= 60; if (hu < 0) hu += 360; }
        const steps = [0, 16, -13, 28, -22, 38, -30, 8, -6, 22];
        return steps.slice(0, n).map(st => `hsl(${Math.round(hu)} ${Math.round(sa * 100)}% ${Math.round(Math.max(14, Math.min(84, li * 100 + st)))}%)`);
    }
    // the chips' state for a layer: { field, only: Set | null, hide: bool, more: bool }
    const catState = new Map();
    function cats(l) {
        const fs = catFields(l); if (!fs.length) return null;
        const st = catState.get(l.id) || {};
        const f = fs.find(x => x.field === st.field) || fs[0];
        const vals = Object.entries(f.values).sort((a, b) => b[1] - a[1]);
        const pal = l.colors ? null : shades(l.color, Math.min(PAL_N, vals.length));
        const list = vals.map(([v, n], i) => ({ v, n, c: l.colors ? (l.colors[v] || GRAY) : i < pal.length && (vals.length <= PAL_N || i < PAL_N) ? pal[i] : GRAY }));
        return { field: f.field, fields: fs.map(x => x.field), list, others: f.others || 0, only: st.only || null, hide: !!st.hide, more: !!st.more };
    }
    const catShown = (c, v) => !c.only || (c.hide ? !c.only.has(v) : c.only.has(v));
    // Block Party's rule: the first click shows only that category, the same one again shows all but it,
    // others toggle
    function pickCat(id, v) {
        const st = { ...(catState.get(id) || {}) }, only = st.only ? new Set(st.only) : null;
        if (!only) { st.only = new Set([v]); st.hide = false; }
        else if (!st.hide && only.size === 1 && only.has(v)) { st.hide = true; }
        else { only.has(v) ? only.delete(v) : only.add(v); st.only = only.size ? only : null; if (!st.only) st.hide = false; }
        catState.set(id, st); catsChanged(id);
    }
    function setCatField(id, field) { catState.set(id, { ...(catState.get(id) || {}), field, only: null, hide: false }); catsChanged(id); }
    function catsChanged(id) {
        const l = byId.get(id); saveCats();
        if (l && map.getSource('cl-' + l.id)) paintCats(l);
        render(); opts.changed?.();
        if (counted() === id) countFilter(l);
    }
    // tell the app which rows to count: those in the shown categories
    function countFilter(l) {
        const c = cats(l);
        opts.countFilter?.(l.id, c?.field, c && c.only ? v => catShown(c, v) : null, c && c.only ? catWords(c) : '');
    }
    const catWords = c => (c.hide ? 'all but ' : '') + [...c.only].slice(0, 3).join(', ') + (c.only.size > 3 ? ` +${c.only.size - 3}` : '');
    const geomFilter = (l, k) => {
        const g = geomsOf(l), isPoly = ['==', ['geometry-type'], 'Polygon'], isLine = ['==', ['geometry-type'], 'LineString'], isPt = ['==', ['geometry-type'], 'Point'];
        return k === 'fill' ? isPoly : k === 'line' ? (g.includes('Polygon') ? ['any', isLine, isPoly] : isLine) : isPt;
    };
    // colors and filters by category on the layer's map layers
    function paintCats(l) {
        const c = cats(l), [fill, line, pt] = ids(l);
        const val = c ? ['to-string', ['coalesce', ['get', c.field], '']] : null;
        const color = c ? ['match', val, ...c.list.flatMap(x => [x.v, x.c]), GRAY] : l.color;
        const keep = c && c.only ? (f => c.hide ? ['all', f, ['!', ['in', val, ['literal', [...c.only]]]]] : ['all', f, ['in', val, ['literal', [...c.only]]]]) : f => f;
        if (map.getLayer(fill)) { map.setPaintProperty(fill, 'fill-color', color); map.setFilter(fill, keep(geomFilter(l, 'fill'))); }
        if (map.getLayer(line)) { map.setPaintProperty(line, 'line-color', color); map.setFilter(line, keep(geomFilter(l, 'line'))); }
        if (map.getLayer(pt)) { map.setPaintProperty(pt, 'circle-color', color); map.setFilter(pt, keep(geomFilter(l, 'pt'))); }
    }
    function saveCats() {
        try { localStorage.setItem(CAT_KEY, JSON.stringify(catsOut())); } catch (e) { }
    }
    const catsOut = () => Object.fromEntries([...catState].filter(([, s]) => s.field || s.only).map(([id, s]) => [id, { field: s.field || null, only: s.only ? [...s.only] : null, hide: !!s.hide }]));
    function catsIn(o) {
        catState.clear();
        for (const [id, s] of Object.entries(o || {})) catState.set(id, { field: s.field || undefined, only: s.only ? new Set(s.only) : null, hide: !!s.hide });
    }
    const counted = () => opts.countedId?.() || null;

    function init(m, o = {}) { return (readyP = start(m, o)); }
    async function start(m, o) {
        map = m; opts = o;
        if (window.pmtiles && !init.proto) { const p = new pmtiles.Protocol(); maplibregl.addProtocol('pmtiles', p.tile); init.proto = true; }
        const region = await SFBlocks.ready;
        const tilesPath = region.tiles || 'data/tiles/index.json', tilesDir = tilesPath.replace(/[^/]*$/, '');
        const layersDir = (region.layers || 'data/layers/').replace(/\/?$/, '/');
        const [small, big] = await Promise.all([
            SFBlocks.json(layersDir + 'index.json').then(d => d.layers).catch(() => FALLBACK),
            SFBlocks.json(tilesPath).then(d => d.layers).catch(() => []),
        ]);
        list = [
            ...small.map(l => ({ ...l, group: 'city', path: layersDir + l.file })),
            ...big.map(l => ({ ...l, group: 'tiles', path: tilesDir + l.file })),
        ];
        // big point layers (street trees, businesses) only from zoom 14: at city zoom they're a smear
        await Promise.all(list.filter(l => l.group === 'tiles' && l.stats).map(l => SFBlocks.json(tilesDir + l.stats).then(d => { l.stats_data = d; }).catch(() => { })));
        try { catsIn(JSON.parse(localStorage.getItem(CAT_KEY))); } catch (e) { }
        list.forEach((l, i) => { l.color = OWN_COLOR[l.id] || COLORS[i % COLORS.length]; l.from = Math.max(l.minzoom || 0, kindOf(l) === 'Point' && l.features > 20000 ? 14 : 0); byId.set(l.id, l); });
        // the link wins; else what this browser had on
        const q = new URLSearchParams(location.search).get('layers');
        let want = q != null ? q.split(',') : []; if (q == null) try { want = JSON.parse(localStorage.getItem(KEY)) || []; } catch (e) { }
        want.filter(id => byId.has(id)).forEach(id => show(id, true, { quiet: true }));
        wire();
        render(); writeLink(); opts.changed?.();
        map.on('zoomend', () => { if (on.size) opts.changed?.(); });
    }

    function ensure(l) {
        const sid = 'cl-' + l.id; if (map.getSource(sid)) return;
        const url = SFBlocks.url(l.path);
        map.addSource(sid, l.format === 'pmtiles' ? { type: 'vector', url: 'pmtiles://' + url } : { type: 'geojson', data: url });
        const src = { source: sid, ...(l.format === 'pmtiles' ? { 'source-layer': l.layer || l.id } : {}), minzoom: l.from || 0 };
        // over the areas, under the loaded rows and every label
        const before = ['rows-fill', 'rows-line', 'rows-pt'].find(id => map.getLayer(id)) || opts.before?.();
        const [fill, line, pt] = ids(l), c = l.color, g = geomsOf(l);
        const isPoly = ['==', ['geometry-type'], 'Polygon'], isLine = ['==', ['geometry-type'], 'LineString'], isPt = ['==', ['geometry-type'], 'Point'];
        if (g.includes('Polygon')) map.addLayer({ id: fill, type: 'fill', ...src, filter: isPoly, paint: { 'fill-color': c, 'fill-opacity': 0.16 } }, before);
        map.addLayer({ id: line, type: 'line', ...src, filter: g.includes('Polygon') ? ['any', isLine, isPoly] : isLine,
            layout: { 'line-cap': 'round', 'line-join': 'round' },
            paint: { 'line-color': c, 'line-opacity': 0.9, 'line-width': ['interpolate', ['linear'], ['zoom'], 11, g.includes('Polygon') ? 0.8 : 1.4, 16, g.includes('Polygon') ? 1.6 : 3.5] } }, before);
        map.addLayer({ id: pt, type: 'circle', ...src, filter: isPt,
            paint: { 'circle-color': c, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 2.2, 14, 4, 17, 6.5],
                'circle-stroke-color': '#fff', 'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 11, 0.6, 15, 1.2] } }, before);
        paintCats(l);
        for (const id of ids(l)) {
            if (!map.getLayer(id)) continue;
            map.on('mousemove', id, e => hover(l, e));
            map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; tip?.remove(); });
        }
    }

    function hover(l, e) {
        const f = e.features && e.features[0]; if (!f) return;
        map.getCanvas().style.cursor = 'default';
        const p = f.properties || {}, nf = nameField(l), title = nf && p[nf] != null && p[nf] !== '' ? p[nf] : l.label;
        const rows = Object.entries(p).filter(([k, v]) => k !== nf && !SKIP.test(k) && v != null && v !== '').slice(0, 8)
            .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(String(v).slice(0, 80))}</td></tr>`).join('');
        if (!tip) tip = new maplibregl.Popup({ closeButton: false, closeOnClick: false, className: 'cl-tip', offset: 10, maxWidth: '280px' });
        const c = cats(l), dot = c ? (c.list.find(x => x.v === String(p[c.field] ?? ''))?.c || GRAY) : l.color;
        tip.setLngLat(e.lngLat).setHTML(`<div class="cl-tip-in"><span class="cl-dot" style="background:${dot}"></span><b>${esc(title)}</b><div class="cl-src">${esc(l.label)}</div>${rows ? `<table>${rows}</table>` : ''}</div>`).addTo(map);
    }

    function show(id, yes, { quiet = false } = {}) {
        const l = byId.get(id); if (!l) return;
        if (yes) { ensure(l); on.add(id); } else on.delete(id);
        for (const lid of ids(l)) if (map.getLayer(lid)) map.setLayoutProperty(lid, 'visibility', yes ? 'visible' : 'none');
        if (!yes) tip?.remove();
        if (quiet) return;
        save(); writeLink(); render(); opts.changed?.();
    }

    // ?layers= in the link, so a shared link opens with the same layers on
    function writeLink() {
        const q = new URLSearchParams(location.search);
        if (on.size) q.set('layers', [...on].join(',')); else q.delete('layers');
        const s = q.toString().replace(/%2C/g, ',');
        history.replaceState(null, '', location.pathname + (s ? '?' + s : '') + location.hash);
    }

    const fmtN = n => n >= 1e4 ? `${Math.round(n / 1e3)}K` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}K` : String(n);
    const swatch = l => { const k = kindOf(l);
        return k === 'Point' ? `<i class="cl-sw pt" style="background:${l.color}"></i>`
            : k === 'Polygon' ? `<i class="cl-sw poly" style="border-color:${l.color};background:${l.color}33"></i>`
            : `<i class="cl-sw ln" style="background:${l.color}"></i>`; };
    const fmtC = n => Number(n).toLocaleString();
    // the chips under a layer: its categories with counts, in the colors they draw in
    function catsHTML(l) {
        const c = cats(l); if (!c) return '';
        const n = c.more ? c.list.length : Math.min(SHOW_CATS, c.list.length), rest = c.list.length - n;
        const chips = c.list.slice(0, n).map(x => `<button type="button" class="cl-cat${catShown(c, x.v) ? '' : ' off'}" data-cl-cat="${esc(l.id)}" data-v="${esc(x.v)}" aria-pressed="${c.only && catShown(c, x.v) ? 'true' : 'false'}" title="${c.only ? 'Click to show or hide' : 'Show only this'}"><i style="background:${x.c}"></i>${esc(x.v)} <em>${fmtC(x.n)}</em></button>`).join('');
        const more = rest > 0 ? `<button type="button" class="cl-cat more" data-cl-more="${esc(l.id)}">+${rest} more</button>`
            : c.more && c.list.length > SHOW_CATS ? `<button type="button" class="cl-cat more" data-cl-more="${esc(l.id)}">fewer</button>` : '';
        const others = c.others && (c.more || rest <= 0) ? `<span class="cl-cat more"><i style="background:${GRAY}"></i>others <em>${fmtC(c.others)}</em></span>` : '';
        const pick = c.fields.length > 1 ? `<label class="cl-by">by <select data-cl-field="${esc(l.id)}">${c.fields.map(f => `<option value="${esc(f)}"${f === c.field ? ' selected' : ''}>${esc(f)}</option>`).join('')}</select></label>` : `<span class="cl-by">by ${esc(c.field)}</span>`;
        const all = c.only ? `<button type="button" class="cl-cat more" data-cl-all="${esc(l.id)}">show all</button>` : '';
        return `<div class="cl-cats">${pick}${chips}${more}${others}${all}</div>`;
    }

    function render() {
        const b = $('layers-toggle'); if (!b) return;
        b.hidden = !list.length;
        b.setAttribute('aria-pressed', on.size ? 'true' : 'false');
        b.querySelector('.n').textContent = on.size ? ` · ${on.size}` : '';
        const pop = $('layers-pop'); if (!pop || pop.hidden) return;
        const cid = counted();
        const row = l => {
            const what = kindOf(l) === 'Point' ? (l.grouped_by === 'address' ? 'addresses' : 'points') : kindOf(l) === 'Polygon' ? 'areas' : 'lines';
            const meta = [l.features != null ? `${fmtC(l.features)} ${what}` : '', l.records && l.records !== l.features ? `${fmtC(l.records)} ${l.label.toLowerCase()}` : '',
                l.from > 11 ? `from zoom ${l.from}` : '', l.data_as_of || l.retrieved || l.year || ''].filter(Boolean).join(' · ');
            const isOn = on.has(l.id), isCnt = cid === l.id;
            const cntTip = isCnt ? 'Counted: these features are the data now. Load other data to stop.'
                : l.format === 'pmtiles' ? `Read all ${l.features ? fmtC(l.features) + ' ' : ''}of its features from its tiles and count them in the areas (a few seconds to a minute)` : 'Load its features as the data and count them in the areas';
            const line = isCnt ? `<div class="cl-counting">${esc(opts.countLine?.() || 'Counted in the areas')}</div>` : '';
            return `<li class="${isCnt ? 'is-counted' : ''}">${swatch(l)}<span class="cl-name">${esc(l.label)}</span>
                <span class="cl-pill" role="group" aria-label="${esc(l.label)}"><button type="button" data-cl-show="${esc(l.id)}" aria-pressed="${isOn}" title="${isOn ? 'Hide it' : 'Draw it over the areas'}">Show</button><button type="button" data-cl-use="${esc(l.id)}" aria-pressed="${isCnt}" class="${isCnt ? 'cnt' : ''}" title="${esc(cntTip)}">Count${isCnt ? ' ✓' : ''}</button></span>
                <span class="cl-meta">${esc(meta)}${l.page ? ` · <a href="${esc(l.page)}" target="_blank" rel="noopener" title="${esc(l.title || 'Source')}">source</a>` : ''}</span>
                ${line}${catsHTML(l)}</li>`;
        };
        const group = (g, title, note) => { const ls = list.filter(l => l.group === g); return ls.length ? `<h4>${esc(title)}</h4>${note ? `<p class="cl-note">${esc(note)}</p>` : ''}<ul>${ls.map(row).join('')}</ul>` : ''; };
        const keep = pop.scrollTop;
        pop.innerHTML = `<div class="cl-head"><b>Layers</b><span class="cl-from">from ${esc(SFBlocks.describe())}</span></div>`
            + `<p class="cl-note">Show draws a layer over the areas. Count makes it the data, so the areas are colored by it. Click a category to show only that one.</p>`
            + group('city', 'City layers', '')
            + group('tiles', 'Big layers', 'Counting reads every feature from the tiles: a few seconds to a minute.')
            + `<div class="cl-foot"><button type="button" class="btn small ghost" data-cl-none ${on.size ? '' : 'disabled'}>Turn all off</button></div>`;
        pop.scrollTop = keep;
    }

    function place() {
        const b = $('layers-toggle'), pop = $('layers-pop'); if (!b || !pop || pop.hidden) return;
        const r = b.getBoundingClientRect();
        pop.style.top = `${Math.round(r.bottom + 6)}px`;
        pop.style.left = `${Math.round(Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)))}px`;
    }
    function open(yes) {
        const b = $('layers-toggle'), pop = $('layers-pop');
        pop.hidden = !yes; b.setAttribute('aria-expanded', yes ? 'true' : 'false');
        if (yes) { render(); place(); }
    }

    const urlOf = l => (SFBlocks.info.base || new URL('./', location.href).href) + l.path;
    // the layer a loaded link is, if it's one (a reopened ?url= link counts as that layer again)
    const idForUrl = url => { const u = String(url || '').split('?')[0]; return list.find(l => l.group === 'city' && (u === urlOf(l) || u.endsWith('/' + l.path)))?.id || null; };

    function wire() {
        const b = $('layers-toggle'), pop = $('layers-pop'); if (!b || !pop || wire.done) return; wire.done = true;
        b.addEventListener('click', e => { e.stopPropagation(); open(pop.hidden); });
        pop.addEventListener('click', e => e.stopPropagation());
        pop.addEventListener('change', e => { const f = e.target.closest('[data-cl-field]'); if (f) setCatField(f.dataset.clField, f.value); });
        pop.addEventListener('click', e => {
            const sh = e.target.closest('[data-cl-show]');
            if (sh) { show(sh.dataset.clShow, !on.has(sh.dataset.clShow)); return; }
            const cat = e.target.closest('[data-cl-cat]');
            if (cat) { pickCat(cat.dataset.clCat, cat.dataset.v); return; }
            const mo = e.target.closest('[data-cl-more]');
            if (mo) { const st = catState.get(mo.dataset.clMore) || {}; catState.set(mo.dataset.clMore, { ...st, more: !st.more }); render(); return; }
            const al = e.target.closest('[data-cl-all]');
            if (al) { const st = catState.get(al.dataset.clAll) || {}; catState.set(al.dataset.clAll, { ...st, only: null, hide: false }); catsChanged(al.dataset.clAll); return; }
            const u = e.target.closest('[data-cl-use]');
            if (u) { const l = byId.get(u.dataset.clUse); if (counted() === l.id) return;
                open(false);
                // Count shows it too; small layers load as a link (?url=), big ones are read from their tiles (?layerdata=)
                if (!on.has(l.id)) show(l.id, true);
                if (l.format === 'pmtiles') { opts.useLayer?.(l.id); return; }
                opts.useAsData?.(urlOf(l), l.label, l.id); return; }
            if (e.target.closest('[data-cl-none]')) { [...on].forEach(id => show(id, false, { quiet: true })); save(); writeLink(); render(); opts.changed?.(); }
        });
        document.addEventListener('click', () => { if (!pop.hidden) open(false); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) open(false); });
        addEventListener('resize', place);
    }

    // ---- reading a big layer's tiles, for Use as data (v54) ----
    // A small Mapbox Vector Tile reader: every feature of one layer in one tile, with lon/lat coordinates.
    function decodeMVT(buf, z, x, y, want) {
        const td = new TextDecoder(); let pos = 0;
        const vint = () => { let r = 0, s = 1, b; do { b = buf[pos++]; r += (b & 0x7f) * s; s *= 128; } while (b >= 0x80); return r; };
        const zz = n => (n % 2 ? -(n + 1) / 2 : n / 2);
        const skip = w => { if (w === 0) vint(); else if (w === 1) pos += 8; else if (w === 2) pos += vint(); else if (w === 5) pos += 4; };
        const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
        const out = [];
        while (pos < buf.length) {
            const tag = vint(); if ((tag >> 3) !== 3 || (tag & 7) !== 2) { skip(tag & 7); continue; }
            const len = vint(), end = pos + len; let name = '', extent = 4096; const keys = [], vals = [], feats = [];
            while (pos < end) {
                const t = vint(), f = t >> 3, w = t & 7;
                if (f === 1 && w === 2) { const n = vint(); name = td.decode(buf.subarray(pos, pos + n)); pos += n; }
                else if (f === 3 && w === 2) { const n = vint(); keys.push(td.decode(buf.subarray(pos, pos + n))); pos += n; }
                else if (f === 4 && w === 2) {
                    const vl = vint(), ve = pos + vl; let v = null;
                    while (pos < ve) { const vt = vint(), vf = vt >> 3;
                        if (vf === 1) { const n = vint(); v = td.decode(buf.subarray(pos, pos + n)); pos += n; }
                        else if (vf === 2) { v = dv.getFloat32(pos, true); pos += 4; } else if (vf === 3) { v = dv.getFloat64(pos, true); pos += 8; }
                        else if (vf === 4 || vf === 5) v = vint(); else if (vf === 6) v = zz(vint()); else if (vf === 7) v = !!vint(); else skip(vt & 7); }
                    vals.push(v);
                }
                else if (f === 5 && w === 0) extent = vint();
                else if (f === 2 && w === 2) { const n = vint(); feats.push([pos, pos + n]); pos += n; }
                else skip(w);
            }
            pos = end;
            if (want && name !== want) continue;
            const n2 = 2 ** z, toLL = (px, py) => { const lon = (x + px / extent) / n2 * 360 - 180, yy = Math.PI * (1 - 2 * (y + py / extent) / n2);
                return [+lon.toFixed(7), +(Math.atan(Math.sinh(yy)) * 180 / Math.PI).toFixed(7)]; };
            for (const [a, b] of feats) {
                pos = a; let type = 0, tags = [], geom = [];
                while (pos < b) { const t = vint(), f = t >> 3;
                    if (f === 2) { const l2 = vint(), e = pos + l2; while (pos < e) tags.push(vint()); }
                    else if (f === 3) type = vint();
                    else if (f === 4) { const l2 = vint(), e = pos + l2; while (pos < e) geom.push(vint()); }
                    else skip(t & 7); }
                const props = {}; for (let i = 0; i + 1 < tags.length; i += 2) props[keys[tags[i]]] = vals[tags[i + 1]];
                // geometry commands → rings / lines / points, in tile units
                const parts = []; let cx = 0, cy = 0, cur = null;
                for (let i = 0; i < geom.length;) { const c = geom[i++], id = c & 7, cnt = c >> 3;
                    if (id === 7) { if (cur && cur.length) cur.push(cur[0]); continue; }
                    for (let k = 0; k < cnt; k++) { cx += zz(geom[i++]); cy += zz(geom[i++]);
                        if (id === 1 || !cur) { cur = [[cx, cy]]; parts.push(cur); } else cur.push([cx, cy]); } }
                if (!parts.length || !parts[0].length) continue;
                const inTile = ([px, py]) => px >= 0 && px < extent && py >= 0 && py < extent;
                let g = null;
                if (type === 1) { const p = parts.map(q => q[0]).filter(inTile); if (!p.length) continue;   // points near the edge are in two tiles: keep the tile they're in
                    g = p.length === 1 ? { type: 'Point', coordinates: toLL(...p[0]) } : { type: 'MultiPoint', coordinates: p.map(q => toLL(...q)) }; }
                else if (type === 2) g = parts.length === 1 ? { type: 'LineString', coordinates: parts[0].map(q => toLL(...q)) } : { type: 'MultiLineString', coordinates: parts.map(l => l.map(q => toLL(...q))) };
                else if (type === 3) { const polys = []; for (const r of parts) { let a2 = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a2 += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
                        if (a2 < 0 || !polys.length) polys.push([r]); else polys[polys.length - 1].push(r); }
                    const ll = polys.map(p => p.map(r => r.map(q => toLL(...q))));
                    g = ll.length === 1 ? { type: 'Polygon', coordinates: ll[0] } : { type: 'MultiPolygon', coordinates: ll };
                    // a shape cut by tile edges: count it in the tile holding its first corner only
                    if (!inTile(parts[0][0])) props.__edge = 1; }
                if (g) out.push({ type: 'Feature', properties: props, geometry: g });
            }
            pos = end;   // on to the next layer in the tile
        }
        return out;
    }

    // every feature of a layer, as a FeatureCollection: GeoJSON layers are fetched; PMTiles layers are read
    // tile by tile at full detail across their bounds (onProgress(done, total, features))
    async function readAll(id, onProgress) {
        const l = byId.get(id); if (!l) throw new Error(`No layer ${id}`);
        const url = SFBlocks.url(l.path);
        if (l.format !== 'pmtiles') { const r = await fetch(url); if (!r.ok) throw new Error(`${l.label}: ${r.status}`); return r.json(); }
        const pm = new pmtiles.PMTiles(url), h = await pm.getHeader();
        const z = Math.min(h.maxZoom, l.maxzoom ?? h.maxZoom), n2 = 2 ** z;
        const tx = lon => Math.floor((lon + 180) / 360 * n2), ty = lat => { const r = lat * Math.PI / 180; return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n2); };
        const xs = [tx(h.minLon), tx(h.maxLon)], ys = [ty(h.maxLat), ty(h.minLat)];
        const jobs = []; for (let x = xs[0]; x <= xs[1]; x++) for (let y = ys[0]; y <= ys[1]; y++) jobs.push([x, y]);
        const feats = [], seen = new Set(), idKey = ['id', 'treeid', 'blklot', 'permit_number'].find(k => l.fields && k in l.fields);
        let done = 0, next = 0;
        const worker = async () => { while (next < jobs.length) { const [x, y] = jobs[next++];
            const r = await pm.getZxy(z, x, y);
            if (r && r.data) for (const f of decodeMVT(new Uint8Array(r.data), z, x, y, l.layer || l.id)) {
                const k = idKey && f.properties[idKey] != null ? f.properties[idKey] : null;
                if (k != null) { if (seen.has(k)) continue; seen.add(k); }
                else if (f.properties.__edge) continue;
                delete f.properties.__edge; feats.push(f); }
            done++; onProgress?.(done, jobs.length, feats.length); } };
        await Promise.all(Array.from({ length: 12 }, worker));
        return { type: 'FeatureCollection', features: feats };
    }

    // rows for the map key: each layer that's on, with a note when it only draws from closer in
    function legendHTML() {
        if (!on.size) return '';
        const z = map ? map.getZoom() : 99;
        return `<h4 class="rows-h cl-h">Layers</h4>` + [...on].map(id => byId.get(id)).filter(Boolean).map(l =>
            { const c = cats(l);
            return `<div class="row cl-row">${swatch(l)}<span>${esc(l.label)}${c && c.only ? ` <span class="cl-only">· ${esc(catWords(c))}</span>` : ''}</span><span class="n">${l.from && z < l.from ? `zoom in (${l.from}+)` : l.features != null ? fmtN(l.features) : ''}</span></div>`; }).join('');
    }

    return {
        init, show, legendHTML, readAll, decodeMVT, idForUrl,
        refresh: () => render(),
        // after a layer is counted: apply its chips to the count
        counted: id => { const l = byId.get(id); if (l) countFilter(l); render(); },
        get cats() { return catsOut(); },
        setCats: o => { catsIn(o); saveCats(); list.forEach(l => { if (map.getSource('cl-' + l.id)) paintCats(l); }); render(); opts.changed?.(); },
        get ready() { return readyP; },
        byId: id => byId.get(id),
        list: () => [...on],
        set: idsOn => { [...on].forEach(id => show(id, false, { quiet: true })); (idsOn || []).filter(id => byId.has(id)).forEach(id => show(id, true, { quiet: true })); save(); writeLink(); render(); opts.changed?.(); },
        get layers() { return list.slice(); },
    };
})();
window.CityLayers = CityLayers;
