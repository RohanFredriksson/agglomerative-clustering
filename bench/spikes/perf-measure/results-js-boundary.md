| image | pixels | copy in | unpremultiply | C++ map (k=16, no dither) | copy out | premultiply | public quantizeWithPalette | same, premultiplied input |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| k23 | 0.4 MP | 0.1 | 0.6 | 6.2 | 0.5 | 0.1 | 6.2 | 7.4 |
| up12 | 12.4 MP | 2.8 | 14.6 | 151.1 | 18.8 | 4.9 | 177.2 | 161.1 |
| up50 | 49.8 MP | 10.4 | 52.4 | 499.8 | 67.4 | 20.6 | 796.0 | 794.5 |

k23 clustering: C++ _get_clustering 139.2 ms; public buildClustering 143.8 ms (the difference includes the heap copy, the 10 ms slicing is not used without signal or onProgress)
