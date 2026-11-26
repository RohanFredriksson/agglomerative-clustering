#!/usr/bin/env python3
"""Ir of mapping_call per image/method from the callgrind out files (build/prof/<variant>-map-*.out): table variant A vs B. Usage: map-ir-table.py base mp1"""
import sys, re, glob
va, vb = sys.argv[1], sys.argv[2]
def ir(f):
    for l in open(f):
        if l.startswith('summary:') or l.startswith('totals:'): return int(l.split()[1])
rows = []
for f in sorted(glob.glob(f'build/prof/{va}-map-*.out')):
    tag = f.split(f'{va}-map-')[1][:-4]
    g = f.replace(f'{va}-map-', f'{vb}-map-')
    try: a, b = ir(f), ir(g)
    except Exception: continue
    m = re.match(r'(\w+)-k16-m(-?\d)-s0', tag)
    rows.append((m.group(1), {'-1': 'none', '0': 'floyd-steinberg', '2': 'ordered'}[m.group(2)], a, b))
print('| image | dither | %s Ir (M) | %s Ir (M) | change | Ir/pixel %s -> %s |' % (va, vb, va, vb))
print('|---|---|---:|---:|---:|---:|')
px = {'night': 19961856, 'fern': 19961856, 'sky': 5610*3738, 'k23': 768*512}
for img, d, a, b in sorted(rows):
    print(f'| {img} | {d} | {a/1e6:,.0f} | {b/1e6:,.0f} | {100*(b/a-1):+.1f}% | {a/px[img]:.0f} -> {b/px[img]:.0f} |')
