    // The merge loop in rounds (the spike's experiment; see rounds.mjs).
    bool merge_rounds() {
        AgglomerativeClustering::WardGrid& grid = *this->grid;
        constexpr int32_t none = AgglomerativeClustering::WardGrid::none;
        Pool pool(g_rounds_threads);
        const size_t capacity = 2 * this->n;
        std::vector<int32_t> nn(capacity, none), hint(capacity, none), replaced(capacity, none);
        std::vector<char> in_todo(capacity, 0);
        // Who points at whom: a linked list per target, so a merge finds the clusters that lose their partner.
        std::vector<int32_t> head(capacity, -1);
        struct Link {int32_t from, next;};
        std::vector<Link> links;
        std::vector<int32_t> todo(this->n);
        for (size_t i = 0; i < this->n; i++) {todo[i] = int32_t(i);}
        std::vector<std::pair<int32_t, int32_t>> pairs;
        while (grid.size() > 1) {
            double t0 = wall_ms();
            // 1. A partner for every cluster that needs one (reads the grid only).
            pool.run(todo.size(), 64, [&](size_t begin, size_t end) {
                AgglomerativeClustering::WardGrid::Candidates list;
                for (size_t i = begin; i < end; i++) {
                    const int32_t a = todo[i];
                    grid.search(a, list, 1, hint[a]);
                    nn[a] = list.size > 0 ? list.ids[0] : none;
                }
            });
            double t1 = wall_ms();
            g_t_search += t1 - t0;
            g_searches_total += todo.size();
            for (int32_t a : todo) {
                const int32_t b = nn[a];
                if (b == none) {continue;}
                links.push_back({a, head[b]});
                head[b] = int32_t(links.size() - 1);
                in_todo[a] = 1;
            }
            // 2. Mutual pairs: found from the side that searched (a pair where both searched is taken once, from its smaller id).
            pairs.clear();
            for (int32_t a : todo) {
                const int32_t b = nn[a];
                if (b == none || nn[b] != a) {continue;}
                if (in_todo[b] && b < a) {continue;}
                pairs.push_back({a, b});
            }
            for (int32_t a : todo) {in_todo[a] = 0;}
            double t2 = wall_ms();
            g_t_other += t2 - t1;
            if (pairs.empty()) {std::fprintf(stderr, "no mutual pair in a round with %zu clusters\n", grid.size()); std::abort();}
            // 3. Merge them all, in the chain's way.
            std::vector<int32_t> created;
            created.reserve(pairs.size());
            for (const auto& pair : pairs) {
                int32_t a = pair.first, b = pair.second;
                uint32_t a_count = grid.count(a), b_count = grid.count(b), count = a_count + b_count;
                const std::array<uint16_t, 3>& ac = grid.coords(a);
                const std::array<uint16_t, 3>& bc = grid.coords(b);
                std::array<uint16_t, 3> merged = {
                    static_cast<uint16_t>((uint64_t(ac[0]) * a_count + uint64_t(bc[0]) * b_count) / count),
                    static_cast<uint16_t>((uint64_t(ac[1]) * a_count + uint64_t(bc[1]) * b_count) / count),
                    static_cast<uint16_t>((uint64_t(ac[2]) * a_count + uint64_t(bc[2]) * b_count) / count)
                };
                double cost = grid.cost(a, b);
                double height = std::max({cost, this->heights[a], this->heights[b]});
                grid.remove(a);
                grid.remove(b);
                int32_t m = grid.add(merged, count);
                this->heights[m] = height;
                replaced[a] = replaced[b] = m;
                created.push_back(m);
                if (b_count > a_count) {this->merges.push_back({height, m, b, a, cost, a_count});} else {this->merges.push_back({height, m, a, b, cost, b_count});}
                grid.reindex();
            }
            // 4. Next round's work: the merged clusters, and every live cluster whose partner just died.
            std::vector<int32_t> next;
            for (const auto& pair : pairs) {
                for (int32_t dead : {pair.first, pair.second}) {
                    for (int32_t e = head[dead]; e != -1; e = links[e].next) {
                        const int32_t x = links[e].from;
                        if (grid.is_alive(x) && nn[x] == dead) {hint[x] = replaced[dead]; next.push_back(x);}
                    }
                    head[dead] = -1;
                }
            }
            for (int32_t m : created) {next.push_back(m);}
            if (g_no_cache) {  // the experiment's control: every live cluster searches again
                next.clear();
                for (int32_t x = 0; x < grid.capacity(); x++) {if (grid.is_alive(x)) {hint[x] = none; next.push_back(x);}}
            }
            double t3 = wall_ms();
            g_t_merge += t3 - t2;
            g_rounds.push_back({pairs.size(), todo.size()});
            todo.swap(next);
        }
        this->stage = Stage::write;
        return true;
    }
