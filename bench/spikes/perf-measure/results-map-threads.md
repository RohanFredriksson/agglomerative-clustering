| image | k | dither | shipped (ms) | 1 thread | 2 | 4 | 8 | speed-up 2 / 4 / 8 | bytes identical to shipped |
|---|---:|---|---:|---:|---:|---:|---:|---|---|
| up12 (12 MP) | 16 | none | 158 | 161 | 97 | 62 | 54 | 1.63 / 2.56 / 2.93 | yes |
| up12 (12 MP) | 16 | ordered | 1385 | 1355 | 882 | 646 | 516 | 1.57 / 2.14 / 2.69 | yes |
| up12 (12 MP) | 16 | Floyd-Steinberg restarted per stripe | 769 | 767 | 456 | 277 | 231 | 1.69 / 2.78 / 3.33 | NO (different dither pattern) |
| up12 (12 MP) | 256 | none | 207 | 210 | 133 | 84 | 71 | 1.56 / 2.46 / 2.92 | yes |
| up12 (12 MP) | 256 | ordered | 2645 | 2778 | 1713 | 1284 | 1024 | 1.54 / 2.06 / 2.58 | yes |
| up12 (12 MP) | 256 | Floyd-Steinberg restarted per stripe | 1030 | 1017 | 633 | 387 | 324 | 1.63 / 2.66 / 3.17 | NO (different dither pattern) |
| up50 (50 MP) | 16 | none | 513 | 520 | 311 | 204 | 184 | 1.65 / 2.51 / 2.78 | yes |
| up50 (50 MP) | 16 | ordered | 3029 | 3060 | 1941 | 1457 | 1115 | 1.56 / 2.08 / 2.72 | yes |
| up50 (50 MP) | 16 | Floyd-Steinberg restarted per stripe | 3033 | 3068 | 1800 | 1112 | 911 | 1.69 / 2.73 / 3.33 | NO (different dither pattern) |
| up50 (50 MP) | 256 | none | 629 | 637 | 388 | 249 | 221 | 1.62 / 2.53 / 2.85 | yes |
| up50 (50 MP) | 256 | ordered | 5665 | 5734 | 3559 | 2864 | 2055 | 1.59 / 1.98 / 2.76 | yes |
| up50 (50 MP) | 256 | Floyd-Steinberg restarted per stripe | 4085 | 4076 | 2497 | 1527 | 1252 | 1.64 / 2.68 / 3.26 | NO (different dither pattern) |
