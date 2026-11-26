#!/usr/bin/env python3
"""Per-source-line exclusive Ir from a callgrind out file (made with --dump-instr=no).
Usage: lines.py <out> <variant src dir name e.g. base> [min share %] -> prints file:line cost share text, sorted by file and line."""
import sys, re, collections
out, var = sys.argv[1], sys.argv[2]
minshare = float(sys.argv[3]) if len(sys.argv) > 3 else 0.3
names = {}
def nm(tok):
    m = re.match(r'\((\d+)\)\s*(.*)', tok)
    if not m: return tok
    i, rest = m.group(1), m.group(2)
    if rest: names[i] = rest
    return names.get(i, i)
cost = collections.Counter(); fn_cost = collections.Counter()
curfile = None; curfn = None; line = 0; after_calls = False
for raw in open(out):
    s = raw.rstrip('\n')
    if not s: continue
    if s.startswith('fl='): curfile = nm(s[3:]); continue
    if s.startswith('fi=') or s.startswith('fe='): curfile = nm(s[3:]); continue
    if s.startswith('fn='): curfn = nm(s[3:]); continue
    if s.startswith('cfn=') or s.startswith('cfi=') or s.startswith('cfl='):
        if s.startswith('cfn='): nm(s[4:])
        elif s.startswith('cfi=') or s.startswith('cfl='): nm(s[4:])
        continue
    if s.startswith('calls='): after_calls = True; continue
    if s[0] in '+-*0123456789':
        parts = s.split()
        p = parts[0]
        if p == '*': pass
        elif p[0] == '+': line += int(p[1:])
        elif p[0] == '-': line -= int(p[1:])
        else: line = int(p)
        if after_calls: after_calls = False; continue
        c = int(parts[1])
        cost[(curfile, line)] += c; fn_cost[curfn] += c
total = sum(cost.values())
rows = sorted(cost.items(), key=lambda kv: (kv[0][0], kv[0][1]))
cache = {}
def text(f, l):
    if f not in cache:
        try: cache[f] = open(f.replace('/spikes/perf-3/', '')).read().split('\n')
        except Exception: cache[f] = []
    L = cache[f]
    return L[l-1].strip()[:110] if 0 < l <= len(L) else ''
print('total', total)
for (f, l), c in rows:
    if 100.0 * c / total >= minshare and ('clustering' in f or 'colorspace' in f):
        print(f'{f.split("/")[-1]}:{l}\t{c}\t{100.0*c/total:.2f}%\t{text(f, l)}')
