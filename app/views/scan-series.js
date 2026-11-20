import { MAX_SCAN_QUERIES } from '../core/scan-limits.js';
import { DISCWORLD_PHRASES, GOTREK_FELIX_PHRASES, HORUS_HERESY_PHRASES, universeSeriesOptions } from './scan-series-titles.js';

export { DISCWORLD_PHRASES, DISCWORLD_TITLES, GOTREK_FELIX_TITLES, HORUS_HERESY_TITLES } from './scan-series-titles.js';

/** Only series and title lists explicitly agreed with the user belong here. */
export function scanSeriesOptions() {
  return [
    { id: 'discworld', name: 'Świat Dysku', titles: [...DISCWORLD_PHRASES] },
    {
      id: 'horus-heresy', name: 'Herezja Horusa', titles: [...HORUS_HERESY_PHRASES],
      scope: 'Polskie tytuły tomów 1–48, w tym zapowiedzi: Stara Ziemia i Brzemię lojalności.',
    },
    { id: 'gotrek-felix', name: 'Gotrek i Felix', titles: [...GOTREK_FELIX_PHRASES], scope: '17 głównych tomów Przygód Gotreka i Felixa.' },
    ...universeSeriesOptions(),
  ];
}

export function installScanSeries({ $, toast }) {
  const picker = $('#scanSeries');
  const input = $('#queries');
  const note = $('#scanSeriesNote');
  const options = scanSeriesOptions();
  function optionNode(label, value) {
    const node = document.createElement('option');
    node.textContent = label;
    node.value = value;
    return node;
  }
  function render() {
    const selected = picker.value;
    picker.replaceChildren(optionNode('Wybierz serię…', ''));
    for (const option of options) picker.add(optionNode(`${option.name} (${option.titles.length} tytułów)`, option.id));
    picker.value = selected;
  }
  function apply() {
    const series = options.find((option) => option.id === picker.value);
    if (!series) return;
    if (series.titles.length > MAX_SCAN_QUERIES) {
      toast(`Seria ma ${series.titles.length} tytułów. Limit skanu to ${MAX_SCAN_QUERIES}; wybierz mniejszy cykl.`);
      return;
    }
    input.value = series.titles.join('\n');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    note.textContent = `Wstawiono ${series.titles.length} tytułów: ${series.name}. ${series.scope ? series.scope + ' ' : ''}Możesz je edytować przed skanem.`;
  }
  render();
  picker.addEventListener('change', apply);
}
