// Offline report on saved scan results: what each phrase brings and which
// phrases could cover more identified offers. Read-only, no network.
// Run on a COPY of the database, never the live one:
//   node scripts/backup-catalog.mjs <tmp>/copy.sqlite
//   node scripts/query-yield-report.mjs <tmp>/copy.sqlite [--profile "Name"] [--json]
import { DatabaseSync } from 'node:sqlite';
import { queryYieldReport } from '../query-yield.mjs';

const args = process.argv.slice(2);
const path = args.find((a) => !a.startsWith('--') && args[args.indexOf(a) - 1] !== '--profile');
if (!path) {
  console.error(
    'Użycie: node scripts/query-yield-report.mjs <kopia.sqlite> [--profile "Nazwa"] [--json]',
  );
  process.exit(2);
}
const db = new DatabaseSync(path, { readOnly: true });
const profileName = args.includes('--profile') ? args[args.indexOf('--profile') + 1] : null;
let queries;
if (profileName) {
  const row = /** @type {any} */ (
    db.prepare('SELECT queries_json FROM scan_profiles WHERE name = ?').get(profileName)
  );
  if (!row) {
    console.error(`Brak profilu „${profileName}”.`);
    process.exit(2);
  }
  queries = JSON.parse(row.queries_json);
}
const report = queryYieldReport(db, { queries });
db.close();
if (args.includes('--json')) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}
const t = report.totals;
console.log(
  `Frazy: ${t.queries} · oferty: ${t.offers} · rozpoznane: ${t.identified} · znalezione przez >1 frazę: ${t.foundByMoreThanOne}\n`,
);
console.log(
  'Fraza | oferty | tylko ta fraza | rozpoznane | rozpoznane tylko tą | wydania | duplikaty',
);
for (const q of report.perQuery)
  console.log(
    `${q.query} | ${q.offers} | ${q.unique} | ${q.identified} | ${q.uniqueIdentified} | ${q.editions} | ${Math.round(q.duplicateShare * 100)}%`,
  );
console.log('\nDo rozważenia pominięcie (same duplikaty):', report.drop.join('; ') || '—');
console.log('Głównie szum (<5% rozpoznanych):', report.noisy.join('; ') || '—');
console.log(
  '\nPropozycje (pokrywa = rozpoznane oferty z tą frazą w tytule; poza = których obecne frazy nie pokrywają):',
);
for (const s of report.suggestions)
  console.log(
    `[${s.kind}] ${s.phrase} — pokrywa ${s.covers}, poza ${s.beyond}, wydania ${s.editions} (z: ${s.from.join(', ')})`,
  );
