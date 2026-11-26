| image | dither | Ir/pixel | where (exclusive, top four) |
|---|---|---:|---|
| night | none | 82 | step 46%, PixelSink::operator 38%, PaletteIndex::get_nearest 16% |
| night | Floyd-Steinberg | 527 | pick lambda 43%, step 30%, lroundf 10%, PaletteIndex::get_nearest 8% |
| night | ordered | 362 | step 80%, lroundf 11%, PixelSink::operator 9% |
| fern | none | 145 | PaletteIndex::get_nearest 45%, step 33%, PixelSink::operator 21% |
| fern | Floyd-Steinberg | 604 | pick lambda 46%, step 26%, PaletteIndex::get_nearest 13%, lroundf 8% |
| fern | ordered | 1658 | step 83%, lroundf 14%, PixelSink::operator 2% |
| sky | none | 102 | step 41%, PixelSink::operator 30%, PaletteIndex::get_nearest 28% |
| sky | Floyd-Steinberg | 567 | pick lambda 44%, step 28%, PaletteIndex::get_nearest 11%, lroundf 9% |
| sky | ordered | 549 | step 81%, lroundf 13%, PixelSink::operator 6% |
| k23 | none | 100 | step 41%, PixelSink::operator 31%, PaletteIndex::get_nearest 25%, PaletteIndex::build_cell 2% |
| k23 | Floyd-Steinberg | 571 | pick lambda 40%, step 28%, PaletteIndex::get_nearest 13%, lroundf 10% |
| k23 | ordered | 1364 | step 82%, lroundf 13%, PixelSink::operator 2%, __memset_avx2_unaligned_erms 2% |
