// Prices of one book over all its editions: overall, per price variant (editions that sell for
// about the same: publisher + binding), and offers whose edition is not named. A dot chart shows
// the recorded price observations over time; the three largest variants get a colour, the rest
// stay grey (more than three hues are not told apart reliably in a scatter).
// The operator can merge two variants or move an edition to another variant.

const SLOTS = 3;

function plural(n, one, few, many) {
  return n === 1 ? one : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? few : many;
}

/** Variant key -> colour slot (1..3) or 0 (grey), by offer count; stable for the page. */
export function colourSlots(overview) {
  const slots = new Map();
  [...overview.variants]
    .filter((variant) => variant.offers > 0)
    .sort((a, b) => b.offers - a.offers || a.label.localeCompare(b.label, 'pl'))
    .forEach((variant, index) => slots.set(variant.key, index < SLOTS ? index + 1 : 0));
  return slots;
}

function chartMarkup(overview, slots, { money, escapeHtml }) {
  const points = overview.points.filter((point) => Number.isFinite(Date.parse(point.observedAt)) && point.price > 0);
  if (points.length < 2) return '';
  const width = 640, height = 200, left = 52, right = 12, top = 12, bottom = 26;
  const times = points.map((point) => Date.parse(point.observedAt));
  let t0 = Math.min(...times), t1 = Math.max(...times);
  if (t1 - t0 < 86400000) { t0 -= 43200000; t1 += 43200000; }
  const prices = points.map((point) => point.price);
  const pMax = Math.max(...prices) * 1.08;
  const x = (t) => left + ((t - t0) / (t1 - t0)) * (width - left - right);
  const y = (p) => top + (1 - p / pMax) * (height - top - bottom);
  const ticks = [0, 0.5, 1].map((share) => Math.round((pMax * share) / 100) * 100);
  const date = (t) => new Date(t).toLocaleDateString('pl-PL', { day: 'numeric', month: 'short', year: '2-digit' });
  const label = new Map(overview.variants.map((variant) => [variant.key, variant.label]));
  const grid = ticks
    .map((tick) => `<line x1="${left}" x2="${width - right}" y1="${y(tick)}" y2="${y(tick)}" class="wp-grid"/><text x="${left - 6}" y="${y(tick) + 4}" text-anchor="end" class="wp-axis">${escapeHtml(money(tick))}</text>`)
    .join('');
  const dots = points
    .map((point) => {
      const slot = point.variant === 'unknown' ? 0 : slots.get(point.variant) ?? 0;
      const name = point.variant === 'unknown' ? 'wydanie nieustalone' : label.get(point.variant) || 'wariant';
      const t = Date.parse(point.observedAt);
      return `<circle cx="${x(t).toFixed(1)}" cy="${y(point.price).toFixed(1)}" r="4.5" class="wp-dot wp-s${slot}" data-offer="${escapeHtml(point.offerId)}"><title>${escapeHtml(`${money(point.price)} · ${name} · ${date(t)}`)}</title></circle>`;
    })
    .join('');
  return `<figure class="wp-chart"><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Ceny ofert tej książki w czasie, ${points.length} odczytów">${grid}<text x="${left}" y="${height - 6}" class="wp-axis">${escapeHtml(date(t0))}</text><text x="${width - right}" y="${height - 6}" text-anchor="end" class="wp-axis">${escapeHtml(date(t1))}</text>${dots}</svg><figcaption class="inline-note">Każdy punkt to zapisany odczyt ceny ogłoszenia (cena ofertowa, nie transakcja). Najedź na punkt, aby zobaczyć szczegóły.</figcaption></figure>`;
}

function statCells(stats, money) {
  return `<td>${stats.live || '–'}</td><td><b>${stats.median != null ? money(stats.median) : '–'}</b></td><td>${stats.min != null ? money(stats.min) : '–'}</td><td>${stats.sold ? `${stats.sold} · ${money(stats.soldMedian)}` : '–'}</td>`;
}

const CONDITION_LABELS = { new: 'Nowa', very_good: 'Bardzo dobra', good: 'Dobra', satisfactory: 'Zadowalająca', unknown: 'Stan nieznany' };

