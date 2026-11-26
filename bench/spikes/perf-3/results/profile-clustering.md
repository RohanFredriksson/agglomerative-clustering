| where (exclusive Ir, callgrind, native -O2, 4.1.0, RGB full precision) | night (9.73 G) | fern (8.56 G) | sky (8.68 G) | k23 (0.91 G) |
|---|---:|---:|---:|---:|
| search: chunk float filter | 33.2% | 29.7% | 27.3% | 28.9% |
| search: ring and column stepping | 14.0% | 13.7% | 16.0% | 13.5% |
| search: other (setup, line 0) | 8.6% | 8.2% | 8.9% | 10.3% |
| search: cell tests (bounds test) | 7.3% | 10.9% | 10.8% | 4.6% |
| pixel scan: histogram add | 8.0% | 9.1% | 9.6% | 1.9% |
| grid maintenance (link/remove/reindex) | 4.8% | 5.5% | 5.1% | 11.6% |
| pixel scan: loop | 6.2% | 7.0% | 7.2% | 1.3% |
| write (colours, sort, records, CRC) | 3.9% | 4.2% | 4.1% | 8.0% |
| offer (candidate list insert) | 6.1% | 3.7% | 3.3% | 5.6% |
| search: exact double cost + lane loop | 3.1% | 3.1% | 2.9% | 5.5% |
| nearest (cache bookkeeping) | 1.5% | 1.0% | 1.1% | 2.3% |
| libc memset/memcpy | 1.1% | 1.3% | 1.3% | 1.0% |
| chain bookkeeping and merge (merge_some) | 0.8% | 0.9% | 0.9% | 1.8% |
| other: AgglomerativeClustering::WardGrid::is_before(int, double, in | 0.5% | 0.5% | 0.5% | 1.1% |
