import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

describe('engines', () => {
  it('engines and Babel targets agree on Node 22.12', () => {
    expect(JSON.parse(read('package.json')).engines.node).toBe('>=22.12.0');
    expect(JSON.parse(read('.babelrc')).targets).toContain('node >= 22.12');
  });
});
