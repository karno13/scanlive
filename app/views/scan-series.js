import { MAX_SCAN_QUERIES } from '../core/scan-limits.js';

// Main novels in publication order; companions and short stories are separate.
// Polish titles: https://ebookpoint.pl/serie/swiat-dysku
export const DISCWORLD_TITLES = [
  'Kolor magii', 'Blask fantastyczny', 'Równoumagicznienie', 'Mort',
  'Czarodzicielstwo', 'Trzy wiedźmy', 'Piramidy', 'Straż! Straż!', 'Eryk',
  'Ruchome obrazki', 'Kosiarz', 'Wyprawa czarownic', 'Pomniejsze bóstwa',
  'Panowie i damy', 'Zbrojni', 'Muzyka duszy', 'Ciekawe czasy', 'Maskarada',
  'Na glinianych nogach', 'Wiedźmikołaj', 'Bogowie, honor, Ankh-Morpork',
  'Ostatni kontynent', 'Carpe Jugulum', 'Piąty elefant', 'Prawda',
  'Złodziej czasu', 'Ostatni bohater', 'Zadziwiający Maurycy i jego edukowane gryzonie',
  'Straż nocna', 'Wolni Ciutludzie', 'Potworny regiment', 'Kapelusz pełen nieba',
  'Piekło pocztowe', 'Łups!', 'Zimistrz', 'Świat finansjery',
  'Niewidoczni Akademicy', 'W północ się odzieję', 'Niuch', 'Para w ruch', 'Pasterska korona',
];

// Polish numbered volumes 1–48, including confirmed forthcoming titles.
// Sources checked 2026-11-14: https://copcorp.pl/tag-produktu/herezja-horusa/
// https://copcorp.pl/produkt/stara-ziemia/ and https://copcorp.pl/w-produkcji/
export const HORUS_HERESY_TITLES = [
  'Wywyższenie Horusa', 'Fałszywi bogowie', 'Galaktyka w płomieniach',
  'Ucieczka Eisensteina', 'Fulgrim', 'Zstąpienie Aniołów', 'Legion',
  'Bitwa o Otchłań', 'Mechanicum', 'Z dziejów herezji', 'Upadłe Anioły',
  'Tysiąc Synów', 'Nemezis', 'Pierwszy Heretyk', 'Prospero w płomieniach',
  'Era Mroku', 'Potępieńcy', 'Wybawienie utracone', 'I nie poznają co to strach',
  'Prymarchowie', 'Krocząc w strachu', 'Cienie zdrady', 'Anioł Exterminatus',
  'Zdrajca', 'Piętno Calth', 'Vulkan żyje', 'Niezapamiętane Imperium', 'Szramy',
  'Mściwy Duch', 'Przekleństwo Pythosa', 'Spuścizna zdrady', 'Ogień Śmierci',
  'Wojna bez końca', 'Pharos', 'Oko Terry', 'Ścieżka Niebios', 'Cicha wojna',
  'Anioły z Calibana', 'Pretorianin Dorna', 'Corax', 'Władca Ludzkości',
  'Garro', 'Rozbite Legiony', 'Karmazynowy Król', 'Tallarn',
  'Niszczycielski Sztorm', 'Stara Ziemia', 'Brzemię lojalności',
];

// The 17 main Gotrek & Felix books, without the separate Age of Sigmar cycle.
// https://encyklopediafantastyki.pl/index.php?title=Przygody_Gotreka_i_Felixa
// Publisher spelling: https://copcorp.pl/produkt/zabojca-zombi/
export const GOTREK_FELIX_TITLES = [
  'Zabójca trolli', 'Zabójca skavenów', 'Zabójca demonów', 'Zabójca smoków',
  'Zabójca bestii', 'Zabójca wampirów', 'Zabójca gigantów', 'Zabójca orków',
  'Zabójca ludzi', 'Zabójca elfów', 'Zabójca szamanów', 'Zabójca zombi',
  'Droga czaszek', 'Miasto potępionych', 'Królowa węży', 'Zabójca krasnoludów', 'Zabójca',
];

/** Only series and title lists explicitly agreed with the user belong here. */
export function scanSeriesOptions() {
  return [
    { id: 'discworld', name: 'Świat Dysku', titles: [...DISCWORLD_TITLES] },
    {
      id: 'horus-heresy', name: 'Herezja Horusa', titles: [...HORUS_HERESY_TITLES],
      scope: 'Polskie tytuły tomów 1–48, w tym zapowiedzi: Stara Ziemia i Brzemię lojalności.',
    },
    { id: 'gotrek-felix', name: 'Gotrek i Felix', titles: [...GOTREK_FELIX_TITLES], scope: '17 głównych tomów Przygód Gotreka i Felixa.' },
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
