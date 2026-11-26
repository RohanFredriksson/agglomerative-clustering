// Part B table from results/counters/*-rgb8.txt (the counters build of the shipped source, variants/count): per image what the chain's searches do.
import { readFileSync, existsSync } from 'fs';
const meta = JSON.parse(readFileSync('data/images.json', 'utf8'));
const imgs = process.argv.slice(2);
const head = ['image', 'colours', 'nearest()/merge', 'searches (limit 1 / 16)', 'examined/search', 'cache hit rate of cached queries', 'caches built', 'share of examined in limit-16 searches', 'cells visited/search', 'cells skipped by bound', 'chunks seen/search', 'chunks costed exactly', 'rings/search', 'avg chain length', 'most queries of one cluster', 'repeat queries (same cluster again)', 'examined: fresh / exposed / start / limit 16'];
console.log('| ' + head.join(' | ') + ' |'); console.log('|' + head.map(() => '---').join('|') + '|');
for (const img of imgs) {
    const t = readFileSync(`results/counters/${img}-rgb8.txt`, 'utf8').split('\n');
    const sum = (re, idx) => t.filter((l) => re.test(l)).reduce((s, l) => s + Number(l.split(' ')[idx]), 0);
    const g = (re) => t.find((l) => re.test(l));
    const merges = Number(g(/^C merges/).split(' ')[2]);
    const nearest = sum(/^C cat \w+ nearest/, 4), s1 = sum(/^C cat \w+ nearest/, 12), s16 = sum(/^C cat \w+ nearest/, 14);
    const cached = sum(/^C cat \w+ nearest/, 6), hit = sum(/^C cat \w+ nearest/, 8);
    const lim1 = t.filter((l) => /^C cat \w+ limit 1 /.test(l)), lim16 = t.filter((l) => /^C cat \w+ limit 16 /.test(l));
    const f = (ls, i) => ls.reduce((s, l) => s + Number(l.split(' ')[i]), 0);
    const ex1 = f(lim1, 6), ex16 = f(lim16, 6), cv = f(lim1, 10) + f(lim16, 10), cs = f(lim1, 12) + f(lim16, 12), ch = f(lim1, 14) + f(lim16, 14), ce = f(lim1, 16) + f(lim16, 16), rg = f(lim1, 8) + f(lim16, 8);
    const searches = s1 + s16;
    const pushes = Number(g(/^C merges/).split(' ')[6]), starts = Number(g(/^C merges/).split(' ')[4]);
    const built = Number(g(/^C nearest_total/).split(' ')[6]);
    const maxq = g(/^C per_id_nearest max/).split(' ')[3];
    const hist = Object.fromEntries(g(/^C per_id_nearest_hist/).split(' ').slice(2).map((x) => x.split(':')));
    const distinct = Object.entries(hist).filter(([k]) => k !== '0').reduce((a, [, v]) => a + Number(v), 0);
    const cat = (n, lim) => f(t.filter((l) => new RegExp(`^C cat ${n} limit ${lim} `).test(l)), 6);
    const exall = ex1 + ex16;
    const share = [cat('fresh', 1), cat('exposed', 1), cat('start', 1), ex16].map((x) => (100 * x / exall).toFixed(0) + '%').join(' / ');
    console.log(`| ${img} | ${meta[img].distinct} | ${(nearest / merges).toFixed(2)} | ${s1} / ${s16} | ${((ex1 + ex16) / searches).toFixed(0)} | ${(100 * hit / cached).toFixed(0)}% (${cached} queries) | ${built} | ${(100 * ex16 / (ex1 + ex16)).toFixed(0)}% | ${(cv / searches).toFixed(0)} | ${(100 * cs / cv).toFixed(0)}% | ${(ch / searches).toFixed(0)} | ${(100 * ce / ch).toFixed(1)}% | ${(rg / searches).toFixed(1)} | ${((pushes + starts) / starts).toFixed(1)} | ${maxq} | ${(100 * (1 - distinct / nearest)).toFixed(0)}% | ${share} |`);
}
