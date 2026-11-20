// Title lists for "Szukaj po serii" (app/views/scan-series.js): single series and, since 2026-11-17,
// whole universes, one phrase per Polish title (lists agreed with the owner). In the universe lists
// a title that is a common word on its own ("Ojczyzna", "Upadek", "Smoki") carries the author's
// surname or the universe name: the phrase report showed that bare single words pull in hundreds of
// unrelated listings ("Zabójca": 720 offers, 63 identified). Sources of the universe lists: the
// publisher's catalogue (copcorp.pl, Warhammer books in print, read 2026-11-17), pl.wikipedia.org
// "Dragonlance", "Forgotten Realms" and "Warhammer 40,000" (titles published in Poland), and titles
// identified by ISBN in the catalogue (older Czarna Biblioteka books).

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

// Warhammer 40 000 without the Horus Heresy, which has its own list.
export const WARHAMMER_40K_TITLES = [
  // Duchy Gaunta (Dan Abnett)
  'Pierwszy i jedyny z Tanith', 'Komisarz Gaunt', 'Nekropolia Abnett', 'Gwardia Honorowa Abnett',
  'Karabiny Tanith', 'Czyste Srebro Abnett', 'Męczeństwo Sabbat', 'Zdradziecki Generał',
  'Ostatni Rozkaz Abnett', 'Pancerz Pogardy', 'Tylko śmierć Abnett', 'Krwawy Pakt Abnett',
  'Stacja Ocalenie', 'Mistrz Wojny Abnett', 'Anarch Abnett',
  // Prymarchowie
  'Alpharius Głowa Hydry', 'Angron Niewolnik z Nucerii', 'Corax Władca Cieni',
  'Ferrus Manus Gorgon z Meduzy', 'Fulgrim Feniks Palatyński', 'Jaghatai Khan Sokół z Chogoris',
  'Konrad Curze Nocny Upiór', 'Leman Russ Wielki Wilk', 'Lion El’Jonson Władca Pierwszego',
  'Lorgar Głosiciel Słowa', 'Magnus Czerwony Władca Prospero', 'Perturabo Młot Olympii',
  'Roboute Guilliman Władca Ultramaru', 'Vulkan Władca Smoków',
  // Ognisty Brzask
  'Brama z Kości', 'Czas Wilka Warhammer', 'Grobowiec męczennicy', 'Mściwy Syn', 'Świetlisty Tron',
  'Żelazne Królestwo Warhammer',
  // Mroczne Imperium (Guy Haley)
  'Mroczne Imperium Warhammer', 'Boska Śnieć', 'Wojna z Zarazą',
  // Eisenhorn (Dan Abnett)
  'Eisenhorn', 'Xenos Abnett', 'Malleus Abnett', 'Hereticus Abnett',
  // Kosmiczny Wilk
  'Kosmiczny Wilk', 'Szpon Ragnara', 'Szary Łowca', 'Wilcze Ostrza', 'Synowie Fenrisa', 'Honor Wilka',
  // Bitwy Kosmicznych Marines
  'Świat Rynn', 'Hellsreach', 'Polowanie na Voldoriusa', 'Oczyszczenie Kadillusa', 'Upadek Damnosa',
  'Bitwa o Kieł',
  // Pozostałe
  'Indomitus', 'Krieg Warhammer', 'Lewiatan Warhammer', 'Lion Syn Puszczy', 'Nieskończony i Boski',
  'Piętno Wiary', 'Zavant',
];

