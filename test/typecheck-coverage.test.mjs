import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// `npm run typecheck` checks only the files listed in tsconfig.typecheck.json. A module that opts in
// with `// @ts-check` but is missing from that list would never be checked by the command.
const root = fileURLToPath(new URL('..', import.meta.url));
const ignored = new Set([
  '.git',
  'node_modules',
  'scan-results',
  'coverage',
  'scratch',
  'artifacts',
]);

function sources(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((item) => {
    if (item.isDirectory()) return ignored.has(item.name) ? [] : sources(join(dir, item.name));
    return item.isFile() && /\.(?:mjs|js)$/.test(item.name) ? [join(dir, item.name)] : [];
  });
}

test('every // @ts-check file is listed in tsconfig.typecheck.json', () => {
  const config = JSON.parse(readFileSync(join(root, 'tsconfig.typecheck.json'), 'utf8'));
  const listed = new Set(config.files);
  const opted = sources(root)
    .filter((file) => /^\s*\/\/ @ts-check\b/.test(readFileSync(file, 'utf8')))
    .map((file) => relative(root, file).split(sep).join('/'));
  assert.ok(opted.length > 0, 'expected at least one // @ts-check file');
  const missing = opted.filter((file) => !listed.has(file));
  assert.deepEqual(missing, [], `add to "files" in tsconfig.typecheck.json: ${missing.join(', ')}`);
});
