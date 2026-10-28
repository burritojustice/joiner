#!/usr/bin/env python3
"""Refresh this repo's backup copies of burritojustice/sf-blocks files.

    python3 scripts/copy_sf_blocks.py ../sf-blocks          # from a local checkout of sf-blocks
    python3 scripts/copy_sf_blocks.py ../sf-blocks --check  # only list files that differ

The app reads these files live from https://burritojustice.github.io/sf-blocks/ and falls back to the
copies here, at the same paths. data/sf-blocks.json lists the files (a name can have wildcards, like
data/boundaries/*, which also picks up sets added later) and records the sf-blocks version they were
copied from (its VERSION file) and the date. Standard library only.
"""
import argparse, filecmp, json, shutil, sys
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
STAMP = ROOT / 'data' / 'sf-blocks.json'


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('sf_blocks', type=Path, help='path to a checkout of burritojustice/sf-blocks')
    ap.add_argument('--check', action='store_true', help="list files that differ, change nothing")
    a = ap.parse_args()
    src = a.sf_blocks.resolve()
    if not (src / 'VERSION').exists() or not (src / 'region.json').exists():
        sys.exit(f'{src} does not look like sf-blocks (no VERSION or region.json)')
    stamp = json.loads(STAMP.read_text())
    version = (src / 'VERSION').read_text().strip()

    changed, missing, files = [], [], []
    for pat in stamp['files']:
        if any(c in pat for c in '*?['):
            found = sorted(str(f.relative_to(src)) for f in src.glob(pat) if f.is_file())
            files += found or []
            if not found:
                missing.append(pat)
        else:
            files.append(pat)
    for rel in dict.fromkeys(files):
        s, d = src / rel, ROOT / rel
        if not s.exists():
            missing.append(rel)
            continue
        if d.exists() and filecmp.cmp(s, d, shallow=False):
            continue
        changed.append(rel)
        if not a.check:
            d.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(s, d)

    for rel in changed:
        print(('differs: ' if a.check else 'copied:  ') + rel)
    for rel in missing:
        print(f'not in sf-blocks {version}: {rel} (kept the copy here)')
    if a.check:
        print(f'here: {stamp.get("version")}, sf-blocks: {version}, {len(changed)} file(s) differ')
        return
    stamp['version'], stamp['copied'] = version, date.today().isoformat()
    STAMP.write_text(json.dumps(stamp, indent=2) + '\n')
    print(f'{len(changed)} file(s) updated; copies are now sf-blocks {version}')


if __name__ == '__main__':
    main()
