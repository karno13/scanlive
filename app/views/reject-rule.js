// Rejecting with "odrzucaj takie zawsze": the operator rejects the offer and may tick that offers
// like it are rejected from now on — from the same seller, with a phrase in the title, or above /
// below a price. The rule rejects the matching offers already waiting at once; each such rejection
// is its own decision in "Ostatnie decyzje". Rules are listed (and removed) in Ustawienia.

/** Words of a listing title worth offering as the phrase: the first three meaningful words. */
export function suggestedPhrase(title) {
  return String(title ?? '')
    .split(/[\s,.;:()\[\]/|+–-]+/)
    .filter((word) => word.length >= 3 && !/^\d+$/.test(word))
    .slice(0, 3)
    .join(' ');
}

/** Body of POST /api/rejection-rules for the chosen option, or null when the form is incomplete. */
export function ruleRequest(kind, { offerId, phrase, price }) {
  if (kind === 'seller') return { kind, offerId };
  if (kind === 'phrase') return String(phrase ?? '').trim().length >= 3 ? { kind, value: String(phrase).trim(), offerId } : null;
  if (kind === 'price_above' || kind === 'price_below') {
    const value = Number(String(price ?? '').replace(',', '.'));
    return Number.isFinite(value) && value > 0 ? { kind, value, offerId } : null;
  }
  return null;
}

export function createRejectRule({ json, toast, escapeHtml, money }) {
  let dialog = null;

  /**
   * Opens the dialog for an offer. `reject()` makes the decision (the review's own reject, with its
   * undo toast); the rule is saved after it, so it never takes the offer being decided.
   */
  function open({ offer, reject }) {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'modal reject-rule-dialog';
      dialog.setAttribute('aria-labelledby', 'rejectRuleTitle');
      document.body.append(dialog);
    }
    const price = offer.currentPrice != null && offer.currency !== 'EUR' ? (offer.currentPrice / 100).toFixed(2) : '';
    const seller = offer.sellerId
      ? `<label class="reject-rule-option"><input type="radio" name="kind" value="seller" checked><span>od tego sprzedawcy: <b>${escapeHtml(offer.sellerName || offer.sellerId)}</b> (${escapeHtml(offer.source)})</span></label>`
      : '<p class="inline-note">Źródło nie podało sprzedawcy tej oferty — reguła według sprzedawcy jest niedostępna.</p>';
    dialog.innerHTML = `<form method="dialog" class="reject-rule-form">
      <div class="modal-heading"><div><p class="topbar-kicker">Odrzucenie</p><h2 id="rejectRuleTitle">Odrzuć ofertę</h2></div></div>
      <p class="reject-rule-offer">${escapeHtml(offer.title || '')} · ${escapeHtml(offer.source || '')}${offer.currentPrice != null ? ' · ' + money(offer.currentPrice) : ''}</p>
      <label class="toggle-chip reject-rule-always"><input type="checkbox" name="always"><span>Odrzucaj takie zawsze</span></label>
      <fieldset class="reject-rule-kinds" disabled>
        <legend class="sr-only">Jakie oferty odrzucać</legend>
        ${seller}
        <label class="reject-rule-option"><input type="radio" name="kind" value="phrase"${offer.sellerId ? '' : ' checked'}><span>z tytułem zawierającym</span><input name="phrase" type="text" maxlength="120" value="${escapeHtml(suggestedPhrase(offer.title))}" aria-label="Fraza w tytule"></label>
        <label class="reject-rule-option"><input type="radio" name="kind" value="price_above"><span>droższe niż (zł)</span><input name="priceAbove" type="number" min="0.01" step="0.01" inputmode="decimal" value="${escapeHtml(price)}" aria-label="Próg ceny w złotych"></label>
        <label class="reject-rule-option"><input type="radio" name="kind" value="price_below"><span>tańsze niż (zł)</span><input name="priceBelow" type="number" min="0.01" step="0.01" inputmode="decimal" value="${escapeHtml(price)}" aria-label="Próg ceny w złotych"></label>
        <p class="inline-note">Reguła odrzuci od razu pasujące oferty czekające w kolejce i każdą nową. Ręczne przypisania i zestawy zawsze wygrywają. Każde odrzucenie cofniesz w „Ostatnich decyzjach”, regułę usuniesz w Ustawieniach.</p>
      </fieldset>
      <p class="inline-alert" data-rule-error hidden></p>
      <div class="modal-actions"><button type="button" class="button secondary" data-rule-cancel>Anuluj</button><button type="submit" class="button primary" data-rule-submit>Odrzuć</button></div>
    </form>`;
    const form = dialog.querySelector('form');
    const always = form.elements.always;
    const fields = form.querySelector('.reject-rule-kinds');
    always.addEventListener('change', () => {
      fields.disabled = !always.checked;
      form.querySelector('[data-rule-submit]').textContent = always.checked ? 'Odrzuć i zapisz regułę' : 'Odrzuć';
    });
    form.querySelector('[data-rule-cancel]').addEventListener('click', () => dialog.close());
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const kind = form.elements.kind.value;
      const body = always.checked
        ? ruleRequest(kind, {
            offerId: offer.id,
            phrase: form.elements.phrase.value,
            price: kind === 'price_above' ? form.elements.priceAbove.value : form.elements.priceBelow.value,
          })
        : null;
      if (always.checked && !body) {
        const error = form.querySelector('[data-rule-error]');
        error.hidden = false;
        error.textContent = kind === 'phrase' ? 'Fraza musi mieć co najmniej 3 znaki.' : 'Podaj cenę większą od zera.';
        return;
      }
      dialog.close();
      await reject();
      if (!body) return;
      try {
        const rule = await json('/api/rejection-rules', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        toast(
          (rule.created ? 'Zapisano regułę odrzucania.' : 'Taka reguła już istnieje.') +
            (rule.rejected ? ` Odrzuciła jeszcze ${rule.rejected} ${rule.rejected === 1 ? 'ofertę' : 'oferty'} z kolejki.` : ''),
          rule.created
            ? {
                label: 'Usuń regułę',
                onClick: () => json('/api/rejection-rules/' + encodeURIComponent(rule.id), { method: 'DELETE' }),
                onError: () => toast('Nie udało się usunąć reguły — zrób to w Ustawieniach.'),
              }
            : null,
        );
        document.dispatchEvent(new CustomEvent('bookflip-rules-changed'));
      } catch (error) {
        toast('Oferta odrzucona, ale reguły nie zapisano: ' + error.message);
      }
    });
    dialog.showModal();
    always.focus();
  }

  return { open };
}

