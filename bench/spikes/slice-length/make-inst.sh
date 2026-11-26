#!/usr/bin/env bash
# Copies src/ into inst/ and times each nearest() and reindex() call in the merge loop (the native spike's instrumentation).
cd "$(dirname "$0")" && mkdir -p inst && cp ../../../src/{clustering.cpp,clustering.hpp,colorspace.hpp,version.hpp} inst/
python3 - <<'P'
p='inst/clustering.cpp'
s=open(p).read()
s=s.replace("""            int32_t b = grid.nearest(a, this->chain.size() >= 2 ? this->chain[this->chain.size() - 2] : AgglomerativeClustering::WardGrid::none);
""","""            double t0 = emscripten_get_now();
            int32_t b = grid.nearest(a, this->chain.size() >= 2 ? this->chain[this->chain.size() - 2] : AgglomerativeClustering::WardGrid::none);
            { double d = emscripten_get_now() - t0; spike_nearest_total += d; spike_nearest_n++; if (d > spike_nearest_max) {spike_nearest_max = d; spike_nearest_alive = grid.size();} if (d > 5.0) spike_over5++; }
""")
s=s.replace("""            if (!grid.reindex(timed, deadline)) {return false;}

        }""","""            { double t1 = emscripten_get_now(); bool ok = grid.reindex(timed, deadline); double d = emscripten_get_now() - t1; if (d > spike_reindex_max) spike_reindex_max = d; if (!ok) {return false;} }

        }""")
s=s.replace("class ClusteringJob {","double spike_nearest_max=0, spike_nearest_total=0, spike_reindex_max=0; size_t spike_nearest_n=0, spike_nearest_alive=0, spike_over5=0;\nclass ClusteringJob {",1)
open(p,'w').write(s)
P
