// The listing photo in review: a click opens it full size, and once a proposal with a cover is
// chosen the photo and that cover stand side by side at the same height, so "is this the book on
// the photo?" is answered by looking, not by reading.

/** Full-size URL of a local image: no thumbnail flag, ISBN covers in the large size. */
export function fullSizeSrc(src) {
  let value = String(src || '');
  value = value.replace(/([?&])thumb=1(&|$)/, (_, lead, tail) => (tail ? lead : '')).replace(/[?&]$/, '');
  if (/^\/api\/cover\?/.test(value)) value = value.replace(/([?&])size=[SM]\b/, '$1size=L');
  return value;
}

/** Cover image URL shown by a proposal button, or null when it has none (placeholder only). */
export function proposalCoverSrc(button) {
  const image = button?.querySelector?.('.cover img');
  if (!image || (image.complete && image.naturalWidth <= 1)) return null;
  return fullSizeSrc(image.getAttribute('src'));
}

/** Markup of the listing photo: a button that opens the zoom, plus an empty comparison slot. */
export function reviewPhotoMarkup({ photoMarkup, caption, escapeHtml }) {
  return `<figure class="rv-photo"><button type="button" class="rv-photo-zoom" data-photo-zoom aria-label="Powiększ zdjęcie z ogłoszenia">${photoMarkup}</button><div class="rv-compare" hidden></div><figcaption>${escapeHtml(caption)}</figcaption></figure>`;
}

/**
 * Shows the listing photo next to the chosen proposal's cover (same height) or, with no cover,
 * the photo alone again.
 */
export function showCoverComparison(figure, coverSrc, { title = '' } = {}) {
  if (!figure) return;
  const compare = figure.querySelector('.rv-compare');
  const photo = figure.querySelector('.rv-photo-zoom img');
  if (!compare) return;
  if (!coverSrc || !photo) {
    compare.hidden = true;
    compare.replaceChildren();
    figure.classList.remove('is-comparing');
    return;
  }
  const item = (src, label, zoom) => {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'rv-compare-item';
    cell.dataset.photoZoom = zoom;
    cell.setAttribute('aria-label', 'Powiększ: ' + label);
    const image = document.createElement('img');
    image.src = src;
    image.alt = '';
    image.decoding = 'async';
    const name = document.createElement('small');
    name.textContent = label;
    cell.append(image, name);
    return cell;
  };
  const cover = item(coverSrc, title ? 'Okładka: ' + title : 'Okładka propozycji', coverSrc);
  // /api/cover answers "no cover" with a 1×1 image: then there is nothing to compare.
  const coverImage = cover.querySelector('img');
  const drop = () => {
    if (compare.contains(cover)) showCoverComparison(figure, null);
  };
  coverImage.addEventListener('load', () => coverImage.naturalWidth <= 1 && drop());
  coverImage.addEventListener('error', drop);
  compare.replaceChildren(item(photo.getAttribute('src'), 'Zdjęcie z ogłoszenia', ''), cover);
  compare.hidden = false;
  figure.classList.add('is-comparing');
}

/** One dialog for every zoom; clicking the image or Esc closes it. Installed once. */
export function installPhotoZoom(root = document) {
  let dialog = null;
  const open = (src) => {
    if (!dialog) {
      dialog = document.createElement('dialog');
      dialog.className = 'photo-zoom';
      dialog.setAttribute('aria-label', 'Powiększone zdjęcie');
      dialog.innerHTML =
        '<img alt=""><button type="button" class="button secondary compact photo-zoom-close">Zamknij <kbd>Esc</kbd></button>';
      dialog.addEventListener('click', () => dialog.close());
      document.body.append(dialog);
    }
    dialog.querySelector('img').src = src;
    dialog.showModal();
  };
  root.addEventListener('click', (event) => {
    const trigger = event.target.closest?.('[data-photo-zoom]');
    if (!trigger || !trigger.closest('.rv-photo')) return;
    const own = trigger.dataset.photoZoom;
    const image = trigger.closest('.rv-photo').querySelector('.rv-photo-zoom img');
    const src = own || (image ? fullSizeSrc(image.getAttribute('src')) : '');
    if (src) open(src);
  });
}
