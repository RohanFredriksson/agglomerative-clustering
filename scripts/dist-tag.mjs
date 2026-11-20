// Prints the npm dist-tag a release publishes under (used by .github/workflows/publish.yml):
//   node scripts/dist-tag.mjs <version> [<current latest>]
// - a prerelease (1.2.3-beta.1) goes to `next`;
// - a stable version above the current `latest` (or with no `latest` yet) goes to `latest`;
// - any other stable version is a patch to an older line (3.1.2 after 3.2.0 shipped from release/3.1.x) and goes to
//   `v<major>.<minor>-latest`, so it doesn't take `latest` back from the newer line.
const [version, latest] = process.argv.slice(2);
const stable = /^(\d+)\.(\d+)\.(\d+)$/;

if (!version) {
  console.error('usage: node scripts/dist-tag.mjs <version> [<current latest>]');
  process.exit(2);
}

if (version.includes('-')) {
  console.log('next');
} else {
  const parts = version.match(stable);
  if (!parts) {
    console.error(`dist-tag: ${version} is not a version`);
    process.exit(2);
  }
  const current = latest ? latest.match(stable) : null;
  if (latest && !current) {
    console.error(`dist-tag: the current latest ${latest} is not a stable version`);
    process.exit(2);
  }
  const newer = !current || [1, 2, 3].map((i) => Number(parts[i]) - Number(current[i])).find((d) => d !== 0) > 0;
  console.log(newer ? 'latest' : `v${parts[1]}.${parts[2]}-latest`);
}
