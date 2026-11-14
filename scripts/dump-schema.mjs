// The current database schema in one file: every migration applied to an empty in-memory database,
// then the resulting tables, indexes, triggers and views printed in a stable order.
//   node scripts/dump-schema.mjs          writes docs/SCHEMA.sql
// schema-doc.test.mjs fails when docs/SCHEMA.sql no longer matches the migrations.
import { DatabaseSync } from 'node:sqlite';
import { writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { applyCatalogMigrations, availableCatalogMigrations } from '../catalog-migrations.mjs';

export const schemaDocPath = fileURLToPath(new URL('../docs/SCHEMA.sql', import.meta.url));

const typeOrder = { table: 0, index: 1, trigger: 2, view: 3 };

export function currentSchemaText() {
  const database = new DatabaseSync(':memory:');
  try {
    applyCatalogMigrations(database);
    const objects = database
      .prepare(
        "SELECT type, name, tbl_name AS tableName, sql FROM sqlite_master WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'",
      )
      .all();
    const tables = [...new Set(objects.map((object) => object.tableName))].sort();
    const last = availableCatalogMigrations().at(-1);
    const lines = [
      '-- BookFlip: current SQLite schema (generated, do not edit).',
      `-- All migrations up to ${last.name} applied to an empty database.`,
      '-- Regenerate after adding a migration: node scripts/dump-schema.mjs',
      '',
    ];
    for (const table of tables) {
      const own = objects
        .filter((object) => object.tableName === table)
        .sort(
          (a, b) =>
            typeOrder[a.type] - typeOrder[b.type] ||
            (a.name < b.name ? -1 : a.name > b.name ? 1 : 0),
        );
      lines.push(`-- ${table}`);
      for (const object of own) lines.push(object.sql.replace(/\r\n/g, '\n').trim() + ';');
      lines.push('');
    }
    return lines.join('\n');
  } finally {
    database.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  writeFileSync(schemaDocPath, currentSchemaText());
  console.log('Schema written to', schemaDocPath);
}
