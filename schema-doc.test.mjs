import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { currentSchemaText, schemaDocPath } from './scripts/dump-schema.mjs';

test('docs/SCHEMA.sql is the schema the migrations produce (node scripts/dump-schema.mjs)', () => {
  const saved = readFileSync(schemaDocPath, 'utf8').replace(/\r\n/g, '\n');
  assert.equal(
    saved,
    currentSchemaText(),
    'docs/SCHEMA.sql is out of date: run node scripts/dump-schema.mjs',
  );
});