// Warhammer Fantasy, The End Times and Age of Sigmar.
export const WARHAMMER_FANTASY_TITLES = [
  // Przygody Gotreka i Felixa (the agreed list without the bare word "Zabójca") and Gotrek in Age of Sigmar
  ...GOTREK_FELIX_TITLES.filter((title) => title !== 'Zabójca'),
  'Zabójca Dusz', 'Zabójca Ghuli', 'Zabójca Pentaków', 'Zabójca Szkodników', 'Zabójca Zarazy',
  // Kroniki Malusa Mroczne Ostrze
  'Klątwa Demona', 'Krwawy Sztorm', 'Żniwiarz Dusz', 'Spaczony Miecz', 'Władca Zniszczenia',
  // Czasy Końca
  'Klątwa Khaina', 'Pan Końca Czasów', 'Powrót Nagasha', 'Świt Rogatego Szczura', 'Upadek Altdorfu',
  // Thanquol i Rozpruwacz Kości, Wampirzyca Ulrika, Archaon
  'Świątynia Węża', 'Szary prorok', 'Zagłada Thanquola',
  'Zrodzona we krwi', 'Zaprzysiężona we krwi', 'Zahartowana we krwi',
  'Archaon Władca Chaosu', 'Archaon Wszechwybraniec',
  // Łowcy
  'Krwawa forsa', 'Mathias Thulmann', 'Zabójca czarownic', 'Łowca czarownic Werner',
  // Age of Sigmar
  'Czarna Piramida', 'Ogród Plagi', 'Callis i Toll', 'Dominium Warhammer', 'Przeklęte Miasto',
  'Syn Bogożercy', 'W blasku Złego Księżyca', 'Wojny Dusz Warhammer',
  // Starsze wydania (Czarna Biblioteka), rozpoznane po ISBN w katalogu
  'Krew Gileada', 'Rota Abnett', 'Wino snów', 'Zaragoz', 'Szczurołap', 'Serce chaosu Thorpe',
  'Piętno potępienia', 'Posłaniec śmierci Warhammer', 'Czarnoksiężnik Drachenfels', 'Wieczna Genevieve',
  'Bóg Imperator McNeill', 'Jeźdźcy wilków Warhammer', 'Czerwone pragnienie', 'Śmiech mrocznych bogów',
];

// Novels published in Poland (ISA, Mag, Rebis); untranslated volumes are left out.
export const FORGOTTEN_REALMS_TITLES = [
  // Legenda Drizzta i pozostałe R. A. Salvatore
  'Ojczyzna Salvatore', 'Wygnanie Salvatore', 'Nowy dom Salvatore', 'Kryształowy relikt',
  'Strumienie srebra', 'Klejnot halflinga', 'Dziedzictwo Salvatore', 'Bezgwiezdna noc',
  'Mroczne oblężenie', 'Droga do świtu', 'Bezgłośna klinga', 'Grzbiet świata', 'Morze mieczy',
  'Tysiąc orków', 'Samotny drow', 'Dwa miecze Salvatore', 'Król orków',
  'Sługa reliktu', 'Obietnica króla-czarnoksiężnika', 'Droga patriarchy',
  'Kantyczka', 'Mroki puszczy', 'Nocne maski', 'Zdobyta forteca', 'Klątwa chaosu',
  // Elaine Cunningham
  'Córka mrocznego elfa', 'Splątane sieci', 'Torujący drogi', 'Cień elfa', 'Pieśń elfa',
  'Srebrne cienie', 'Twierdza cierni', 'Kule snów', 'Ogar magów', 'Brama wody Cunningham',
  'Wojna magów', 'Evermeet',
  // Powrót Arcymagów, Wojna Pajęczej Królowej
  'Wezwanie Denning', 'Oblężenie Denning', 'Zaklinacz Denning',
  'Upadek Byers', 'Powstanie Reid', 'Potępienie Baker', 'Zagłada Smedman', 'Unicestwienie Athans',
  'Zmartwychwstanie Kemp',
  // Ed Greenwood, Cykl Awatarów, Saga Cormyru
  'Magiczny ogień', 'Korona ognia', 'Cienista dolina', 'Tantras', 'Waterdeep', 'Książę kłamstw',
  'Cormyr', 'Poza Wysoką Drogą', 'Śmierć smoka Denning',
  // Inne cykle
  'Wzbierająca fala', 'Pod spadającymi gwiazdami', 'Oko morskiego diabła',
  'Alabastrowa laska', 'Czarny bukiet', 'Tajemnice Sztormowego Dworu', 'Świadek cienia',
  'Strzaskana maska', 'Lazurowe więzy', 'Ostroga wywerna', 'Pieśń sauriali',
  'Szafirowy półksiężyc', 'Rubinowa strażniczka', 'Oko Helma', 'Wężowa dłoń',
  'Wrota Baldura', 'Cienie Amnu', 'Tron Bhaala',
  // Antologie
  'Krainy cienia', 'Krainy chwały', 'Krainy głębin', 'Krainy magii', 'Krainy Podmroku',
  'Krainy tajemnic', 'Krainy niesławy', 'Krainy wtajemniczeń',
  // Pojedyncze powieści
  'Maskarady Novak', 'Nocny orszak', 'Opuszczony dom Baker', 'Pierścień zimy', 'Sadzawka blasku',
  'Morze piasków Denning', 'Zawoalowany smok',
];