/** "Reguły odrzucania" in Ustawienia: every rule, what it rejected so far, and "Usuń". */
export function mountRuleSettings({ $, json, toast, escapeHtml }) {
  const mount = $('#rejectionRules');
  if (!mount) return { refresh: async () => {} };
  async function refresh() {
    try {
      const { items } = await json('/api/rejection-rules');
      mount.innerHTML = items.length
        ? `<ul class="rule-list">${items
            .map(
              (rule) =>
                `<li><span><b>${escapeHtml(rule.text)}</b><small>odrzuciła ${rule.hits} · od ${escapeHtml(new Date(rule.createdAt).toLocaleDateString('pl-PL'))}</small></span><button type="button" class="button secondary compact" data-rule-delete="${escapeHtml(rule.id)}">Usuń</button></li>`,
            )
            .join('')}</ul>`
        : '<p class="inline-note">Brak reguł. Dodasz je przy odrzucaniu oferty w kolejce: „Więcej” → „Odrzuć z regułą…” (klawisz R).</p>';
      mount.querySelectorAll('[data-rule-delete]').forEach((button) =>
        button.addEventListener('click', async () => {
          button.disabled = true;
          try {
            await json('/api/rejection-rules/' + encodeURIComponent(button.dataset.ruleDelete), { method: 'DELETE' });
            toast('Usunięto regułę. Odrzucone przez nią oferty zostają odrzucone — każdą cofniesz w „Ostatnich decyzjach”.');
            await refresh();
          } catch (error) {
            button.disabled = false;
            toast('Nie usunięto reguły: ' + error.message);
          }
        }),
      );
    } catch (error) {
      mount.innerHTML = '<p class="inline-note">Nie udało się wczytać reguł.</p>';
    }
  }
  document.addEventListener('bookflip-rules-changed', () => void refresh());
  return { refresh };
}
