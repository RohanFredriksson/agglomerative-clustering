| variant | wall (spawn to exit, ms) | Node boot | import | load | first call | total in process |
|---|---:|---:|---:|---:|---:|---:|
| base | 93 | 75 | 1 | 6 | 2 | 81 |
| pthread4 | 152 | 74 | 3 | 56 | 1 | 136 |
| pthread8 | 188 | 75 | 3 | 88 | 1 | 168 |
| dist | 100 | 75 | 5 | 4 | 2 | 88 |

module cache: {"compileFromBytes_ms_median":1.0466179999999952,"createFromBytes_ms_median":1.2717460000000074,"createFromCompiledModule_ms_median":0.4935569999999956,"note":"same process: V8 may reuse its own compilation cache for identical bytes, so fromBytes is a lower bound for a cold process"}
