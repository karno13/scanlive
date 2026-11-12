// "To różne książki": works that the duplicate finder groups, but the operator knows are different
// books. Stored per group as one decision (migration 130), reversible, listed in "Ostatnie decyzje".
import { randomUUID } from 'node:crypto';

/** @param {string} code @param {number} status */
const fail = (code, status = 400) => {
  throw Object.assign(Error(code), { statusCode: status });
};

/** Set of 'a|b' (a < b) for every pair currently marked as different books. */
export function distinctPairs(repository) {
  const rows = repository.database
    .prepare('SELECT work_a, work_b FROM distinct_work_pairs WHERE undone_at IS NULL')
    .all();
  return new Set(rows.map((row) => `${row.work_a}|${row.work_b}`));
}

export const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);

/** True when every pair of the given work ids is marked as different books. */
export function allPairsDistinct(ids, pairs) {
  for (let i = 0; i < ids.length; i += 1)
    for (let j = i + 1; j < ids.length; j += 1)
      if (!pairs.has(pairKey(ids[i], ids[j]))) return false;
  return true;
}

export function markDistinct(
  repository,
  workIds,
  { now = () => new Date(), createdBy = 'local_user' } = {},
) {
  const ids = [...new Set(Array.isArray(workIds) ? workIds.map(String) : [])];
  if (ids.length < 2 || ids.length > 50) fail('INVALID_CATALOG_FIELDS');
  return repository.transaction(() => {
    const db = repository.database;
    const found = db
      .prepare(`SELECT id FROM works WHERE id IN (${ids.map(() => '?').join(',')})`)
      .all(...ids).length;
    if (found !== ids.length) fail('WORK_NOT_FOUND', 404);
    const decisionId = randomUUID();
    const at = now().toISOString();
    const insert = db.prepare(
      'INSERT INTO distinct_work_pairs (decision_id, work_a, work_b, created_by, created_at) VALUES (?,?,?,?,?)',
    );
    for (let i = 0; i < ids.length; i += 1)
      for (let j = i + 1; j < ids.length; j += 1) {
        const [a, b] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
        insert.run(decisionId, a, b, createdBy, at);
      }
    return { decisionId, works: ids.length };
  });
}

export function undoDistinct(repository, decisionId, { now = () => new Date() } = {}) {
  const result = repository.database
    .prepare('UPDATE distinct_work_pairs SET undone_at=? WHERE decision_id=? AND undone_at IS NULL')
    .run(now().toISOString(), String(decisionId));
  if (!result.changes) fail('DECISION_NOT_FOUND', 404);
  return { reopened: Number(result.changes) };
}

/** Latest decisions with the works they cover (titles), newest first. */
export function listDistinctDecisions(repository, limit = 30) {
  const db = repository.database;
  const decisions = db
    .prepare(
      `SELECT decision_id AS id, min(created_at) AS createdAt, max(undone_at IS NOT NULL) AS undone
       FROM distinct_work_pairs GROUP BY decision_id ORDER BY createdAt DESC LIMIT ?`,
    )
    .all(limit);
  const works = db.prepare(
    `SELECT DISTINCT w.id, w.title FROM works w JOIN distinct_work_pairs p
       ON w.id IN (p.work_a, p.work_b) WHERE p.decision_id=?`,
  );
  return decisions.map((row) => ({
    id: row.id,
    createdAt: row.createdAt,
    undone: Boolean(row.undone),
    works: works
      .all(row.id)
      .map((work) => ({ id: work.id, title: String(work.title).split(' / ')[0] })),
  }));
}
