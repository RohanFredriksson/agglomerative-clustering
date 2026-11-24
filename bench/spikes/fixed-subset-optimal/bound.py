# How far is the guides' search (3.8's chooseFrom) from the best possible choice? The objective is a weighted p-median:
# choose n chart entries minimising sum_i w_i * min_j d(entry j, swatch i)^2 over the 1024 swatches. For charts of at
# most 100 entries it solves it exactly (scipy's HiGHS MILP); for larger ones it computes a Lagrangian lower bound
# (relaxing "each swatch is served once", subgradient steps), which no choice can beat. Reads the instances that
# search.mjs writes to build/fixed-subset-instances.json.
#   python3 bench/spikes/fixed-subset-optimal/bound.py [photos] > bench/spikes/fixed-subset-optimal/results-bound.txt
import json, sys
from collections import defaultdict
import numpy as np
from scipy.optimize import milp, LinearConstraint, Bounds
from scipy.sparse import coo_matrix, hstack, vstack, identity, csr_matrix

photos = int(sys.argv[1]) if len(sys.argv) > 1 else 24
instances = json.load(open('build/fixed-subset-instances.json'))
seen = []
for inst in instances:
    if inst['photo'] not in seen:
        seen.append(inst['photo'])
keep = set(seen[:photos])

def costs(inst):
    a = np.array(inst['a']).reshape(-1, 3); b = np.array(inst['b']).reshape(-1, 3); w = np.array(inst['w'])
    d = ((a[:, None, :] - b[None, :, :]) ** 2).sum(axis=2)
    return d * w[None, :]   # c[j, i]

def exact(c, p):
    t, m = c.shape
    # variables: y (t), then x[j, i] flattened (t*m)
    cost = np.concatenate([np.zeros(t), c.ravel()])
    # sum_j x[j, i] = 1
    rows = np.tile(np.arange(m), t); cols = t + np.arange(t * m)
    A1 = coo_matrix((np.ones(t * m), (rows, cols)), shape=(m, t + t * m))
    # x[j, i] - y[j] <= 0
    r = np.arange(t * m)
    A2 = coo_matrix((np.concatenate([np.ones(t * m), -np.ones(t * m)]), (np.concatenate([r, r]), np.concatenate([t + r, np.repeat(np.arange(t), m)]))), shape=(t * m, t + t * m))
    A3 = coo_matrix((np.ones(t), (np.zeros(t, int), np.arange(t))), shape=(1, t + t * m))
    cons = [LinearConstraint(A1, 1, 1), LinearConstraint(A2, -np.inf, 0), LinearConstraint(A3, p, p)]
    integrality = np.concatenate([np.ones(t), np.zeros(t * m)])
    res = milp(cost, constraints=cons, integrality=integrality, bounds=Bounds(0, 1), options={'time_limit': 120, 'mip_rel_gap': 1e-7})
    return res.fun if res.status == 0 else (res.mip_dual_bound if hasattr(res, 'mip_dual_bound') else np.nan), res.status == 0

def lagrangian(c, p, upper, iterations=1500):
    t, m = c.shape
    lam = np.sort(c, axis=0)[min(p, t - 1)].copy()   # each swatch's (p+1)-th cheapest cost
    best, theta = -np.inf, 2.0
    stall = 0
    for _ in range(iterations):
        red = np.minimum(0, c - lam[None, :])
        rho = red.sum(axis=1)
        S = np.argpartition(rho, p - 1)[:p]
        value = lam.sum() + rho[S].sum()
        if best == -np.inf or value > best + 1e-12 * abs(best):
            best, stall = value, 0
        else:
            stall += 1
            if stall >= 30:
                theta, stall = theta / 2, 0
        g = 1 - (c[S] < lam[None, :]).sum(axis=0)
        norm = (g * g).sum()
        if norm == 0 or theta < 1e-6:
            break
        lam = lam + theta * (upper - value) / norm * g
    return best

groups = defaultdict(list)
for inst in instances:
    if inst['photo'] not in keep:
        continue
    c = costs(inst); t = c.shape[0]; p = inst['n']; upper = min(inst['guides'], inst['best'])
    if t <= 100:
        opt, proven = exact(c, p)
        lower, kind = opt, 'exact' if proven else 'bound'
    else:
        lower, kind = lagrangian(c, p, upper), 'bound'
    gap = max(0.0, 1 - lower / inst['guides'])   # how much lower than the guides' objective the best could be
    groups[(inst['chart'], t, p, inst['space'])].append((gap, kind, inst['guides'] <= lower * (1 + 1e-7)))
    print(f"{inst['photo']} {inst['chart']} n={p} {inst['space']}: guides {inst['guides']:.6g}, best start {inst['best']:.6g}, {kind} {lower:.6g}, gap {100 * gap:.3f}%", file=sys.stderr, flush=True)

print(f"{len(keep)} Kodak photos. The guides' search against the best possible objective: exact optimum (MILP) for charts up to 100 entries,")
print("else a Lagrangian lower bound (the true optimum is between it and the guides'). Columns: photos where the guides' choice is proven optimal,")
print("mean and max room left below the guides' objective (%).\n")
for (chart, t, p, space), v in groups.items():
    gaps = [g for g, _, _ in v]; kinds = {k for _, k, _ in v}
    print(f"{chart} ({t}), N = {p}, {space}".ljust(30), f"{sum(o for _, _, o in v):2d}/{len(v)} optimal  mean {100 * np.mean(gaps):.3f}%  max {100 * max(gaps):.3f}%  ({'/'.join(sorted(kinds))})")