// Comparable groups: the kind of offer (new in a shop, antiquarian, private copy) and, for copies,
// their condition. A median over all of them mixed a new Empik book with a worn Vinted copy.
function comparableMarkup(overview, { money, escapeHtml }) {
  const sold = overview.vintedSold || { count: 0 };
  // A tile without data ("Sprzedane na Vinted —") says nothing: only tiles with a value are shown.
  const tiles = [
    sold.count && `<div class="wp-sold"><small>Sprzedane na Vinted</small><strong>${sold.count ? money(sold.median) : '–'}</strong><small>${sold.count ? `${sold.count} ${plural(sold.count, 'sprzedaż', 'sprzedaże', 'sprzedaży')}${sold.count > 1 ? ` · ${money(sold.min)}–${money(sold.max)}` : ''}` : 'brak potwierdzonych sprzedaży'}</small></div>`,
    ...(overview.kinds || []).filter((row) => row.median != null).map((row) => `<div><small>${escapeHtml(row.label)}</small><strong>${row.median != null ? money(row.median) : '–'}</strong><small>${row.live} ${plural(row.live, 'dostępna', 'dostępne', 'dostępnych')}${row.min != null && row.live > 1 ? ` · od ${money(row.min)}` : ''}</small></div>`),
  ].filter(Boolean);
  const kindRows = (overview.kinds || []).map((row) => `<tr><th scope="row">${escapeHtml(row.label)}</th>${statCells(row, money)}</tr>`).join('');
  const conditionRows = (overview.conditions || []).map((row) => `<tr><th scope="row">${escapeHtml(CONDITION_LABELS[row.condition] || row.condition)}</th>${statCells(row, money)}</tr>`).join('');
  return `<div class="edition-price-summary wp-comparable">${tiles.join('')}</div>
    ${(overview.kinds || []).length > 1 || (overview.conditions || []).length > 1 ? `<div class="wp-table-wrap"><table class="wp-table"><thead><tr><th scope="col">Rodzaj oferty / stan</th><th scope="col">Oferty</th><th scope="col">Mediana</th><th scope="col">Najniższa</th><th scope="col">Sprzedane</th></tr></thead><tbody>${kindRows}</tbody>${conditionRows ? `<tbody class="wp-conditions"><tr><th scope="rowgroup" colspan="5">Wg stanu egzemplarza (wszystkie rodzaje)</th></tr>${conditionRows}</tbody>` : ''}</table></div>` : ''}`;
}

export function workPricesMarkup(overview, { money, escapeHtml }) {
  const slots = colourSlots(overview);
  const { overall } = overview;
  const variants = [...overview.variants].sort((a, b) => b.offers - a.offers || a.label.localeCompare(b.label, 'pl'));
  const rows = variants
    .map((variant) => {
      const slot = slots.get(variant.key) ?? 0;
      const years = variant.years.length ? (variant.years.length > 1 ? `${variant.years[0]}–${variant.years.at(-1)}` : String(variant.years[0])) : '';
      return `<tr><th scope="row"><span class="wp-key wp-s${slot}" aria-hidden="true"></span>${escapeHtml(variant.label)}<small>${escapeHtml([variant.editionIds.length + ' ' + plural(variant.editionIds.length, 'wydanie', 'wydania', 'wydań'), years, variant.manual ? 'ręcznie' : ''].filter(Boolean).join(' · '))}</small></th>${statCells(variant, money)}</tr>`;
    })
    .join('');
  const unknown = overview.unknown.offers
    ? `<tr class="wp-unknown"><th scope="row"><span class="wp-key wp-s0" aria-hidden="true"></span>Wydanie nieustalone<small>${overview.unknown.offers} ${plural(overview.unknown.offers, 'oferta', 'oferty', 'ofert')} bez wskazanego wydania</small></th>${statCells(overview.unknown, money)}</tr>`
    : '';
  const legend = variants
    .filter((variant) => slots.get(variant.key))
    .map((variant) => `<span><i class="wp-key wp-s${slots.get(variant.key)}"></i>${escapeHtml(variant.label)}</span>`)
    .join('') + (variants.some((variant) => variant.offers && !slots.get(variant.key)) || overview.unknown.offers ? '<span><i class="wp-key wp-s0"></i>pozostałe i nieustalone</span>' : '');
  // One variant with no unnamed offers repeats the tiles above: the table and its note start at two rows.
  const chart = overall.offers ? chartMarkup(overview, slots, { money, escapeHtml }) : '';
  const variantTable = variants.length + (unknown ? 1 : 0) > 1;
  return `<section class="detail-section work-prices"><h4>Ceny tej książki — wszystkie wydania</h4>
    ${overall.offers ? comparableMarkup(overview, { money, escapeHtml }) : '<p class="inline-note">Brak ofert przypisanych do tej książki.</p>'}
    ${chart}
    ${chart && legend ? `<div class="wp-legend">${legend}</div>` : ''}
    ${variantTable ? `<div class="wp-table-wrap"><table class="wp-table"><thead><tr><th scope="col">Wariant cenowy</th><th scope="col">Oferty</th><th scope="col">Mediana</th><th scope="col">Najniższa</th><th scope="col">Sprzedane</th></tr></thead><tbody>${rows}${unknown}</tbody></table></div>` : ''}
    <p class="inline-note">${variantTable ? 'Warianty łączą wydania o podobnej cenie (ten sam wydawca i oprawa). Mediana wariantu liczy tylko oferty z tym wydaniem; „nieustalone” wchodzą do ceny całej książki. ' : ''}Ceny ofertowe w PLN, bez dostawy; nowe książki ze sklepów, antykwariaty i prywatne egzemplarze liczone osobno.</p>
    ${variants.length > 1 ? variantToolsMarkup(variants, escapeHtml) : ''}
  </section>`;
}

