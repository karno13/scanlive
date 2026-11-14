// @ts-check
// An offer that a complete scan of its search phrase no longer returns has most likely been sold or
// withdrawn. It is marked "not_seen" (re-seen offers return to "unconfirmed" on the next upsert), so
// that nobody spends review time on listings that are gone. Only a scan that reached the end of
// the results (status ok + pagination end) is allowed to conclude that an offer disappeared.
export function completeResults(results = []) {
  return results.filter(
    (result) =>
      result?.status === 'ok' &&
      result.pagination?.state === 'end' &&
      result.source &&
      result.query,
  );
}

export function markUnseenOffers(database, results, scannedAt) {
  let marked = 0;
  const statement = database.prepare(
    `UPDATE offers SET availability='not_seen'
     WHERE source=? AND availability='unconfirmed' AND last_seen_at < ?
       AND id IN (SELECT offer_id FROM offer_queries WHERE query=?)
     RETURNING id`,
  );
  const history = database.prepare(
    "INSERT OR IGNORE INTO offer_status_history(offer_id,status,via,observed_at) VALUES(?,'not_seen','scan',?)",
  );
  for (const result of completeResults(results))
    for (const row of statement.all(result.source, scannedAt, result.query)) {
      history.run(row.id, scannedAt);
      marked++;
    }
  return marked;
}
