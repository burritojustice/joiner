// Layers: sf-blocks' map layers (points, lines and areas: Muni, the bike network, schools, street trees,
// businesses…) drawn over Joiner's areas, off until turned on. The list comes from sf-blocks itself
// (data/layers/index.json and data/tiles/index.json), so new layers show up here without a Joiner change.
// A small layer can also be loaded as data, so its features join to the areas like a loaded file.
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
    const KEY = 'joiner.cityLayers';
    const $ = id => document.getElementById(id);
    const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    let map, opts = {}, list = [], tip = null;
    const on = new Set(), byId = new Map();

    const geomsOf = l => [].concat(l.geometry || []).map(g => String(g).replace('Multi', ''));
    const kindOf = l => { const g = geomsOf(l); return g.includes('Polygon') ? 'Polygon' : g.includes('LineString') ? 'LineString' : 'Point'; };
    const ids = l => ['fill', 'line', 'pt'].map(k => `cl-${l.id}-${k}`);
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...on])); } catch (e) { } };
    const nameField = l => l.name || NAME_FIELDS.find(f => l.fields && f in l.fields) || null;

    async function init(m, o = {}) {
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
        list.forEach((l, i) => { l.color = COLORS[i % COLORS.length]; l.from = Math.max(l.minzoom || 0, kindOf(l) === 'Point' && l.features > 20000 ? 14 : 0); byId.set(l.id, l); });
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
        tip.setLngLat(e.lngLat).setHTML(`<div class="cl-tip-in"><span class="cl-dot" style="background:${l.color}"></span><b>${esc(title)}</b><div class="cl-src">${esc(l.label)}</div>${rows ? `<table>${rows}</table>` : ''}</div>`).addTo(map);
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
    const canUse = l => l.format !== 'pmtiles';

    function render() {
        const b = $('layers-toggle'); if (!b) return;
        b.hidden = !list.length;
        b.setAttribute('aria-pressed', on.size ? 'true' : 'false');
        b.querySelector('.n').textContent = on.size ? ` · ${on.size}` : '';
        const pop = $('layers-pop'); if (!pop) return;
        const row = l => {
            const meta = [l.features != null ? `${fmtN(l.features)} ${kindOf(l) === 'Point' ? 'points' : kindOf(l) === 'Polygon' ? 'areas' : 'lines'}` : '',
                l.from > 11 ? `from zoom ${l.from}` : '', l.data_as_of || l.retrieved || l.year || ''].filter(Boolean).join(' · ');
            return `<li><label><input type="checkbox" data-cl="${esc(l.id)}" ${on.has(l.id) ? 'checked' : ''}>${swatch(l)}<span class="cl-name">${esc(l.label)}</span></label>
                <span class="cl-meta">${esc(meta)}${l.page ? ` · <a href="${esc(l.page)}" target="_blank" rel="noopener" title="${esc(l.title || 'Source')}">source</a>` : ''}</span>
                ${canUse(l) ? `<button type="button" class="btn small ghost" data-cl-use="${esc(l.id)}" title="Load its features as the data, so they're counted in the areas">Use as data</button>` : ''}</li>`;
        };
        const group = (g, title, note) => { const ls = list.filter(l => l.group === g); return ls.length ? `<h4>${esc(title)}</h4>${note ? `<p class="cl-note">${esc(note)}</p>` : ''}<ul>${ls.map(row).join('')}</ul>` : ''; };
        pop.innerHTML = `<div class="cl-head"><b>Layers</b><span class="cl-from">from ${esc(SFBlocks.describe())}</span></div>`
            + group('city', 'City layers', '')
            + group('tiles', 'Big layers', 'Drawn from close in; too big to load as data here yet.')
            + `<div class="cl-foot"><button type="button" class="btn small ghost" data-cl-none ${on.size ? '' : 'disabled'}>Turn all off</button></div>`;
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

    function wire() {
        const b = $('layers-toggle'), pop = $('layers-pop'); if (!b || !pop || wire.done) return; wire.done = true;
        b.addEventListener('click', e => { e.stopPropagation(); open(pop.hidden); });
        pop.addEventListener('click', e => e.stopPropagation());
        pop.addEventListener('change', e => { const c = e.target.closest('[data-cl]'); if (c) show(c.dataset.cl, c.checked); });
        pop.addEventListener('click', e => {
            const u = e.target.closest('[data-cl-use]');
            if (u) { const l = byId.get(u.dataset.clUse); open(false);
                const base = SFBlocks.info.base || new URL('./', location.href).href;
                opts.useAsData?.(base + l.path, l.label); return; }
            if (e.target.closest('[data-cl-none]')) { [...on].forEach(id => show(id, false, { quiet: true })); save(); writeLink(); render(); opts.changed?.(); }
        });
        document.addEventListener('click', () => { if (!pop.hidden) open(false); });
        document.addEventListener('keydown', e => { if (e.key === 'Escape' && !pop.hidden) open(false); });
        addEventListener('resize', place);
    }

    // rows for the map key: each layer that's on, with a note when it only draws from closer in
    function legendHTML() {
        if (!on.size) return '';
        const z = map ? map.getZoom() : 99;
        return `<h4 class="rows-h cl-h">Layers</h4>` + [...on].map(id => byId.get(id)).filter(Boolean).map(l =>
            `<div class="row cl-row">${swatch(l)}<span>${esc(l.label)}</span><span class="n">${l.from && z < l.from ? `zoom in (${l.from}+)` : l.features != null ? fmtN(l.features) : ''}</span></div>`).join('');
    }

    return {
        init, show, legendHTML,
        list: () => [...on],
        set: idsOn => { [...on].forEach(id => show(id, false, { quiet: true })); (idsOn || []).filter(id => byId.has(id)).forEach(id => show(id, true, { quiet: true })); save(); writeLink(); render(); opts.changed?.(); },
        get layers() { return list.slice(); },
    };
})();
window.CityLayers = CityLayers;
