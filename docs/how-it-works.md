# How it works

1. **Histogram.** Distinct colours are counted with an open-addressing hash table. With `precision` below 8, colours are first grouped by their top bits.
2. **Exact Ward clustering.** A nearest-neighbour chain finds mutually cheapest pairs and merges them. Ward's criterion is reducible, so this produces exactly the same hierarchy as repeatedly merging the globally cheapest pair, without a priority queue.
3. **Fast partner search.** Clusters live in an adaptive 3D grid sized to the occupied part of colour space, with per-column occupancy bits so searches step over empty cells. Searches prune whole cells using each cell's colour box and lightest member, compute four Ward costs at once with WASM SIMD, and skip most candidates with a division-free float test before the exact double-precision check. Clusters whose searches are expensive cache their best candidates.
4. **Versioned output.** The hierarchy is stored as a self-describing header and one record per merge in reverse order. Each record lists its heavier half first, with the lighter half's weight and the merge's cost. Cutting to `k` colours replays the first `k − 1` records, which gives the stable split order.
5. **Mapping.** A memo of recent colours, then a grid over colour space whose cells list the palette entries that can be nearest there (a KD-tree for palettes above 256 colours), maps pixels to the palette, with optional error-diffusion dithering.

The clustering format, the module layout and the build are described for contributors in [CLAUDE.md](../CLAUDE.md).
