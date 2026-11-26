#!/usr/bin/env python3
"""Where the instructions of a clustering are (exclusive, from a callgrind out file made with --dump-instr=no).
Usage: ptable.py <out> -> prints a table: category, Ir, share. Search lines are split by the line ranges of the SHIPPED 4.1.0 clustering.hpp
(CELL 460-472, FILTER 473-478 + vector/iterator helpers, EXACT 479-494, RING 497-557); other functions by name."""
import sys, re, collections
out = sys.argv[1]
names = {}
def nm(tok):
    m = re.match(r'\((\d+)\)\s*(.*)', tok)
    if not m: return tok
    i, rest = m.group(1), m.group(2)
    if rest: names[i] = rest
    return names.get(i, i)
cost = collections.Counter()
curfile = curfn = None; line = 0; after_calls = False
for raw in open(out):
    s = raw.rstrip('\n')
    if not s: continue
    if s[:3] in ('fl=', 'fi=', 'fe='): curfile = nm(s[3:]); continue
    if s.startswith('fn='): curfn = nm(s[3:]); continue
    if s[:4] in ('cfn=', 'cfi=', 'cfl='): nm(s[4:]); continue
    if s.startswith('calls='): after_calls = True; continue
    if s[0] in '+-*0123456789':
        p = s.split()
        if p[0] == '*': pass
        elif p[0][0] == '+': line += int(p[0][1:])
        elif p[0][0] == '-': line -= int(p[0][1:])
        else: line = int(p[0])
        if after_calls: after_calls = False; continue
        cost[(curfn, curfile, line)] += int(p[1])
total = sum(cost.values())
cat = collections.Counter()
for (fn, f, l), c in cost.items():
    base = f.split('/')[-1]
    if 'WardGrid::search' in fn:
        if base == 'clustering.hpp' and 497 <= l <= 557: k = 'search: ring and column stepping'
        elif base == 'clustering.hpp' and 460 <= l <= 472: k = 'search: cell tests (bounds test)'
        elif base == 'clustering.hpp' and 479 <= l <= 494: k = 'search: exact double cost + lane loop'
        elif base == 'clustering.hpp' and (l == 51 or 473 <= l <= 478): k = 'search: chunk float filter'
        elif base != 'clustering.hpp': k = 'search: chunk float filter'   # std::vector/iterator helpers of the chunk loop
        else: k = 'search: other (setup, line 0)'
    elif 'WardGrid::offer' in fn: k = 'offer (candidate list insert)'
    elif 'WardGrid::nearest' in fn: k = 'nearest (cache bookkeeping)'
    elif 'merge_some' in fn or ('ClusteringJob::step' in fn): k = 'chain bookkeeping and merge (merge_some)'
    elif 'WardGrid::' in fn and any(x in fn for x in ('link', 'remove', 'reindex', 'count_occupied', 'add', 'set_lane', 'link_some')): k = 'grid maintenance (link/remove/reindex)'
    elif 'AgglomerativeHistogram::add' in fn or 'AgglomerativeHistogram::make_room' in fn: k = 'pixel scan: histogram add'
    elif 'ClusteringJob::scan' in fn: k = 'pixel scan: loop'
    elif 'ClusteringJob::build' in fn: k = 'build (convert colours, grid fill)'
    elif 'ClusteringJob::write' in fn or 'crc' in fn: k = 'write (colours, sort, records, CRC)'
    elif 'memset' in fn or 'memcpy' in fn or 'memmove' in fn: k = 'libc memset/memcpy'
    else: k = 'other: ' + fn[:60]
    cat[k] += c
print(f'total Ir {total}')
for k, c in sorted(cat.items(), key=lambda kv: -kv[1]):
    if 100.0 * c / total >= 0.2: print(f'{k:50s} {c:>14,} {100.0*c/total:6.2f}%')