// Novels published in Poland (Zysk i S-ka, ISA, Amber and others).
export const DRAGONLANCE_TITLES = [
  // Kroniki, Zaginione kroniki, Legendy, Drugie pokolenie, Wojna Dusz
  'Smoki jesiennego zmierzchu', 'Smoki zimowej nocy', 'Smoki wiosennego świtu',
  'Smoki letniego płomienia', 'Smoki krasnoludzkich podziemi',
  'Czas bliźniaków', 'Wojna bliźniaków', 'Próba bliźniaków', 'Drugie pokolenie Dragonlance',
  'Smoki upadłego słońca', 'Smoki zagubionej gwiazdy', 'Smoki zaginionego księżyca',
  // Zaginione Opowieści
  'Kagonesti', 'Irdowie', 'Dargonesti', 'Kraina minotaurów', 'Krasnoludy żlebowe', 'Smoki Dragonlance',
  // Bohaterowie
  'Legenda o Humie', 'Ostrze burzy Dragonlance', 'Szczęście łasicy', 'Minotaur Kaz',
  'Wrota Thorbardinu', 'Rycerz Galen',
  // Kroniki Raistlina, elfich narodów, króla-kapłana, Brygada Kanga
  'Kuźnia dusz Weis', 'Towarzysze broni Dragonlance', 'Pierworodny Dragonlance',
  'Wybraniec bogów Dragonlance', 'Brygada śmierci Dragonlance', 'Drakońskie metody',
  // Opowieści, Spotkania, Smoki Nowej Ery
  'Magia Krynnu', 'Bratnie dusze Dragonlance', 'Gorączka podróży', 'Mroczne serce Dragonlance',
  'Świt Nowej Ery', 'Dzień burzy Dragonlance', 'Zmierzch chaosu',
  // Mroczny Uczeń, Obrońcy magii, Trylogia Ergoth
  'Bursztyn i popiół', 'Bursztyn i żelazo', 'Bursztyn i krew',
  'Noc Oka', 'Plaga Meduzy', 'Siódmy Strażnik', 'Wyprawa wojownika',
  // Pojedyncze powieści
  'Smoki chaosu', 'Mroczna studnia Dragonlance', 'Raistlin i rycerz z Solamni', 'Dalamar Mroczny',
  'Mord w Tarsis',
];

