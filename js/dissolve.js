// Dissolve polygons that share a property into one shape per value: election precincts into
// their US House, State Senate or Assembly district, say. Shared edges cancel out, and the edges
// left over are chained back into rings. This needs neighbors to share their vertices exactly
// (true of precinct files cut from one map); where they don't, the group falls back to the
// member polygons as one MultiPolygon, which fills the same but shows the inner lines.
(function (root) {
    const key = p => p[0].toFixed(7) + ',' + p[1].toFixed(7);
    const signedArea = ring => { let a = 0; for (let i = 0, n = ring.length - 1; i < n; i++) a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return a / 2; };
    const polysOf = g => !g ? [] : g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    function inRing(pt, ring) {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
            const [xi, yi] = ring[i], [xj, yj] = ring[j];
            if ((yi > pt[1]) !== (yj > pt[1]) && pt[0] < (xj - xi) * (pt[1] - yi) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
    }

    // One geometry from several: the outline of their union.
    function dissolveGeometries(geoms) {
        const polys = geoms.flatMap(polysOf);
        if (polys.length <= 1) return polys.length ? { type: 'Polygon', coordinates: polys[0] } : null;
        // Every ring's edges, outers counter-clockwise and holes clockwise, so a shared edge runs
        // one way in one polygon and the other way in its neighbor.
        const edges = new Map();   // "a|b" undirected → { a, b, n }
        for (const poly of polys) poly.forEach((ring, r) => {
            const ccw = signedArea(ring) > 0, want = r === 0;
            const rr = ccw === want ? ring : [...ring].reverse();
            for (let i = 0; i < rr.length - 1; i++) {
                const a = rr[i], b = rr[i + 1], ka = key(a), kb = key(b);
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
            if (key(ring[0]) !== key(ring[ring.length - 1]) || ring.length < 4) return null;   // didn't close: give up
            rings.push(ring);
        }
        const outers = rings.filter(r => signedArea(r) > 0).map(r => [r]);
        const holes = rings.filter(r => signedArea(r) <= 0);
        if (!outers.length) return null;
        for (const h of holes) {
            const home = outers.filter(o => inRing(h[0], o[0])).sort((x, y) => Math.abs(signedArea(x[0])) - Math.abs(signedArea(y[0])))[0];
            if (home) home.push(h);
        }
        return outers.length === 1 ? { type: 'Polygon', coordinates: outers[0] } : { type: 'MultiPolygon', coordinates: outers };
    }

    // A feature collection grouped by one property: one feature per value, with the property and
    // how many features went into it. Values can be renamed with label(value).
    function dissolve(fc, prop, { label = v => v } = {}) {
        const groups = new Map();
        for (const f of fc.features) {
            const v = f.properties?.[prop];
            if (v === null || v === undefined || v === '') continue;
            const k = String(v);
            (groups.get(k) || groups.set(k, []).get(k)).push(f);
        }
        const features = [...groups].sort((a, b) => a[0].localeCompare(b[0], 'en', { numeric: true })).map(([k, fs]) => {
            const geometry = dissolveGeometries(fs.map(f => f.geometry))
                || { type: 'MultiPolygon', coordinates: fs.flatMap(f => polysOf(f.geometry)) };
            return { type: 'Feature', id: k, properties: { [prop]: k, name: String(label(k)), parts: fs.length }, geometry };
        });
        return { type: 'FeatureCollection', features };
    }

    const api = { dissolve, dissolveGeometries };
    if (typeof module === 'object' && module.exports) module.exports = api; else root.JoinerDissolve = api;
})(typeof self !== 'undefined' ? self : this);
