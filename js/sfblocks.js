// sf-blocks: San Francisco's map data (streets, boundaries, aliases, layers) from burritojustice/sf-blocks.
// Every file is read live from its GitHub Pages site. If the site can't be reached, or a file is missing
// there, the copy in this repo at the same path is used instead. data/sf-blocks.json says which sf-blocks
// version those copies are; scripts/copy_sf_blocks.py refreshes them.
//   ?sfblocks=local   use only the copies here
//   ?sfblocks=<url>   read from another copy of sf-blocks (a fork, or a local server while testing)
// The same code is in Joiner (js/sfblocks.js) and Block Party (inline); keep them in step.
const SFBlocks = (() => {
    const LIVE = 'https://burritojustice.github.io/sf-blocks/';
    const STAMP = 'data/sf-blocks.json';
    const WAIT = 8000;   // ms to wait for the live site to start answering
    const param = new URLSearchParams(location.search).get('sfblocks');
    let base = param === 'local' ? '' : /^https?:\/\//.test(param || '') ? param.replace(/\/?$/, '/') : LIVE;
    const info = { live: false, version: null, base: '', copy: null, fellBack: [] };
    let region = null;

    // fetch with a deadline for the first byte (big files may take longer to finish)
    const get = (url, ms = WAIT, opts = {}) => {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), ms);
        return fetch(url, { ...opts, signal: ctl.signal }).then(r => {
            clearTimeout(timer);
            if (!r.ok) throw new Error(`${r.status} ${url}`);
            return r;
        }, err => { clearTimeout(timer); throw err; });
    };
    // GitHub Pages lets browsers keep files for 10 minutes. region.json and VERSION are checked with the
    // server every time (cheap when unchanged), and every other file's address carries the version
    // (?v=2026.10.30), so a new sf-blocks version is seen on the next page load, not 10 minutes later.
    const fresh = { cache: 'no-cache' };
    const versioned = path => base + path + (info.version ? (path.includes('?') ? '&' : '?') + 'v=' + encodeURIComponent(info.version) : '');
    async function file(path) {
        await ready.catch(() => {});
        if (base) {
            try { return await get(versioned(path)); }
            catch (err) {
                console.warn(`[sf-blocks] ${path}: live copy failed, using the one here`, err);
                info.fellBack.push(path);
            }
        }
        return get(path, 60000);
    }
    const ready = (async () => {
        info.copy = await get(STAMP).then(r => r.json()).catch(() => null);
        if (base) {
            try {
                const [reg, ver] = await Promise.all([get(base + 'region.json', WAIT, fresh).then(r => r.json()),
                    get(base + 'VERSION', WAIT, fresh).then(r => r.text())]);
                region = reg;
                Object.assign(info, { live: true, version: ver.trim(), base });
                console.log(`[sf-blocks] ${info.version}, live from ${base}`);
                return region;
            } catch (err) {
                console.warn('[sf-blocks] live site unreachable, using the copies here', err);
                base = '';
            }
        }
        region = await get('region.json').then(r => r.json());
        info.version = info.copy?.version || null;
        console.log(`[sf-blocks] ${info.version || '(unstamped)'}, copy in this repo`);
        return region;
    })();

    return {
        ready,                                        // resolves to region.json
        get region() { return region; },
        info,                                         // { live, version, base, copy, fellBack }
        json: path => file(path).then(r => r.json()),
        text: path => file(path).then(r => r.text()),
        // absolute URL for readers that fetch on their own (PMTiles); no per-file fallback
        url: path => new URL(base ? versioned(path) : path, location.href).href,
        // the Protomaps key allowed for this page's origin, from region.json
        basemapKey: fallback => region?.basemap?.keys?.[location.origin] || fallback,
        // "sf-blocks 2026.10.27 (live)" for titles and footers
        describe: () => `sf-blocks ${info.version || '?'}${info.live ? (info.fellBack.length ? ' (live, some files from the copy here)' : ' (live)') : ' (copy in this repo)'}`,
    };
})();
