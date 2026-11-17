// @ts-check
// Routes of the review queue ("Kolejka"): identification jobs and their decisions, batch decisions,
// ISBN checks and lookups, starting and pausing identification.
import {
  addBatchPlan,
  applyAddBatch,
  applyQuickBatch,
  quickBatchPlan,
  recentBatches,
  undoBatch,
} from '../review-batches.mjs';
import { retryIdentificationJobs } from '../identification-retry.mjs';
import { computeProposal, loadProposal } from '../title-proposals.mjs';
import { historyBookLabels } from '../history-brief.mjs';
import { normalizeISBN } from '../isbn-normalization.mjs';
import {
  decideIdentificationJob,
  listIdentificationJobs,
  matchIdentificationJobByIsbn,
  localWorkCandidates,
  sureReviewPlan,
  applySureReviewPlan,
  approveJobAsBook,
  updateReviewSkipped,
} from '../review-queue.mjs';
import { offerEditionDraft, createEditionFromOffer } from '../offer-editions.mjs';
import { storageMode, createSqliteBook, linkSqliteOffer } from '../sqlite-single-store.mjs';
import { readJson, send, catalogHistorySnapshot, withHistoryWriteLock } from '../app-runtime.mjs';

export function addReviewRoutes(routes, { getProductionCatalog, identificationControl }) {
  routes
    // Batch approval in the queue ("Szybkie", "Do dodania") and undoing a whole batch.
    .add(
      'POST',
      '/api/review-batches/:kind/plan',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        const jobIds = Array.isArray(input.jobIds) ? input.jobIds.map(String).slice(0, 500) : null;
        if (!['quick', 'add'].includes(params.kind))
          return send(response, 404, JSON.stringify({ error: 'UNKNOWN_BATCH' }));
        const plan =
          params.kind === 'quick'
            ? quickBatchPlan(catalog.repository, { jobIds })
            : addBatchPlan(catalog.repository, { jobIds });
        return send(response, 200, JSON.stringify(plan));
      },
    )
    .add(
      'POST',
      '/api/review-batches/:kind/apply',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        if (params.kind === 'quick')
          return send(
            response,
            200,
            JSON.stringify(
              await applyQuickBatch(catalog, Array.isArray(input.items) ? input.items : []),
            ),
          );
        if (params.kind === 'add')
          return send(
            response,
            200,
            JSON.stringify(
              applyAddBatch(
                catalog.repository,
                Array.isArray(input.jobIds) ? input.jobIds.map(String) : [],
              ),
            ),
          );
        return send(response, 404, JSON.stringify({ error: 'UNKNOWN_BATCH' }));
      },
    )
    .add('GET', '/api/review-batches', async ({ catalog, request, response, url, params }) => {
      return send(response, 200, JSON.stringify({ items: recentBatches(catalog.repository) }));
    })
    .add(
      'POST',
      '/api/review-batches/:id/undo',
      async ({ catalog, request, response, url, params }) => {
        return send(response, 200, JSON.stringify(undoBatch(catalog.repository, params.id)));
      },
    )
    .add('POST', '/api/catalog', async ({ request, response, url, params }) => {
      storageMode();
      const input = await readJson(request);
      const catalog = getProductionCatalog();
      if (!catalog) throw Error('SQLITE_STORAGE_REQUIRES_CATALOG');
      const created = await withHistoryWriteLock(async () => createSqliteBook(catalog, input));
      return send(
        response,
        created.created ? 201 : 200,
        JSON.stringify({
          book: created.book,
          editionId: created.editionId,
          catalog:
            url.searchParams.get('compact') === '1'
              ? historyBookLabels(catalog.repository)
              : catalogHistorySnapshot(catalog.repository),
          catalogSync: { mode: 'sqlite' },
        }),
      );
    })
    .add('POST', '/api/identification/control', async ({ request, response, url, params }) => {
      const catalog = getProductionCatalog();
      if (!catalog || !identificationControl)
        return send(response, 503, JSON.stringify({ error: 'IDENTIFICATION_UNAVAILABLE' }));
      const { action, retryUnresolved = false } = await readJson(request);
      let retried = null;
      if (action === 'start') {
        if (retryUnresolved) retried = retryIdentificationJobs(catalog.repository, 'unresolved');
        const startedAt = new Date().toISOString();
        catalog.beginIdentificationRun(startedAt);
        identificationControl.start({ newRun: true, startedAt });
        void identificationControl.tick();
      } else if (action === 'stop') identificationControl.pause();
      else return send(response, 400, JSON.stringify({ error: 'INVALID_IDENTIFICATION_ACTION' }));
      return send(response, 200, JSON.stringify({ ...identificationControl.status(), retried }));
    })
    .add(
      'POST',
      '/api/identification/retry',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        const result = retryIdentificationJobs(catalog.repository, input?.mode);
        if (result.queued > 0 && identificationControl) {
          identificationControl.start();
          void identificationControl.tick();
        }
        return send(response, 200, JSON.stringify(result));
      },
    )
    .add('GET', '/api/identification-jobs', async ({ catalog, request, response, url, params }) => {
      return send(
        response,
        200,
        JSON.stringify(
          listIdentificationJobs(catalog.repository, Object.fromEntries(url.searchParams)),
        ),
      );
    })
    // Offers skipped in review ("Pomiń"): { add: [jobId…] } or { clear: true }.
    .add('POST', '/api/review/skipped', async ({ catalog, request, response }) => {
      const input = (await readJson(request)) || {};
      const add = Array.isArray(input.add) ? input.add.slice(0, 500) : [];
      return send(
        response,
        200,
        JSON.stringify(
          updateReviewSkipped(catalog.repository, { add, clear: input.clear === true }),
        ),
      );
    })
    // "Szybkie" tab: the sure decisions to look through, then apply the ones the operator kept.
    .add(
      'POST',
      '/api/identification-jobs/sure-plan',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        const jobIds = Array.isArray(input?.jobIds)
          ? input.jobIds.map(String).slice(0, 2000)
          : null;
        return send(response, 200, JSON.stringify(sureReviewPlan(catalog.repository, { jobIds })));
      },
    )
    .add(
      'POST',
      '/api/identification-jobs/sure-apply',
      async ({ catalog, request, response, url, params }) => {
        const input = await readJson(request);
        const result = await applySureReviewPlan(
          catalog,
          Array.isArray(input?.items) ? input.items : [],
        );
        // Approvals add ISBNs to the catalogue: the sibling offers with them are matched next.
        if (result.approved && identificationControl) {
          identificationControl.start();
          void identificationControl.tick();
        }
        return send(response, 200, JSON.stringify(result));
      },
    )
    // ISBN that no source knows: a draft built from the listings, then the edition in one click.
    .add(
      ['GET', 'POST'],
      '/api/identification-jobs/:id/offer-edition',
      async ({ catalog, request, response, url, params }) => {
        const jobId = params.id;
        if (request.method === 'GET')
          return send(response, 200, JSON.stringify(offerEditionDraft(catalog.repository, jobId)));
        const result = createEditionFromOffer(catalog.repository, jobId, await readJson(request));
        if (identificationControl) {
          identificationControl.start();
          void identificationControl.tick();
        }
        return send(response, 200, JSON.stringify(result));
      },
    )
    .add(
      'POST',
      '/api/identification-jobs/:id/decision',
      async ({ catalog, request, response, url, params }) => {
        const id = params.id;
        const input = await readJson(request);
        // "This book, edition not settled" from a title proposal: the book is named by an ISBN.
        const result =
          input.action === 'approved' && input.bookIsbn && !input.editionId && !input.workId
            ? await approveJobAsBook(catalog, id, { isbn: input.bookIsbn })
            : decideIdentificationJob(catalog.repository, id, input);
        if (input.action === 'requeued' && identificationControl) {
          identificationControl.start();
          void identificationControl.tick();
        }
        return send(response, 200, JSON.stringify(result));
      },
    )
    .add(
      'GET',
      '/api/identification-jobs/:id/local-candidates',
      async ({ catalog, request, response, url, params }) => {
        const job = catalog.repository.database
          .prepare(
            'SELECT o.id AS offer_id, o.original_title FROM identification_jobs j JOIN offers o ON o.id=j.offer_id WHERE j.id=?',
          )
          .get(params.id);
        if (!job) return send(response, 404, JSON.stringify({ error: 'REVIEW_JOB_NOT_FOUND' }));
        return send(
          response,
          200,
          JSON.stringify({
            items: localWorkCandidates(catalog.repository, job.original_title, {
              offerId: job.offer_id,
            }),
          }),
        );
      },
    )
    .add(
      ['GET', 'POST'],
      '/api/identification-jobs/:id/proposals',
      async ({ catalog, request, response, url, params }) => {
        const id = params.id;
        const job = catalog.repository.database
          .prepare(
            "SELECT j.id,j.offer_id,o.original_title,o.observed_isbn FROM identification_jobs j JOIN offers o ON o.id=j.offer_id WHERE j.id=? AND j.status='review_required'",
          )
          .get(id);
        if (!job) return send(response, 404, JSON.stringify({ error: 'REVIEW_JOB_NOT_FOUND' }));
        // GET reads the stored proposal and computes one when missing; POST forces a fresh lookup.
        const stored = request.method === 'GET' ? loadProposal(catalog.repository, id) : null;
        if (stored) return send(response, 200, JSON.stringify(stored));
        const fresh = await computeProposal(catalog, job);
        return send(
          response,
          200,
          JSON.stringify({
            jobId: id,
            queries: fresh.queries,
            candidates: fresh.candidates,
            confidence: fresh.confidence,
            unavailable: fresh.unavailable,
          }),
        );
      },
    )
    .add(
      'POST',
      '/api/identification-jobs/:id/find-isbn',
      async ({ catalog, request, response, url, params }) => {
        const id = params.id;
        const job = catalog.repository.database
          .prepare(
            "SELECT j.id,o.original_title FROM identification_jobs j JOIN offers o ON o.id=j.offer_id WHERE j.id=? AND j.status='review_required'",
          )
          .get(id);
        if (!job) return send(response, 404, JSON.stringify({ error: 'REVIEW_JOB_NOT_FOUND' }));
        const input = await readJson(request);
        return send(
          response,
          200,
          JSON.stringify(await catalog.findIsbnsByTitle(input?.title || job.original_title)),
        );
      },
    )
    .add(
      'POST',
      '/api/identification-jobs/:id/match-isbn',
      async ({ catalog, request, response, url, params }) => {
        const id = params.id;
        const input = await readJson(request);
        return send(
          response,
          200,
          JSON.stringify(await matchIdentificationJobByIsbn(catalog, id, input)),
        );
      },
    )
    .add('POST', '/api/catalog/isbn-check', async ({ catalog, request, response, url, params }) => {
      const raw = (await readJson(request)).isbn;
      const isbn = normalizeISBN(raw);
      if (!isbn) return send(response, 400, JSON.stringify({ error: 'INVALID_ISBN' }));
      const edition = catalog.repository.findEditionByISBN(isbn);
      return send(
        response,
        200,
        JSON.stringify({
          isbn,
          found: Boolean(edition),
          edition: edition
            ? {
                id: edition.id,
                title: edition.title,
                workId: edition.work_id,
                workTitle: edition.work_title,
              }
            : null,
        }),
      );
    })
    .add(
      'POST',
      '/api/catalog/lookup-preview',
      async ({ catalog, request, response, url, params }) => {
        const isbn = normalizeISBN((await readJson(request))?.isbn);
        if (!isbn) return send(response, 400, JSON.stringify({ error: 'INVALID_ISBN' }));
        return send(response, 200, JSON.stringify(await catalog.lookupIsbn(isbn)));
      },
    )
    .add(
      'POST',
      '/api/catalog/lookup-confirm',
      async ({ catalog, request, response, url, params }) => {
        const isbn = normalizeISBN((await readJson(request))?.isbn);
        if (!isbn) return send(response, 400, JSON.stringify({ error: 'INVALID_ISBN' }));
        const result = await catalog.resolveIsbn(isbn);
        return send(
          response,
          ['created_edition', 'created_work_and_edition', 'matched_existing'].includes(
            result.decision,
          )
            ? 200
            : 409,
          JSON.stringify(result),
        );
      },
    )
    .add('POST', '/api/catalog/link', async ({ request, response, url, params }) => {
      storageMode();
      const input = await readJson(request);
      const catalog = getProductionCatalog();
      if (!catalog) throw Error('SQLITE_STORAGE_REQUIRES_CATALOG');
      await withHistoryWriteLock(async () =>
        linkSqliteOffer(catalog, input, { returnHistory: false }),
      );
      return send(response, 200, JSON.stringify(catalogHistorySnapshot(catalog.repository)));
    });
}
