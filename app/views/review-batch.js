// Batch mode of the review queue for "Szybkie" and "Do dodania": a grid of cards — the listing photo
// next to the cover of the proposed book (or the edition about to be created) — all ticked. The
// operator unticks the exceptions and approves the rest with one Enter. Every offer gets its own
// decision; the toast and "Ostatnie decyzje" can undo the whole batch.
import { coverMarkup, isbnCover, tidyOfferTitle, tidyWorkTitle, cleanPublisher } from '../core/bibliography.js';

export const BATCH_BUCKETS = ['quick', 'add'];

/** What the server needs to apply the kept cards. */
export function batchPayload(kind, items) {
  if (kind === 'add') return { jobIds: items.map((item) => item.jobId) };
  return {
    items: items.map(({ jobId, editionId, workId, isbn, kind: itemKind }) =>
      itemKind === 'edition' ? (editionId ? { jobId, editionId } : { jobId, workId }) : { jobId, isbn },
    ),
  };
}

/** Text of one card: the target book and the facts that tell editions apart. */
export function batchCardFacts(item) {
  const facts = [];
  if (item.kind === 'add') facts.push('nowe wydanie', cleanPublisher(item.publisher || ''), item.year, 'ISBN ' + item.isbn);
  else if (item.kind === 'edition')
    facts.push('z katalogu', cleanPublisher(item.publisher || ''), item.year, item.isbn && 'ISBN ' + item.isbn, item.editions > 1 && !item.editionId ? 'wydanie nieustalone' : '');
  else facts.push('nowe wydanie z BN / Open Library', item.year, 'ISBN ' + item.isbn);
  return facts.filter(Boolean).map(String);
}