function variantToolsMarkup(variants, escapeHtml) {
  const options = variants.map((variant) => `<option value="${escapeHtml(variant.key)}">${escapeHtml(variant.label)}</option>`).join('');
  return `<details class="wp-tools"><summary>Popraw warianty</summary><p class="inline-note">Połącz warianty, które w praktyce kosztują tyle samo (np. ten sam wydawca pod dwiema nazwami). Pojedyncze wydanie przeniesiesz przy liście wydań poniżej.</p><div class="wp-tools-row"><label>Połącz <select data-wp-from aria-label="Wariant do połączenia">${options}</select></label><label>z <select data-wp-to aria-label="Wariant docelowy">${options}</select></label><button type="button" class="button secondary" data-wp-merge>Połącz</button></div></details>`;
}

/** Select next to an edition line: move it to another variant, its own, or back to automatic. */
export function editionVariantSelect(edition, variants, escapeHtml) {
  if (!edition.variantKey || variants.length < 1) return '';
  const others = variants.filter((variant) => variant.key !== edition.variantKey);
  const current = variants.find((variant) => variant.key === edition.variantKey);
  return `<label class="wp-move"><small>Wariant:</small><select data-wp-edition="${escapeHtml(edition.id)}" aria-label="Wariant cenowy wydania ${escapeHtml(edition.title)}"><option value="" selected>${escapeHtml(current?.label || 'automatyczny')}</option>${others.map((variant) => `<option value="${escapeHtml(variant.key)}">→ ${escapeHtml(variant.label)}</option>`).join('')}<option value="own">→ osobny wariant</option>${current?.manual ? '<option value="auto">↺ automatycznie</option>' : ''}</select></label>`;
}

/**
 * Loads the book's prices into `detail` (after the first section) and wires the variant tools.
 * `reload` re-opens the work detail after a change.
 */
export async function mountWorkPrices({ row, detail, json, money, escapeHtml, toast, reload, isCurrent }) {
  let overview;
  try {
    overview = await json('/api/catalog/works/' + encodeURIComponent(row.id) + '/prices');
  } catch (error) {
    return;
  }
  if (!detail.isConnected || !isCurrent()) return;
  const holder = document.createElement('div');
  holder.innerHTML = workPricesMarkup(overview, { money, escapeHtml });
  const section = holder.firstElementChild;
  detail.querySelector('.detail-section')?.after(section);
  section.querySelector('[data-wp-merge]')?.addEventListener('click', async (event) => {
    const from = section.querySelector('[data-wp-from]').value;
    const to = section.querySelector('[data-wp-to]').value;
    if (from === to) return toast('Wybierz dwa różne warianty.');
    event.target.disabled = true;
    try {
      await json('/api/catalog/works/' + encodeURIComponent(row.id) + '/variants/merge', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from, to }) });
      toast('Połączono warianty.');
      reload();
    } catch (error) {
      toast('Nie połączono wariantów: ' + error.message);
      event.target.disabled = false;
    }
  });
}

/** Wires the per-edition variant selects rendered by editionVariantSelect. */
export function wireEditionVariantSelects(detail, { json, toast, reload }) {
  detail.querySelectorAll('[data-wp-edition]').forEach((select) =>
    select.addEventListener('change', async () => {
      if (!select.value) return;
      select.disabled = true;
      try {
        await json('/api/catalog/editions/' + encodeURIComponent(select.dataset.wpEdition) + '/variant', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ variantKey: select.value === 'auto' ? null : select.value }),
        });
        toast(select.value === 'auto' ? 'Przywrócono automatyczny wariant.' : 'Przeniesiono wydanie.');
        reload();
      } catch (error) {
        toast('Nie przeniesiono wydania: ' + error.message);
        select.disabled = false;
      }
    }),
  );
}