// Titles that are common words on their own carry the author or the universe name, so the scan
// keeps only listings that name both (phrase report on saved results, 2026-11-20, offers / identified:
// "Eryk" 354 / 0, "Piramidy" 176 / 1, "Maskarada" 173 / 2, "Mort" 92 / 0, "Ruchome obrazki" 93 / 1,
// "Legion" 577 / 184, "Zdrajca" 402 / 93, "Nemezis" 199 / 14, "Zabójca" 671 / 40). Titles that
// identify well alone ("Kolor magii" 11 / 11) stay bare, so listings without the author still count;
// so do "Kosiarz" and "Muzyka duszy": their few hits are real Pratchett copies whose title lacks him.
// Most "identified" hits of the others were other books ("Zabójca z sąsiedztwa", Morgan's "Upadłe anioły").
const DISCWORLD_WITH_AUTHOR = {
  Mort: 'Mort Pratchett',
  Piramidy: 'Piramidy Pratchett',
  'Straż! Straż!': 'Straż! Straż! Pratchett',
  Eryk: 'Eryk Pratchett',
  'Ruchome obrazki': 'Ruchome obrazki Pratchett',
  'Ciekawe czasy': 'Ciekawe czasy Pratchett',
  Maskarada: 'Maskarada Pratchett',
  'Na glinianych nogach': 'Na glinianych nogach Pratchett',
};
const HORUS_HERESY_WITH_AUTHOR = {
  Legion: 'Legion Abnett',
  'Upadłe Anioły': 'Upadłe Anioły Warhammer',
  Nemezis: 'Nemezis Swallow',
  Potępieńcy: 'Potępieńcy McNeill',
  Zdrajca: 'Zdrajca Dembski-Bowden',
  Szramy: 'Szramy Wraight',
  'Ogień Śmierci': 'Ogień Śmierci Warhammer',
  'Stara Ziemia': 'Stara Ziemia Warhammer',
};
const GOTREK_FELIX_WITH_NAME = { Zabójca: 'Zabójca Gotrek' };
const phrases = (titles, map) => titles.map((title) => map[title] ?? title);
/** Scan phrases for the single-series lists: the titles, common words with the author. */
export const DISCWORLD_PHRASES = phrases(DISCWORLD_TITLES, DISCWORLD_WITH_AUTHOR);
export const HORUS_HERESY_PHRASES = phrases(HORUS_HERESY_TITLES, HORUS_HERESY_WITH_AUTHOR);
export const GOTREK_FELIX_PHRASES = phrases(GOTREK_FELIX_TITLES, GOTREK_FELIX_WITH_NAME);

/** Every Warhammer list in one scan: the Horus Heresy, 40 000, Fantasy and Age of Sigmar. */
export const WARHAMMER_ALL_TITLES = [
  ...new Set([
    ...HORUS_HERESY_PHRASES,
    ...WARHAMMER_40K_TITLES,
    ...WARHAMMER_FANTASY_TITLES,
  ]),
];

export function universeSeriesOptions() {
  return [
    {
      id: 'warhammer-all', name: 'Warhammer — wszystko', titles: [...WARHAMMER_ALL_TITLES],
      scope: 'Herezja Horusa, Warhammer 40 000, Fantasy i Age of Sigmar razem.',
    },
    {
      id: 'warhammer-40k', name: 'Warhammer 40 000', titles: [...WARHAMMER_40K_TITLES],
      scope: 'Bez Herezji Horusa (osobna lista): Duchy Gaunta, Prymarchowie, Ognisty Brzask, Eisenhorn, Kosmiczny Wilk i inne.',
    },
    {
      id: 'warhammer-fantasy', name: 'Warhammer Fantasy i Age of Sigmar', titles: [...WARHAMMER_FANTASY_TITLES],
      scope: 'Gotrek i Felix, Malus, Czasy Końca, Ulrika, Thanquol, Age of Sigmar i starsze tomy Czarnej Biblioteki.',
    },
    {
      id: 'forgotten-realms', name: 'Forgotten Realms', titles: [...FORGOTTEN_REALMS_TITLES],
      scope: 'Powieści wydane po polsku, w tym cała Legenda Drizzta do „Króla orków”.',
    },
    {
      id: 'dragonlance', name: 'Dragonlance', titles: [...DRAGONLANCE_TITLES],
      scope: 'Powieści wydane po polsku.',
    },
  ];
}