export function createReviewBatch({ $, json, toast, escapeHtml, money, onApplied }) {
  const plans = new Map();
  let shown = null;
  let applying = false;
  const off = new Set();

  const wanted = (bucket) => BATCH_BUCKETS.includes(bucket) && !off.has(bucket);

  function card(item, index) {
    const target = item.kind === 'add' ? item.title : tidyWorkTitle(item.title);
    const cover = item.isbn ? isbnCover(item.isbn, 'M') : null;
    const author = [].concat(item.authors ?? [])[0] || '';
    return `<li><label class="rv-batch-card"><input type="checkbox" checked data-batch-index="${index}">
      <span class="rv-batch-pair">${coverMarkup(item.offerImage, tidyOfferTitle(item.offerTitle), { size: 'lg', escapeHtml })}${item.kind === 'add' ? '' : coverMarkup(cover, target, { size: 'lg', escapeHtml })}</span>
      <span class="rv-batch-copy"><small class="rv-batch-offer">${escapeHtml(tidyOfferTitle(item.offerTitle))} · ${escapeHtml(item.source || '')}${item.price != null ? ' · ' + money(item.price) : ''}</small>
        <b>→ ${escapeHtml(String(target).split(' / ')[0])}</b>${author ? `<small>${escapeHtml(author)}</small>` : ''}
        <span class="rv-facts">${batchCardFacts(item).map((fact) => `<span class="fact">${escapeHtml(fact)}</span>`).join('')}</span>
        ${item.score ? `<small class="rv-batch-score">dopasowanie ${Math.round(item.score * 100)}%</small>` : ''}${item.siblings ? `<small>obejmie też ${item.siblings} inne oferty z tym ISBN</small>` : ''}</span></label></li>`;
  }

  function checkedItems() {
    const plan = plans.get(shown);
    if (!plan) return [];
    return [...document.querySelectorAll('#reviewDetail [data-batch-index]:checked')].map((box) => plan.items[Number(box.dataset.batchIndex)]);
  }

  function updateCount() {
    const button = document.querySelector('#reviewDetail [data-batch-apply]');
    if (!button) return;
    const count = checkedItems().length;
    button.disabled = !count || applying;
    button.querySelector('[data-batch-label]').textContent = applying ? 'Zapisuję…' : `Zatwierdź zaznaczone (${count})`;
  }

  /**
   * Shows the grid of a bucket in the detail panel. Resolves false when there is nothing to batch
   * (the queue then shows one offer at a time).
   */
  async function render(bucket) {
    const mount = $('#reviewDetail');
    shown = bucket;
    mount.dataset.jobId = 'batch:' + bucket;
    let plan = plans.get(bucket);
    if (!plan) {
      mount.innerHTML = '<div class="empty-detail"><p>Przygotowuję pewne decyzje…</p></div>';
      try {
        plan = await json(`/api/review-batches/${bucket}/plan`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      } catch (error) {
        toast('Nie udało się przygotować trybu wsadowego: ' + error.message);
        plan = { items: [], skipped: 0 };
      }
      plans.set(bucket, plan);
    }
    if (shown !== bucket) return true;
    if (!plan.items.length) {
      off.add(bucket);
      shown = null;
      return false;
    }
    const kind = bucket === 'add' ? 'Do dodania' : 'Szybkie';
    mount.innerHTML = `<div class="rv rv-batch" aria-label="Tryb wsadowy: ${kind}">
      <header class="rv-head rv-batch-head"><div class="rv-head-main"><p class="rv-kicker"><span>Tryb wsadowy</span><span>${kind}</span></p>
        <h3>${plan.items.length} ${bucket === 'add' ? 'wydań gotowych do utworzenia' : 'pewnych dopasowań'}</h3>
        <p class="inline-note">Wszystkie są zaznaczone. Odznacz wyjątki (kliknięcie karty) i zatwierdź resztę <kbd>Enter</kbd>. Każda oferta dostaje własną decyzję; całą partię cofniesz w „Ostatnich decyzjach”.${plan.skipped ? ` ${plan.skipped} niejednoznacznych zostaje do decyzji pojedynczo.` : ''}</p></div></header>
      <div class="rv-body rv-batch-body"><ol class="rv-batch-grid">${plan.items.map(card).join('')}</ol></div>
      <footer class="lean-review-footer rv-actions"><div class="lean-review-primary-actions"><button class="button primary" type="button" data-batch-apply><span data-batch-label>Zatwierdź zaznaczone (${plan.items.length})</span><kbd>Enter</kbd></button><button class="button secondary" type="button" data-batch-single>Pojedynczo <kbd>Esc</kbd></button></div></footer>
    </div>`;
    mount.querySelectorAll('[data-batch-index]').forEach((box) => box.addEventListener('change', updateCount));
    mount.querySelector('[data-batch-apply]').addEventListener('click', () => void apply());
    mount.querySelector('[data-batch-single]').addEventListener('click', () => single());
    return true;
  }

  async function apply() {
    const kind = shown;
    const items = checkedItems();
    if (!kind || !items.length || applying) return;
    applying = true;
    updateCount();
    try {
      const result = await json(`/api/review-batches/${kind}/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(batchPayload(kind, items)),
      });
      const failed = result.results.filter((row) => !row.ok).length;
      plans.delete(kind);
      shown = null;
      toast(
        `Zatwierdzono ${result.approved}.${failed ? ` ${failed} zostaje do decyzji pojedynczo (dane się zmieniły).` : ''}`,
        result.batchId
          ? {
              label: 'Cofnij partię',
              onClick: async () => {
                const undo = await json(`/api/review-batches/${encodeURIComponent(result.batchId)}/undo`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                plans.delete(kind);
                off.delete(kind);
                await onApplied();
                toast(`Cofnięto ${undo.reopened} decyzji — oferty wróciły do kolejki.`);
              },
              onError: (error) => toast('Nie cofnięto partii: ' + error.message),
            }
          : null,
      );
      await onApplied();
    } catch (error) {
      toast('Nie zapisano partii: ' + error.message);
    } finally {
      applying = false;
      updateCount();
    }
  }

  /** "Pojedynczo": this bucket shows one offer at a time until its tab is chosen again. */
  function single() {
    if (shown) off.add(shown);
    shown = null;
    onApplied({ reloadOnly: true });
  }

  return {
    wanted,
    render,
    apply,
    single,
    active: () => Boolean(shown),
    /** The tab was chosen again (or the queue reloaded after a decision): offer the grid again. */
    reset(bucket) {
      off.delete(bucket);
      plans.delete(bucket);
    },
    leave(bucket) {
      off.add(bucket);
      shown = null;
    },
  };
}
