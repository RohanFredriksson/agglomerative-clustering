// Statistics and a thread pool for the rounds experiment (bench/spikes/perf-measure).
#pragma once
#include <algorithm>
#include <atomic>
#include <cstdio>
#include <cstdlib>
#include <chrono>
#include <condition_variable>
#include <functional>
#include <mutex>
#include <thread>
#include <vector>
#include <cstdint>

static bool g_no_cache = false;
static bool g_chain_reverse = false;  // the chain starts from the newest live cluster instead of the oldest
static int g_rounds_threads = 0;               // 0: the shipped chain; N >= 1: rounds with N threads
static size_t g_parallel_minimum = 256;        // rounds with fewer searches than this run on the calling thread
struct RoundStat {size_t merges; size_t searches;};
static std::vector<RoundStat> g_rounds;
static double g_t_search = 0, g_t_merge = 0, g_t_other = 0;
static size_t g_searches_total = 0;

static double wall_ms() {return std::chrono::duration<double, std::milli>(std::chrono::steady_clock::now().time_since_epoch()).count();}

// Persistent workers; run(n, fn) calls fn(begin, end) over chunks of [0, n) on all threads (the caller included).
class Pool {
    std::vector<std::thread> workers;
    std::mutex m;
    std::condition_variable wake, finished;
    std::function<void(size_t, size_t)> fn;
    std::atomic<size_t> next{0};
    size_t total = 0, chunk = 1;
    unsigned generation = 0;
    int running = 0;
    bool stopping = false;
    void work() {
        for (;;) {
            const size_t begin = next.fetch_add(chunk);
            if (begin >= total) {return;}
            fn(begin, std::min(total, begin + chunk));
        }
    }
public:
    explicit Pool(int threads) {
        for (int i = 1; i < threads; i++) {
            workers.emplace_back([this] {
                unsigned seen = 0;
                for (;;) {
                    {
                        std::unique_lock<std::mutex> lock(m);
                        wake.wait(lock, [&] {return stopping || generation != seen;});
                        if (stopping) {return;}
                        seen = generation;
                    }
                    work();
                    {
                        std::lock_guard<std::mutex> lock(m);
                        if (--running == 0) {finished.notify_one();}
                    }
                }
            });
        }
    }
    ~Pool() {
        {std::lock_guard<std::mutex> lock(m); stopping = true;}
        wake.notify_all();
        for (std::thread& w : workers) {w.join();}
    }
    int size() const {return int(workers.size()) + 1;}
    void run(size_t n, size_t grain, const std::function<void(size_t, size_t)>& body) {
        if (workers.empty() || n < g_parallel_minimum) {body(0, n); return;}
        {
            std::lock_guard<std::mutex> lock(m);
            fn = body; total = n; next = 0;
            chunk = std::max<size_t>(grain, 1);
            running = int(workers.size());
            generation++;
        }
        wake.notify_all();
        work();
        std::unique_lock<std::mutex> lock(m);
        finished.wait(lock, [&] {return running == 0;});
    }
};
