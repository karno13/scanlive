// Market value (market-valuation.mjs on the server) as the owner sees it: a range, the
// confidence and the reasons. Amounts arrive in grosze.

export const zl = (grosze) => `${Math.round(grosze / 100)} zł`;

/** Polish count form: 1 oferta, 2 oferty, 5 ofert. */
export const plural = (n, one, few, many) => (n === 1 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many);

/** "70–95 zł" or "80 zł" when the range collapses. */
export function valuationRange(valuation) {
  if (!valuation || valuation.estimate == null) return '';
  return valuation.low === valuation.high ? zl(valuation.estimate) : `${Math.round(valuation.low / 100)}–${zl(valuation.high)}`;
}

/** Editions priced apart: "26–43 zł zależnie od wydania" instead of one blended amount. */
export function valuationEditionRange(valuation) {
  const range = valuation?.editionRange;
  return range ? `${Math.round(range.low / 100)}–${zl(range.high)} zależnie od wydania` : '';
}

/** Short basis for a list line: "3 sprzedaże, 2 oferty". */
export function valuationBasis(valuation) {
  if (!valuation || valuation.estimate == null) return 'brak cen';
  return [
    valuation.sold ? `${valuation.sold} ${plural(valuation.sold, 'sprzedaż', 'sprzedaże', 'sprzedaży')}` : 'bez sprzedaży',
    valuation.live ? `${valuation.live} ${plural(valuation.live, 'oferta', 'oferty', 'ofert')}` : '',
  ]
    .filter(Boolean)
    .join(', ');
}

/** One line under a book in a list; the full reasons are in the tooltip. */
export function valuationLineMarkup(valuation, escapeHtml) {
  if (!valuation) return '';
  if (valuation.estimate == null) return `<small class="value-line is-none">Wartość: brak danych do wyceny</small>`;
  const why = (valuation.reasons || []).join(' ');
  if (valuation.editionRange) return `<small class="value-line" title="${escapeHtml(`Wydania tej książki różnią się ceną — wycena każdego jest na stronie książki. Wszystkie wydania razem: ~${zl(valuation.estimate)}. ${why}`)}">Wartość <b>${valuationEditionRange(valuation)}</b> · ${escapeHtml(valuationBasis(valuation))}</small>`;
  return `<small class="value-line is-${escapeHtml(valuation.confidence)}" title="${escapeHtml(why)}">Wartość ~${zl(valuation.estimate)} <b>${valuationRange(valuation)}</b> · wiarygodność ${escapeHtml(valuation.confidenceLabel)} · ${escapeHtml(valuationBasis(valuation))}</small>`;
}

/** The book page's valuation box: value, range, confidence and the reasons as a list. */
export function valuationPanelMarkup(valuation, escapeHtml) {
  if (!valuation) return '';
  const head =
    valuation.estimate == null
      ? '<strong>Brak danych do wyceny</strong>'
      : valuation.editionRange
        ? `<strong>${valuationEditionRange(valuation)}</strong> <span>wycena każdego wydania jest przy nim na liście poniżej; wszystkie razem ~${zl(valuation.estimate)}</span>`
      : `<strong>~${zl(valuation.estimate)}</strong> <span>przedział ${valuationRange(valuation)}</span> <span class="value-confidence is-${escapeHtml(valuation.confidence)}">wiarygodność ${escapeHtml(valuation.confidenceLabel)}</span>`;
  const reasons = (valuation.reasons || []).map((reason) => `<li>${escapeHtml(reason)}</li>`).join('');
  return `<h4>Szacowana wartość rynkowa <small>używany egzemplarz w dobrym stanie</small></h4><p class="value-head">${head}</p>${reasons ? `<ul class="value-why">${reasons}</ul>` : ''}`;
}
