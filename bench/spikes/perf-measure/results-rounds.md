## Work profile of the rounds version, RGB full precision (native; counts do not depend on timing)

| image | colours | chain searches | rounds | rounds / colours | merges per round: first / median / last | rounds searches | searches vs chain | clustering bytes identical | merges not in the chain's | palette colours shared k=16 / 256 | error ratio k=16 / 256 |
|---|---:|---:|---:|---:|---|---:|---:|---|---:|---|---|
| k23 | 72079 | 205314 | 48 | 0.067% | 15620 / 115 / 1 | 284849 | 1.39x | false | 9119 of 72078 | 16 / 256 of 16 / 256 | 1.000000 / 1.000000 |
| k03 | 34871 | 99217 | 44 | 0.126% | 7464 / 87 / 1 | 139716 | 1.41x | false | 4609 of 34870 | 16 / 256 of 16 / 256 | 1.000000 / 1.000000 |
| k20 | 24470 | 70678 | 45 | 0.184% | 4827 / 66 / 1 | 101457 | 1.44x | false | 2465 of 24469 | 16 / 256 of 16 / 256 | 1.000000 / 1.000000 |
| up12 | 907499 | 2638594 | 90 | 0.010% | 86202 / 648 / 1 | 4678496 | 1.77x | false | 109035 of 907498 | 4 / 220 of 16 / 256 | 0.984830 / 0.998976 |
| mos12 | 288588 | 832264 | 63 | 0.022% | 51794 / 219 / 1 | 1293102 | 1.55x | false | 20476 of 288587 | 16 / 256 of 16 / 256 | 1.000000 / 1.000000 |
| up50 | 1261092 | 3663239 | 89 | 0.007% | 96613 / 958 / 1 | 7119974 | 1.94x | false | 105888 of 1261091 | 13 / 229 of 16 / 256 | 1.001190 / 0.999071 |
| mos50 | 288588 | 839632 | 61 | 0.021% | 53441 / 287 / 1 | 1275586 | 1.52x | false | 22593 of 288587 | 16 / 256 of 16 / 256 | 1.000000 / 1.000000 |

Control: the shipped chain started from the newest cluster instead of the oldest, against the shipped chain (same comparisons):

| image | clustering bytes identical | merges not in the other's | palette colours shared k=16 / 256 | error ratio k=16 / 256 |
|---|---|---:|---|---|
| k23 | false | 6219 | 16 / 256 of 16 / 256 | 1.000000 / 1.000000 |
| k03 | false | 3200 | 16 / 256 of 16 / 256 | 1.000000 / 1.000000 |
| k20 | false | 2428 | 16 / 256 of 16 / 256 | 1.000000 / 1.000000 |
| up12 | false | 85470 | 9 / 244 of 16 / 256 | 0.981926 / 0.998345 |
| mos12 | false | 11614 | 16 / 256 of 16 / 256 | 1.000000 / 1.000000 |

Other colour spaces and precision (rounds against the chain):

| image, config | rounds | bytes identical | merges not in the chain's | palettes shared k=16 / 256 | error ratio k=16 / 256 |
|---|---:|---|---:|---|---|
| k03-oklab8 | 44 | false | 4201 | 16 / 256 | 1.000000 / 1.000000 |
| k03-rgb6 | 44 | false | 1066 | 16 / 256 | 1.000000 / 1.000000 |
| k20-oklab8 | 45 | false | 2450 | 16 / 256 | 1.000000 / 1.000000 |
| k20-rgb6 | 40 | false | 505 | 16 / 256 | 1.000000 / 1.000000 |
| k23-oklab8 | 49 | false | 8860 | 16 / 256 | 1.000000 / 1.000000 |
| k23-rgb6 | 44 | false | 1438 | 16 / 256 | 1.000000 / 1.000000 |
| up12-oklab8 | 65 | false | 88487 | 16 / 256 | 1.000000 / 1.000000 |
| up12-rgb6 | 54 | false | 530 | 16 / 256 | 1.000000 / 1.000000 |

## Parallel speed-up of the merge loop, rounds on threads

Measured: native clang -O2 in a container, median of the runs, the whole clustering (scan, build and write are single-threaded and included). Modelled: from the rounds' search counts and the single-thread time split, each round's searches spread over min(T, searches / 64) threads, merges serial.

| image | chain ms | rounds 1 thread | 2 | 4 | 8 | speed-up vs chain 1 / 2 / 4 / 8 | speed-up vs rounds-1 2 / 4 / 8 | modelled vs rounds-1 2 / 4 / 8 |
|---|---:|---:|---:|---:|---:|---|---|---|
| k23 | 132 | 182 | 132 | 104 | 94 | 0.72 / 1.00 / 1.26 / 1.40 | 1.38 / 1.74 / 1.94 | 1.55 / 2.14 / 2.64 |
| k03 | 56 | 82 | 62 | 51 | 45 | 0.68 / 0.91 / 1.09 / 1.26 | 1.33 / 1.60 / 1.85 | 1.55 / 2.13 / 2.63 |
| up12 | 7088 | 4483 | 3145 | 2313 | 2010 | 1.58 / 2.25 / 3.06 / 3.53 | 1.43 / 1.94 / 2.23 | 1.62 / 2.34 / 3.00 |
| mos12 | 1507 | 1556 | 1108 | 812 | 714 | 0.97 / 1.36 / 1.86 / 2.11 | 1.40 / 1.92 / 2.18 | 1.65 / 2.43 / 3.19 |
| up50 | 44455 | 8990 | 6241 | 4444 | 3891 | 4.94 / 7.12 / 10.00 / 11.42 | 1.44 / 2.02 / 2.31 | 1.65 / 2.46 / 3.24 |
| mos50 | 2630 | 2810 | 1974 | 1435 | 1305 | 0.94 / 1.33 / 1.83 / 2.02 | 1.42 / 1.96 / 2.15 | 1.62 / 2.35 / 3.03 |

## Rounds on threads in WebAssembly (-pthread build, Node 24; the whole clustering, median of the runs)

| image | chain ms | rounds 1 thread | 2 | 4 | 8 | speed-up vs chain 1 / 2 / 4 / 8 | speed-up vs rounds-1 2 / 4 / 8 | same bytes at every thread count |
|---|---:|---:|---:|---:|---:|---|---|---|
| k23 | 143 | 187 | 142 | 113 | 103 | 0.76 / 1.01 / 1.26 / 1.39 | 1.32 / 1.66 / 1.82 | yes |
| mos12 | 1708 | 1677 | 1164 | 848 | 770 | 1.02 / 1.47 / 2.02 / 2.22 | 1.44 / 1.98 / 2.18 | yes |
| up12 | 7529 | 4691 | 3277 | 2450 | 2177 | 1.60 / 2.30 / 3.07 / 3.46 | 1.43 / 1.91 / 2.16 | yes |
| up50 | 44332 | 9980 | 6956 | 5155 | 4766 | 4.44 / 6.37 / 8.60 / 9.30 | 1.43 / 1.94 / 2.09 | yes |
