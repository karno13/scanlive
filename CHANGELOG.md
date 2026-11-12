# Changelog

BookFlip uses small pull requests and GitHub Actions on Ubuntu/Windows to track changes.

## 2026-11-12 (55) — Skaner: Allegro i OLX bez błędów, więcej ofert z potwierdzoną dostępnością

- **Allegro i OLX:** stały stan „brak legalnego dostępu do wyszukiwania ofert” (powody w `docs/SOURCES-ACCESS-2026-11.md`). Są szare, nie czerwone; nie wchodzą do liczników „Źródła 4/5” na „Dziś”, do „źródeł z błędami” ostatniego skanu ani do formularza skanu; skan, harmonogram i szybki skan ich nie pytają (do tej pory każdy skan wysyłał do nich jedno zapytanie, które kończyło się CAPTCHA albo 403).
- **Dedalus.pl** zwraca CAPTCHA (od 11.11, 10:12; 4 oferty w bazie). CAPTCHA nie jest omijana. Bazowy odstęp zapytań wzrósł z 2 s do 6 s, źródło zostaje w stanie „nie działa” z powodem i samo wraca, gdy serwis przestanie blokować. Opis w dokumencie o dostępie do źródeł.
- **Potwierdzona dostępność ofert** (stan inny niż „niepotwierdzona” i „nie było w skanie”), pomiar na kopii bazy, 2660 ofert: **10,8% → 24,8%** (288 → 660).
  - Dlaczego było tak mało: `offer-lifecycle` sprawdzał tylko Vinted i tylko oferty, które zniknęły ze skanów. Oferty wciąż widoczne w wynikach nigdy nie były sprawdzane na własnej stronie, a Empik, Tezeusz i Allegro Lokalnie nie były sprawdzane wcale.
  - Empik i Dedalus podają dostępność w samej liście wyników (`IN_24_H`, `PRE_SALE`, `InStock`): 319 ofert potwierdzone bez żadnego zapytania (10,8% → 22,8%), z datą ostatniego widzenia.
  - Strony produktów Tezeusza (JSON-LD), Empiku (`product:availability`) i Allegro Lokalnie (microdata) są teraz czytane przez bramkę (`readSourceHtml`, bez żadnego nowego toru zapytań): 20 ofert co 10 minut, najdroższe najpierw. Próbny przebieg na kopii: 56 stron, 52 aktywne, 3 sprzedane, 1 usunięta (22,8% → 24,8%); Allegro Lokalnie odpowiedziało CAPTCHA po 13 stronach, więc źródło jest odkładane na pół godziny. Pełne pokrycie to około 15 godzin pracy w tle (1818 ofert niepotwierdzonych, 120 stron na godzinę).
  - Błąd: ta sama oferta mogłaby trafić do jednego przebiegu dwa razy (zniknęła ze skanów i nie była sprawdzana) — zdublowany wpis jest pomijany.

## 2026-11-12 (54) — Katalog: braki wydań uzupełniane ze źródeł

Pomiar na kopii bazy (550 prawdziwych wydań, bez 93 „Wydań nieustalonych”, które z założenia nie mają wydawcy ani roku):

- **Kompletne wydania (wydawca i rok): 471 → 493 z 550, czyli 85,6% → 89,6%.** Bez wydawcy 76 → 57, bez roku 25 → 18. Cel 90% nie jest osiągnięty: pozostałe 57 to głównie starsze książki z Vinted, których nie ma w BN, Open Library ani e-ISBN.
- **Uzupełnianie braków** (`edition-gaps.mjs`, migracja **131**): zwykłe wyszukiwanie ISBN zatrzymuje się na pierwszym źródle, które zna ISBN (np. Open Library bez wydawcy), więc e-ISBN i Google Books (z kluczem) nigdy nie były pytane. Teraz co 10 minut po 6 wydań są pytane wprost, a oprócz tego brane są wydawca i rok ze strony produktu oferty z tym samym ISBN (Tezeusz, Allegro Lokalnie).
  - 78 wydań sprawdzonych, 24 uzupełnione (26 pól): e-ISBN 5 wydawców, strony sklepów 14 wydawców i 4 lata, Google Books 3 lata.
  - Tylko puste pola i nigdy wydanie ręczne (`manual`); wartość ze źródła przechodzi przez tę samą normalizację nazw wydawców, „n/a” i lata spoza 1400–bieżący+1 są odrzucane.
  - Odwracalne: „Uzupełniono dane wydań: N pól…” w „Ostatnich decyzjach” z przyciskiem „Cofnij”; pole zmienione w międzyczasie ręcznie zostaje. Wydanie bez wyniku jest pytane ponownie po 30 dniach, po błędzie sieci po dobie. Wyłączanie: `BOOKFLIP_EDITION_GAPS=0`.
- **Książki → „Braki”:** obok liczników dzieł i wydań są trzy odnośniki: „51 bez wydawcy”, „18 bez roku”, „93 wydanie nieustalone” (+ „89,6% kompletnych wydań”). Kliknięcie filtruje listę po stronie serwera (liczba na liście = liczba w odnośniku), „Pokaż wszystkie” czyści filtr. Pusty panel „Wybierz dzieło” w tej wersji już nie istnieje (lista zajmuje całą szerokość), więc braki są tam, gdzie wcześniej szukało się statusu.
- Lista dzieł pokazuje okładki z `/api/cover` w wariancie miniatury, a inicjały tylko wtedy, gdy obrazek się nie wczyta lub go nie ma — to było już tak (sprawdzone: 0 samych inicjałów w pierwszych 100 dziełach), bez zmian.

## 2026-11-12 (53) — Kolejka: mniej pięter nad listą

- **Układ Weryfikacji:** nad listą były trzy piętra nawigacji (258 px z 900 przy 1440×900, 376 px przy 390×844), teraz jest jeden wiersz zakładek rodzajów i jeden wiersz narzędzi: **160 px** (telefon: 290 px).
  - „Zaznacz wiele”, „Skróty”, „Filtry weryfikacji” i „Ostatnie decyzje” są w jednym menu „Więcej”;
  - zakładki „Wszystkie / Szybkie / Do dodania…” stoją w jednym wierszu z wyszukiwarką i ramką identyfikacji;
  - podpowiedź skrótów z paska zakładek jest tylko w menu („Skróty”).
- **Ramka identyfikacji w stanie bezczynnym** to jedna linia („Zakończono” albo „Zakończono · N błędów”) bez licznika decyzji. Liczba decyzji jest widoczna w dwóch miejscach: na aktywnej zakładce „Weryfikacja” i przy tytule widoku.
- **Tryb wsadowy:** karty są poziome i niższe (222 px zamiast 332 px), przy 1440×900 mieszczą się **dwa pełne rzędy** (było jeden).
- **Duplikaty:** obok „Połącz w jedno” jest „To różne książki”. Decyzja jest odwracalna („Cofnij” w komunikacie i w „Ostatnich decyzjach”, wiersz „Różne książki: A ≠ B”), a grupa przestaje być proponowana — także przez jednorazowe automatyczne łączenie przy starcie. Gdy do grupy dojdzie trzecie dzieło o tym samym kluczu, grupa wraca. Migracja **130** (`distinct_work_pairs`).
- Cele dotykowe poniżej 44 px przy 390 px: 0 (20 zrzutów, oba motywy), bez przepełnienia strony.

## 2026-11-11 (52) — Stanowisko decyzyjne 2: jedna kolejka i mniej decyzji

- **Kolejka** zastępuje w nawigacji „Do weryfikacji” i „Zestawy”. To jeden widok z zakładkami typów; na kopii danych:
  - Weryfikacja — 240;
  - Zestawy (niepotwierdzone) — 139, w tym 92 puste;
  - Podejrzane przypisania — 20;
  - Możliwe duplikaty — 5.
  Dawne ekrany są osadzone bez przepisywania; podejrzane przypisania i duplikaty przeszły z „Narzędzi katalogu” do kolejki. Skróty są wspólne: ↑/↓ (J/K) wybór, Enter akcja, X odrzuć, S pomiń.
- **Tryb wsadowy** w „Szybkie” i „Do dodania”: siatka kart „zdjęcie oferty obok okładki propozycji” (albo danych nowego wydania). Wszystkie karty są zaznaczone; odznaczasz wyjątki i zatwierdzasz resztę jednym Enterem.
  - Każda oferta dostaje własną decyzję w historii.
  - Partia jest zapisana razem (migracja 129). Cofa się ją przyciskiem w powiadomieniu albo „Cofnij całą partię” w „Ostatnich decyzjach”.
  - Na kopii danych siatka „Szybkie” ma 31 z 40 ofert (4 niejednoznaczne zostają do decyzji pojedynczo). „Do dodania” ma 55 ze 113 decyzji z kompletnym formularzem z lubimyczytac.pl.
- Pomiar „Szybkie” (40 ofert, kopia danych):
  - pojedynczo — ok. 4,7 akcji na ofertę (126 akcji na 27 ofert);
  - dawne okno „Zatwierdź pewne…” — 2 kliknięcia i 17 ręcznych zaznaczeń, a lista brała też oferty spoza zakładki;
  - teraz **2 akcje (zakładka, Enter) rozstrzygają 31 ofert**; całą zakładkę zamyka 17 akcji.
  - Okno „Zatwierdź pewne…” zastąpiła siatka.
- **Reguły odrzucania.** „Więcej” → „Odrzuć z regułą…” (klawisz R) odrzuca ofertę. Opcjonalnie zapisuje „odrzucaj takie zawsze”: od tego sprzedawcy, z frazą w tytule (bez różnicy wielkości liter i polskich znaków), droższe albo tańsze niż próg.
  - Reguła od razu odrzuca pasujące oferty z kolejki i działa po każdym przebiegu identyfikacji.
  - Każde jej odrzucenie to osobny wiersz decyzji (`created_by = rejection_rule:<id>`), widoczny i odwracalny w „Ostatnich decyzjach”.
  - Ręczne przypisania i zestawy zawsze wygrywają. Oferty, której odrzucenie cofnięto, reguła już nie rusza.
  - Reguły z liczbą odrzuceń są w Ustawieniach i dają się usunąć. Tabela `rejection_rules`, migracja 129.
- **Zestawy:** „Nie interesuje mnie” (✕ przy wierszu albo X) bez otwierania szczegółów. Zestaw trafia do zakładki „Nie interesują mnie”, skąd „Przywróć” go cofa. Pakiet za 10 000 zł i dwa obcojęzyczne wydania za 2999 zł znikają z góry listy jednym kliknięciem każdy.
- **Błąd (z etapu 0):** wspólna pamięć zapytań przyspieszyła drugie rysowanie szczegółów oferty. Podgląd ISBN z pierwszego rysowania blokował wtedy drugi: „Zatwierdź” był aktywny, a Enter nic nie robił. Szczegóły rysują się teraz raz, po pobraniu oferty, a nieaktualne rysowanie nie zmienia stanu. Wykryte pomiarem kliknięć na kopii danych.
- 677 testów (10 nowych: partie „Szybkie” i „Do dodania” z cofaniem całości, dopasowanie i działanie reguł z pierwszeństwem ręcznych decyzji, „Nie interesuje mnie”, liczniki kolejki, wspólne skróty, treść żądań partii, okno reguły, okablowanie). Testy układu zaktualizowano świadomie: jedna pozycja „Kolejka” zamiast dwóch, nowa pozycja w „Więcej”. Lint, typecheck, format:check i browser-smoke (każdy widok i zakładka kolejki, oba motywy) przechodzą. Zrzuty Kolejki (Szybkie, Do dodania, Zestawy, Podejrzane przypisania, Duplikaty), okna reguły i Ustawień przy 1440×900 i 390×844 w obu motywach: bez poziomego przewijania i celów dotykowych poniżej 44 px.

## 2026-11-11 (51) — Stanowisko decyzyjne 1: ekran „Dziś” i aktualizacje na żywo

- Nowy ekran startowy **Dziś**. Pokazuje:
  - nowe oferty i zmiany cen od ostatniej wizyty (przy pierwszej wizycie w przeglądarce — z ostatniego skanu);
  - decyzje w kolejce;
  - stan źródeł;
  - ostatni i następny skan.
  Każdy kafel otwiera listę z tymi samymi filtrami co licznik. Na kopii danych: 17 nowych w ostatnim skanie, 4 zmiany cen, 240 decyzji (284 oferty), źródła 4/7, następny skan jutro 08:16. Kafel „Nowe oferty” otwiera Oferty z 17 pozycjami i znacznikiem „Nowe w skanie 11.11, 20:10 ✕”. Na dole jest zwinięty „Stan katalogu” (dawniej w Skanerze).
- Stan źródeł bez rozwijania. Niedziałające są na górze i wyróżnione, z datą pierwszej nieudanej próby po ostatnim sukcesie i powodem: „Dedalus.pl — nie działa od dziś 09:30 — serwis żąda CAPTCHA”, „Allegro — nigdy nie zadziałał (próby od 1.11) — CAPTCHA”, „OLX — nigdy nie zadziałał — HTTP 403”. Kliknięcie źródła otwiera jego oferty (`GET /api/source-status`, `source-status.mjs`).
- Formularz skanu to osobny widok **Skan** (w palecie i przycisk „Nowy skan” na ekranie Dziś). Panel „Nowe z ostatniego skanu” powtarzał kartę ostatniego skanu i został usunięty; zastępują go kafle Dziś.
- Oba liczniki czasu w przeglądarce (co 4 s stan katalogu, co 3 s skan) i samoodpytywanie przebiegu skanu (co 1,5 s) zastąpił jeden kanał zdarzeń z serwera (`GET /api/events`, server-sent events). Zdarzenia: zmiana skanu, kolejki i źródła.
  - Serwer sprawdza odciski co 2 s tylko wtedy, gdy ktoś słucha, i wysyła zdarzenie wyłącznie przy zmianie.
  - Bezczynny ekran wysyłał dotąd 15 zapytań na minutę, teraz żadnego.
  - Po zerwaniu połączenia strona łączy się ponownie i pobiera cały stan od nowa.
  - Przycisk „Odśwież” zniknął z nagłówka.
- **Błąd:** licznik „Do weryfikacji” w nawigacji pokazywał 0, dopóki nie otwarto kolejki. Bierze się teraz ze stanu katalogu od pierwszej chwili.
- Start aplikacji (ekran Dziś): **9 zapytań API, 7,7 KB** (przed etapem 0: 19 zapytań, 840 KB; po etapie 0, start na Skanerze: 11 zapytań, 146 KB). Lista skanów (`/api/scan-runs`, 123 KB) wczytuje się dopiero w Skanie, Ofertach i Weryfikacji.
- Rozpoznanie dostępu do Allegro i OLX: `docs/SOURCES-ACCESS-2026-11.md`. Allegro nie udostępnia wyszukiwania ofert w publicznym API (`GET /offers/listing` jest poza publicznym API). OLX Partner API służy do własnych ogłoszeń. Legalnej drogi do skanowania nie ma; nic nie zmieniono w kodzie.
- 667 testów (8 nowych: stan źródeł, podsumowanie Dziś i zgodność licznika z listą, kafle, kanał zdarzeń, odporność na błędną sondę, klient SSE, zamknięcie serwera z otwartym strumieniem, brak liczników czasu). Testy starego układu zaktualizowano świadomie:
  - start na Dziś zamiast na Skanie;
  - siedem widoków;
  - brak podglądu ofert w Skanie;
  - brak „Odśwież” i `setInterval`.
  Lint, typecheck, format:check i browser-smoke (siedem widoków, kontrast w obu motywach) przechodzą. Zrzuty Dziś, Skanu i przefiltrowanych Ofert przy 1440×900 i 390×844 w obu motywach: bez poziomego przewijania, bez celów dotykowych poniżej 44 px.

## 2026-11-11 (50) — Stanowisko decyzyjne 0: lżejsze obrazy i pliki, mniej zapytań, krótszy pasek weryfikacji

- Miniatury (okładki do 56 px) prosi się o mniejszy wariant z serwisu (`/api/image?…&thumb=1`, `/api/cover?…&thumb=1`). Sprawdzone na adresach z kopii bazy: Allegro `original` 2,96 MB → `s180` 12,9 KB, Tezeusz `product_show` ~115 KB → `product_thumb` ~12 KB. Vinted (adres podpisany, inny rozmiar daje 404), Dedalus (inne rozmiary przekierowują na zaślepkę) i Empik (~10 KB) zostają przy oryginale; wariant, który nie istnieje, wraca do oryginału. Pobieranie idzie tą samą drogą i tym samym cache co dotąd. Przejście przez sześć widoków na kopii danych: obrazy **42,0 MB → 5,8 MB**; reszta to zdjęcia Vinted i pełne zdjęcia w szczegółach.
- Pliki aplikacji: gzip i `ETag` z odpowiedzią 304 (`Cache-Control: no-cache` — zmiana pliku jest widoczna po zwykłym odświeżeniu). Start: **683 KB → 205 KB**; ponowne wczytanie strony: **683 KB → 11 KB** (42 odpowiedzi 304).
- Dane widoków wczytują się przy pierwszym wejściu w widok, nie przy starcie; liczniki w nawigacji dalej biorą się ze stanu katalogu. Start na Skanerze: **19 → 11 zapytań API, 840 KB → 146 KB** (bez listy dzieł 485 KB, kolejki, ofert i historii). Narzędzia katalogu pobierają dane po wejściu w Katalog.
- **Błąd:** jedno kliknięcie w weryfikacji wysyłało dwa razy `local-candidates` i `offer-edition`/`proposals` (szczegóły rysują się dwa razy). Teraz raz. Przy wyłączonym trybie handlu nie idą `/api/trading-defaults` ani `/api/offer-scenarios/*` (szuflada oferty, zestaw, Ustawienia).
- Paleta (Ctrl+K) bez trafień proponuje „Skanuj «fraza»”, „Szukaj w ofertach”, „Szukaj w katalogu”, a dla ciągu wyglądającego na ISBN — „Dodaj książkę przez ISBN”.
- Weryfikacja: jedna akcja główna (Zatwierdź albo Utwórz wydanie i przypisz), obok Odrzuć i Pomiń; Zestaw, Dodaj do katalogu, Tryb skupienia i „Ta książka, wydanie nieustalone” są w menu „Więcej”. Pasek ma jeden wiersz zamiast dwóch; skróty (Enter, X, S, Z, N, F) działają jak dotąd. Kliknięcie zdjęcia ogłoszenia powiększa je; gdy wybrana propozycja ma okładkę, zdjęcie i okładka stoją obok siebie w tej samej wysokości.
- Oferty: tytuły zwykłym kolorem tekstu (wiersz i tytuł dalej klikalne, podkreślenie przy najechaniu), „Wymaga decyzji” stonowane — kolor ostrzeżenia zostaje dla błędów i ponowień. Z nagłówka zniknął stały licznik „… ofert · … odrzuconych”.
- 660 testów (16 nowych: miniatury i powrót do oryginału, gzip/ETag/304, paleta, leniwe dane widoków, pasek i menu weryfikacji, zdjęcie). Lint, typecheck, format:check, browser-smoke przechodzą. Zrzuty Weryfikacji, Ofert i Skanera przy 1440×900 i 390×844 w obu motywach: bez poziomego przewijania, bez celów dotykowych poniżej 44 px (`node scripts/ux-shots.mjs`). Pomiary: `node scripts/measure-network.mjs`, wyniki w artifacts/network.

## 2026-11-11 (49) — UX 7: główna akcja pod ręką, jedna nazwa stanu, telefon

- **Błąd:** przy ofercie z ISBN nieznanym źródłom przypięty „Zatwierdź” był wyszarzony, a „Utwórz wydanie i przypisz” leżał poniżej zgięcia przewijanego obszaru (widać 445 z 779 px treści); Enter nic nie robił. Przypięty przycisk przejmuje teraz akcję przypadku — Enter tworzy wydanie z wypełnionego formularza. Gdy zatwierdzić się nie da, pod przyciskami stoi jedno zdanie, czego brakuje.
- Propozycje różniące się wyłącznie numerem ISBN mają to napisane i wyróżniony ISBN; tytuł propozycji zajmuje najwyżej dwa wiersze. Z listy weryfikacji zniknęło powtarzane w każdym wierszu „Wymaga decyzji”, z listy zestawów czerwone „pusty” (92 ze 144 zestawów) — kolor zostaje dla wyjątków.
- Oferty: jedna kolumna „Stan” (W katalogu / Wymaga decyzji / Odrzucona / identyfikacja w toku) zamiast pustej „Identyfikacji”. Ta sama nazwa w tabeli, na telefonie (było „Do sprawdzenia”) i w szufladzie. Ceny wyrównane do prawej. Szuflada: wartości tuż przy etykietach, bez powtórzonej ceny.
- **Błąd:** na telefonie podpis zdjęcia zestawu łamał się w kolumnie 72 px (ramka 72×237 px), a przypięte akcje zajmowały 130 px i zasłaniały skład. Zdjęcie stoi obok tytułu, odnośnik do ogłoszenia jest jeden, akcje nie są przypięte.
- Telefon: Ustawienia są w dolnym pasku (bez okna „Więcej”), przełącznik Lista / Okładki / Serie mieści się w jednym wierszu, profile skanu przewijają się w poziomie, cele dotykowe mają co najmniej 44 px.
- Narzędzia weryfikacji (Skróty, Filtry, Ostatnie decyzje) wyglądają jak sąsiednie przyciski. Ciche przyciski („Szukaj brakujących”, „Zestaw”, „Dodaj do katalogu”…) mają obramowanie. Tytuły ogłoszeń są krojem interfejsu, tytuły katalogowe szeryfem. Ceny dzieła z jednym wariantem nie powtarzają tej samej liczby w trzech tabelach; pusty kafelek sprzedaży Vinted nie jest wyróżniony.
- **Błąd:** „3 zadań z problemami” → „3 zadania z problemami” (odmiana według liczby). Przywrócono polskie znaki we wpisach 38–42 tego pliku.
- 644 testy przeszły (4 nowe: stan przypiętego przycisku, jedna nazwa stanu, wiersze bez powtórzeń, odmiana „zadań”), także lint, typecheck, format:check i browser-smoke z kontrastem w obu motywach. Na kopii danych Enter przy „Bran Mak Morn” utworzył wydanie: 237 → 236 decyzji, 281 → 278 ofert. Brak poziomego przewijania przy 390 px; wszystkie sześć widoków telefonu bez celów dotykowych poniżej 44 px.

## 2026-11-11 (48) — UX 6: czytelność i wspólne narzędzia

- Metadane mają wspólną skalę 13 px zamiast 11–12 px. Nadal widać 6 pozycji weryfikacji, 14 ofert i 9 dzieł przy 1440×900. Nagłówek łączy nazwę i stan; lista weryfikacji zaczyna się teraz na 218 zamiast 250 px.
- Telefon: Odśwież jest ikoną z etykietą dostępności, sześć czytelnych pozycji dolnej nawigacji obejmuje Zestawy. Odnośniki ogłoszeń mają pole co najmniej 44 px. Brak poziomego przewijania strony przy 390 px w obu motywach.
- Neutralny przełącznik polskich wydań; statystyki fraz mają maks. 480 px wysokości i przyklejone nagłówki. Selektory ustawień: 902,2 → 260 px; zwinięta karta zaawansowana: 101,5 → 82 px.
- 640 testów przeszło; test tokenów motywu i browser-smoke z kontrastem również. Każdy punkt ma osobne zrzuty wszystkich sześciu widoków w obu motywach: artifacts/ux-review/stage6-1 do stage6-5. Kontrola ścieżek obejmuje dodatkowo 1920×1080 i 1100×900. Szczegóły: docs/UX-REVIEW-2026-11.md.
- **Błąd:** widoczne przyciski wydań czekały na zakończenie pobierania serii. Obsługa kliknięcia jest teraz gotowa przed pobraniem danych pomocniczych; browser-smoke sprawdza ten przypadek ze sztucznym opóźnieniem.


## 2026-11-11 (47) — UX 5: zwarty katalog i schowane narzędzia

- 1440×900: 9 dzieł zamiast 5; zwykły wiersz 70 zamiast 143 px. Zwarta gęstość zmniejsza odstępy i okładki. Domyślna plakietka „Zweryfikowane” znika z listy; pozostają braki i wyjątki.
- Telefon: początek listy 538 → 330 px. Po wybraniu książki statystyki i narzędzia ustępują szczegółom i powrotowi. Narzędzia są pod jednym przyciskiem z licznikiem podejrzanych przypisań (20); filtry pozostają osobno.
- Zachowano układy Okładki i Serie. 639 testów przeszło. Pomiary i zrzuty: artifacts/ux-review/stage5.


## 2026-11-11 (46) — UX 4: tabela ofert na komputerze

- Przyczyną ukrycia tabeli były dwie bezwarunkowe reguły .offers-table-wrap { display: none }, wymuszające układ kart również na desktopie. Od 901 px wraca istniejąca tabela z sortowaniem w nagłówkach, a karty pozostają na telefonie.
- 1440×900: 14 pełnych ofert zamiast około 7, wiersz 37 zamiast 89 px, 50 zamiast 25 ofert na stronie (50 zamiast 100 stron). Źródło i status są przy wyszukiwaniu. Domyślne stany identyfikacji nie mają ostrzeżeń; szuflada ma mniejszą okładkę i cenę przy tytule.
- browser-smoke klika teraz przycisk oferty w tabeli desktopowej. 639 testów przeszło; pomiary i oba motywy: artifacts/ux-review/stage4.


## 2026-11-11 (45) — UX 3: zestawy w dwóch przewijanych panelach

- 1440×900: wysokość strony 13990 → 900 px; wiersz składu 151 → 58 px; przy 9 książkach widać 7 zamiast 3. Lista i szczegóły przewijają się osobno, wybrana pozycja pozostaje w widoku.
- Zdjęcie przeniesiono do nagłówka, zachowując naturalne proporcje. Skład zajmuje pełną szerokość panelu, ISBN nie łamie się w środku. Mobilny przepływ lista → szczegóły pozostaje.
- 639 testów przeszło, w tym testy zestawów i niezapisanych zmian; zrzuty w obu motywach: artifacts/ux-review/stage3.


## 2026-11-11 (44) — UX 2: wspólna liczba decyzji

- Przed zmianą: 281 ofert w nawigacji, 237 decyzji w nagłówku, 506 zadań w pasku identyfikacji i katalogu. 506 zawierało 225 referencji Empiku; 281 ofert łączy się w 237 decyzji ISBN. To różne zbiory, błędnie opisane tą samą etykietą.
- Wspólne obliczenie kolejki ręcznej daje 237 decyzji / 281 ofert. Nawigacja, katalog, pasek identyfikacji i przycisk skanera pokazują decyzje. Statystyki zadań pozostają w szczegółach, z osobnymi nazwami. Pominięte pozycje nadal są nierozstrzygnięte i należą do globalnego licznika.
- Rozszerzono review-queue-paging.test.mjs o licznik decyzji; review-error-handling.test.mjs sprawdza teraz wspólną kolejkę zamiast starego licznika zadań. Zrzuty: artifacts/ux-review/stage2.


## 2026-11-11 (43) — UX 1: decyzje zawsze pod ręką

- Kopia danych: 2493 oferty. Przy 1440×900 lista zaczyna się na 250 px zamiast 374 px; widać 6 pełnych pozycji zamiast 5. Dolna krawędź głównych akcji: 809 px zamiast 1105 px. Wysokość strony: 900 zamiast 1208 px.
- Telefon 390×844: zatwierdzenie na 677–721 px zamiast 1271–1315 px, nad dolną nawigacją. Zostawiono miejsce pod treścią. Historia i filtry otwierają się nad obszarem roboczym.
- Pomiar i zrzuty w obu motywach: artifacts/ux-review/stage1. Test widoczności wykrył brak jawnego :not([hidden]); poprawiono selektor, zachowując test.

## 2026-11-11 (42) — Mobilna weryfikacja bez ściśniętych kolumn

- **Błąd:** po ukryciu skrótów klawiszowych reguła kontenera zostawiała czterokolumnową kartę propozycji, a tytuł trafiał do 40-pikselowej kolumny. Telefon ma teraz jawnie określone miejsca okładki, tekstu i oceny.
- **Błąd:** cztery akcje dzieliły jeden wąski rząd, łamiąc napisy na pionowe kolumny. Zatwierdzenie i wybór książki bez wydania mają pełne rzędy; odrzucenie i pominięcie są obok siebie. Stopka nie zasłania formularza podczas przewijania.
- Mniejsza fotografia, poziomo przewijane zakładki i pola z tekstem 16 px ograniczają przewijanie i powiększanie formularza na telefonie. Kolory pozostają zgodne z jasnym i ciemnym motywem.
- **Błąd:** zbyt niski kontrast opisu ISBN/proweniencji. Użyto czytelniejszego koloru tekstu pomocniczego.
- Browser smoke obejmuje kartę Durotana na szerokości 390 px w obu motywach: co najmniej 180 px dla tekstu, mniej niż 230 px dla głównych akcji i brak poziomego przepełnienia strony. Dane testowe są izolowane; baza użytkownika nie została zmieniona. Zrzuty wejściowe: screens/IMG_9195–9198.png.

## 2026-11-11 (41) — Opcjonalny autostart Windows (część etapu 4)

- Skrypt windows-autostart.ps1 udostępnia rejestrację i wyrejestrowanie zadania przy logowaniu właściciela oraz odczyt stanu. Serwer startuje bez widocznego okna, z logami w katalogu BookFlip użytkownika. Istniejący serwer jest sprawdzany przed startem.
- Nie zarejestrowano ani nie uruchomiono zadania w systemie. Sprawdzono składnię parserem PowerShell; rzeczywiste logowanie z zadaniem wymaga włączenia opcji przez właściciela. Ekran „Dziś” pozostaje do wykonania.
- Etap sygnału sprzedaży: 639 testów, lint i format:check przeszły.

## 2026-11-11 (40) — Budżet sprawdzeń statusu dla Vinted

- **Błąd:** okresowe sprawdzanie pobierało strony źródeł bez parsera statusu i zapisywało unknown. Budżet 8 sprawdzeń co 10 minut jest teraz przeznaczony na Vinted. Adaptery skanowania wszystkich źródeł pozostają bez zmian; żądania nadal przechodzą przez marketplace-gate.
- Świeża kopia: 739 sprawdzeń, 381 unknown (Empik 210, Allegro Lokalnie 122, Tezeusz 49), 358 rozstrzygniętych Vinted (299 dostępnych, 36 sprzedanych, 23 niedostępne). Rozstrzygnięte: **48,4% historycznie; 100% w historycznym podzbiorze Vinted**. To porównanie doboru próby, nie pomiar nowych żądań po wdrożeniu.
- **Błąd:** nieznany napis w panelu statusu Vinted był uznawany za ukrytą ofertę. Teraz pozostaje nierozstrzygnięty. Niepoprawny identyfikator produktu nie może potwierdzić sprzedaży.
- Raport cyklu rozróżnia nierozpoznaną stronę, blokadę, błąd przekierowania i pozostałe błędy transportu. Historyczna tabela nie przechowuje treści odpowiedzi; nie przypisujemy jej wstecz nieudokumentowanych przyczyn.
- Rozpoznanie etapu 2: 100 oczekujących ofert Vinted z nieznanym ISBN; 0 ręcznych decyzji Vinted jednoznacznie opisanych jako utworzenie wydania z ogłoszenia. Brak podstaw do potwierdzenia progu 98%, więc automat Vinted pozostaje niewłączony. Istniejący offer-editions.mjs już udostępnia wypełniony formularz z możliwością zatwierdzenia.

## 2026-11-11 (39) — Odwracalne przypisania Empiku do dzieła

- Pewne propozycje Empiku bez ISBN przypisujemy do dzieła przez wydanie „nieustalone”, nigdy do zgadywanego konkretnego wydania. Każda decyzja ma znacznik auto_empik_work_v1 i jest widoczna w „Ostatnich decyzjach”. Cofnięcie blokuje ponowne automatyczne przypisanie.
- Automat pomija wcześniejsze decyzje, aktywne przypisania, zestawy i tytuły rozpoznane jako zestawy. Uruchamia się po przebiegu identyfikacji.
- Świeża kopia bazy z 11.11: **94 przypisania**. Baza użytkownika nie była modyfikowana. Odczyt ISBN z dodatkowego API Empiku nadal nie jest wdrożony.

## 2026-11-11 (38) — Empik poza główną kolejką (część etapu 1)

- **Błąd:** ceny odniesienia Empiku zajmowały główną kolejkę identyfikacji. Oferty Empiku mają teraz osobną zakładkę „Empik — ceny odniesienia”; nie zwiększają licznika menu ani zakładki „Wszystkie”. Pozostają dostępne do ręcznego przeglądu. Sam podział nie zmienia przypisań i nie tworzy decyzji.
- Pomiar na kopii SQLite z 11.11: 506 zadań przed zmianą, 281 w głównej kolejce po zmianie (239 wierszy po grupowaniu ISBN); Empik w głównej kolejce **225 → 0**, wszystkie 225 w zakładce odniesienia. Katalog: 2588 ofert, 379 dzieł, 506 wydań.
- Pojedynczy odczyt strony produktu Empiku przez readSourceHtml nie dostarczył ISBN do istniejącego parsera. Nie wdrożono jeszcze odczytu dodatkowego API ani automatycznych przypisań. Pozostałe etapy zadania pozostają otwarte.
- Kontrole: 636 testów, lint, format:check i browser-smoke przeszły. Test regresji sprawdza zachowanie ofert w oddzielnej zakładce i licznik głównej kolejki.

## 2026-11-11 (37) — Skaner i czytelność

- **„Skuteczność fraz i profili skanu” na ekranie Skanera** — wiersz pod „Stanem katalogu”, rozwijany jak on. Była ukryta w Weryfikacji pod „Ponawianie i szczegóły wyników” (zmiana 31 błędnie podawała Ustawienia). Nowy opis mówi, do czego służy: które frazy i profile przynoszą książki warte uwagi — oferty, w katalogu, czeka na decyzję, bez ISBN, sprzedane w 14 dni, mediana sprzedanych, ponad 50 zł — i że porównanie profili rozstrzyga, czy zostać przy niszy. **Błąd:** lista fraz profilu w tej tabeli nie zawijała się i nachodziła na liczby.
- **Allegro i OLX pod „Niedostępne (2): Allegro, OLX”** zamiast obok działających źródeł. Na kopii danych z 2026-11-10 oba nigdy nie zadziałały (CAPTCHA, HTTP 403). Po rozwinięciu można je dalej zaznaczyć; dotyczy to każdego źródła, które nie działało w ostatnim skanie, i samo wraca, gdy źródło znów działa.
- **„14 zadań z problemami — wyniki mogą być niepełne” rozwija listę tych zadań:** dla każdego źródła powód i frazy, osobno frazy pominięte po blokadzie bez zapytania. Jeśli są chwilowe błędy, obok jest „Ponów chwilowe błędy (N)”; jeśli nie — wprost, że to blokady i ponowienie nic nie da. W ostatnim skanie wszystkie 14 to Allegro (CAPTCHA) i OLX (403): po 1 próbie i 6 pominiętych fraz na źródło, nic do ponowienia.
- **Daty w wierszach ofert:** „dziś 20:53”, „wczoraj”, „8.11” (z innego roku „8.11.2025”) zamiast „10.11.2026, 20:53:55”; pełna data jest w podpowiedzi. Lista i tabela Ofert oraz „Nowe z ostatniego skanu”.
- **Jeden nagłówek na widok.** Pod paskiem z nazwą widoku był drugi nagłówek: nadtytuł, ta sama nazwa i opis (ok. 150 px). Został pasek; z drugiego wiersza tylko przycisk albo licznik („Dodaj książkę”, „498 ofert w 457 decyzjach”, stan skanu). W Katalogu „Dodaj książkę” jest na końcu wiersza z liczbą dzieł.
- **Katalog:** lista dzieł przykleja się pod paskiem na pełną wysokość okna (było 100% − 230 px przy szczegółach wysokich na kilka tysięcy pikseli). **Błąd:** zdjęcie wydania na liście wydań w szczegółach dzieła rozciągało się do 286×429 px (na telefonie 121×182) — teraz miniatura 40×60. „Seria i tom” i „Uniwersum w widoku Serie” to po jednym wierszu z bieżącą wartością („Seria i tom: brak”, „Uniwersum: Forgotten Realms (automatycznie)”); formularz otwiera „Edytuj”.
- **Zestawy domyślnie od najdroższych** (na kopii danych: 142 zestawy, pierwszy za 10 000 zł); „Ostatnio zmienione” — dotychczasowa kolejność — do wyboru obok wyszukiwarki.

## 2026-11-11 (36) — Szybszy start

- **Start aplikacji: ok. 1,7 s → 1,0 s.** Mierzone na kopii danych z 2026-11-10 w przeglądarce (5 uruchomień, dwie serie, ten sam plik danych dla starej i nowej wersji): do chwili, gdy przestają iść zapytania, 1,62–1,80 s przed i 0,96–1,03 s po; ostatnia odpowiedź 2,5–2,8 s przed i 0,97–1,02 s po. Zapytań 80 → 73 (do API 39 → 32).
- **Skąd to czekanie.** Każde zapytanie osobno jest szybkie (1–76 ms; tylko „stan katalogu” 300 ms), ale przy starcie trywialny `/api/scan/status` (6 ms) czekał 970 ms. Serwer obsługuje zapytania po kolei — odczyt SQLite jest synchroniczny i zajmuje jedyny wątek — więc czas startu to suma pracy wszystkich zapytań (ok. 1,5 s), a nie najwolniejsze z nich. Dlatego pomaga tylko mniej pracy, nie więcej równoległości.
- **Usunięte powtórzenia:** „stan katalogu” (`/api/catalog/insights`, 300 ms) był liczony 3 razy — przy wczytaniu panelu, przy otwarciu Skanera i po odczycie statusu; teraz raz (drugie wywołanie w trakcie czeka na pierwsze, a kolejne w ciągu 3 s jest pomijane, chyba że to odświeżenie po uzupełnieniu zdjęć). Lista „Nowe z ostatniego skanu” była pobierana 3 razy, z czego 2 odpowiedzi szły do kosza, bo jeszcze nie było wiadomo, który skan jest ostatni; teraz raz, po wczytaniu przebiegów skanu. Profile skanu były pobierane osobno dla listy profili i dla „Automatyczny skan”; teraz harmonogram dostaje listę od profili. Zniknęły przez to też 2 z 3 zapytań o uzupełnianie zdjęć.
- **Do decyzji (bez zmian):** przy starcie przeglądarka i tak pobiera ok. 13 MB, prawie wyłącznie zdjęcia Allegro Lokalnie w pełnym rozmiarze (adresy `…/original/…`, po 0,1–3 MB) jako miniatury na liście nowych ofert. Pomniejszona wersja z CDN Allegro skróciłaby to kilkukrotnie, ale oznacza nowe pobrania z Allegro dla każdej oferty, więc tego nie zmieniałem.

## 2026-11-11 (35) — Kolory tylko w zmiennych; test kontrastu w obu motywach

- **Motyw ciemny to wyłącznie inne wartości zmiennych.** W `app/app.css` było 239 deklaracji z kolorem wpisanym wprost (125 różnych kolorów) przy 46 zmiennych, a motyw ciemny łatał to osobną regułą „stare białe tła” — każde nowe miejsce z białym tłem psuło się w trybie ciemnym (zmiana 33). Teraz żadna reguła nie wpisuje koloru: wszystkie kolory są zmiennymi (103), a bloki motywu ciemnego ustawiają tylko ich wartości. Zmienne, które nie mają wartości ciemnej, są takie same w obu motywach: tekst na zielonych przyciskach, ciemnozielony pasek boczny, kolory źródeł, zaślepki okładek, przyciemnienie pod oknami. Usunięte zostały też dwa martwe zestawy zmiennych z dawnych warstw (ich wartości i tak nadpisywał zestaw v5).
- **Motyw jasny bez zmian** — sprawdzone na kopii danych w 34 stanach (wszystkie widoki, rozwinięte panele, szczegóły dzieła, wydania, oferty, zestawu, zakładki weryfikacji, paleta poleceń, okno „Dodaj książkę”) przy szerokości 1440, 1000 i 390 px: obliczone kolory 135 761 elementów i pseudoelementów są identyczne przed i po; zrzuty ekranu różnią się tylko godziną w treści i wygładzaniem tekstu. Literały, które przy tym miały po kilka niemal identycznych odcieni (np. sześć teł po najechaniu od `#f2f6f3` do `#f7faf8`), dzielą jedną zmienną — wszystkie takie reguły były w tych stanach nadpisane przez późniejsze.
- W motywie ciemnym zmieniły się świadomie: cienie (szuflada oferty, dolny pasek na telefonie, okienko „Skróty”) są ciemne zamiast zielonkawych, a nagłówek listy dzieł i „Filtry…” w Katalogu mają szary kolor pomocniczy jak w motywie jasnym.
- **Błąd:** nagłówki tabeli źródeł w Skanerze („Źródło”, „Oferty”, „ISBN”…) miały w motywie jasnym kontrast 2,65:1; teraz 4,6:1. To jedyna zmiana wyglądu motywu jasnego, wyłapana przez nowy test poniżej.
- **Ochrona przed regresją.** `scripts/browser-smoke.mjs` przechodzi przez wszystkie widoki w obu motywach, na komputerze i telefonie, z rozwiniętymi panelami, i zgłasza każdy tekst, którego kontrast do faktycznego tła (z przezroczystościami) jest poniżej 3:1 — na arkuszu sprzed zmiany 33 zgłasza „Skróty” w weryfikacji (2,49:1). Szybki test `theme-tokens.test.mjs` (w `npm test`) pilnuje, żeby żadna reguła nie wpisywała koloru i żeby motyw ciemny zmieniał tylko zmienne.

## 2026-11-11 (34) — Weryfikacja: pomiar pewnych propozycji, „wydanie nieustalone” jednym klawiszem, lista stronicowana

- **Pomiar: czy „pewna propozycja” może zatwierdzać się sama — nie.** Na kopii danych z 2026-11-10 policzone z `review_decisions` i `title_proposals` (propozycja zapisana przed decyzją): 92 ręczne decyzje dotyczyły ofert z pewną propozycją. Wszystkie 92 to zatwierdzenia **tej samej książki** (0 odrzuceń, 0 innych książek), ale tylko **59 (64%) zatwierdzało dokładnie proponowane wydanie (ISBN)**. W 33 przypadkach wybrane było inne wydanie tej książki: 16 razy inne wydanie z katalogu (np. „Fulgrim: wizje zdrady” 2013 zamiast proponowanego 2021, „Kolor magii” 2010 zamiast 2008), 17 razy „wydanie nieustalone”. Przy propozycjach o wyniku ≥ 95% jest tak samo: 52 z 80 (65%). Próg 98% nie jest spełniony, więc **automatyczne zatwierdzanie nie zostało włączone**. Co by pomogło: (1) automat na poziomie książki zamiast wydania — „ta książka, wydanie nieustalone” zgadzałoby się z decyzją w 92 na 92 przypadkach (100% przy tak małej próbie; warto poczekać na ok. 300 decyzji); (2) wybór wydania z ogłoszenia (rok, wydawca, oprawa w tytule) przed porównaniem z propozycją BN — dziś propozycja to najczęściej najnowsze wydanie z BN, a ogłoszenie dotyczy starszego; (3) zapisywanie w `review_decisions`, jaka propozycja była pokazana — dziś trzeba to odtwarzać z `title_proposals`, a przeliczona propozycja nadpisuje poprzednią.
- **„Ta książka, wydanie nieustalone” jednym klawiszem: N** (przycisk obok „Zatwierdź”, opis w „Skróty”). Na przykład „Sojusznicy”: propozycje 2015 i 2011 różnią się tylko rokiem — N przypisuje ofertę do książki bez wybierania wydania. Działa na propozycji wybranej klawiszem 1–9 (albo wstępnie zaznaczonej); bez wyboru tylko wtedy, gdy wszystkie propozycje mają ten sam tytuł — inaczej pierwsza propozycja bywa inną książką cyklu („Zabójca Ghuli” przy ofercie „Zabójca Trolli”), więc N tylko o tym informuje. Propozycja z BN, której książki nie ma jeszcze w katalogu, jest najpierw dodawana do katalogu po ISBN (jak „Dodaj książkę”). Mechanizm wydania nieustalonego jest ten sam co w zmianie 25: gdy ogłoszenie wskazuje wydanie (rok, wydawca, oprawa), oferta trafia do niego i komunikat o tym mówi. Jedna decyzja w „Ostatnich decyzjach”, do cofnięcia jak każda.
- **Panel „Automatyczna identyfikacja” w spoczynku to jedna linia** (46 px zamiast ok. 100): tytuł, stan („Zakończono · 498 do decyzji · 0 błędów”), mały przycisk „Uruchom ponownie” i „Szczegóły i ponawianie”, które rozwija pełny panel pod linią. Na telefonie dwie linie. W trakcie identyfikacji panel jest pełny jak dotąd.
- **Lista weryfikacji stronicowana na serwerze.** Wcześniej przy wejściu pobierana była cała kolejka (500 pozycji w dwóch zapytaniach, 613 kB), a pokazywane 100; na telefonie lista miała ok. 10 400 px. Teraz jedno zapytanie po 50 decyzji (65 kB na kopii danych), kolejne strony przyciskiem „Pokaż kolejne · widać 50 z 457” na końcu listy, przewinięciem albo klawiszem ↓ z ostatniej pozycji (↑ wraca). Na telefonie lista ma 4 900 px. Serwer scala oferty z tym samym ISBN w jedną decyzję (×N), liczy rozmiary grup według frazy w całej przefiltrowanej kolejce i układa grupę jak dotąd: najpierw „jest w katalogu”, potem pewne, możliwe i słabe propozycje. Po decyzji odświeżany jest ten sam zakres, więc następna oferta jest ta pod rozstrzygniętą.
- **„Pominięte” (klawisz S) są zapisane w bazie** zamiast w przeglądarce — inaczej nie dałoby się ich pominąć na serwerze; przy okazji widać je też na telefonie. Lista pominiętych z przeglądarki przenosi się sama przy pierwszym wejściu. Liczniki zakładek też je pomijają.
- **Błąd:** w szczegółach oferty „1 z 50” liczyło tylko wczytane pozycje; teraz „1 z 457”.

## 2026-11-11 (33) — Poprawki po przeglądzie: motyw ciemny, liczniki, okładki

- **Błąd:** w motywie ciemnym część elementów miała białe tło i jasny tekst. Sprawdzone skryptem, który w każdym widoku (także z rozwiniętymi panelami, szczegółami książki, oferty i zestawu, na szerokości komputera i telefonu) mierzy kontrast tekstu do faktycznego tła: 22 miejsca z kontrastem poniżej 3:1, wszystkie poprawione. Były to: kafelek cen książki w Katalogu (ceny niemal niewidoczne, kontrast 1,1:1), przyciski narzędzi Katalogu („Możliwe duplikaty dzieł”, „Podejrzane przypisania”, „Wydawcy i serie” — z całą zawartością, „Zasilanie katalogu…”, „Filtry…”), przycisk „Skróty” i jego okienko w weryfikacji, znacznik „×4” (oferty z tym samym ISBN) w liście weryfikacji, panel „Dodaj z opisu ogłoszenia albo zakres tomów” w Zestawach. Kolory tych elementów są teraz zmiennymi z wartością jasną identyczną jak dotąd — motyw jasny wygląda tak samo.
- **Błąd:** pod listą w Katalogu były dwa nieostylowane przyciski („Pokaż kolejne (wczytano 250 z 361)” i „Pokaż kolejne wczytane (100 z 250)”). Jest jeden, na końcu listy, wyglądający jak pozostałe przyciski: „Pokaż kolejne · widać 100 z 361”. Dokłada 100 dzieł, a gdy wczytane się skończą, sam pobiera kolejną stronę.
- **Błąd:** w Ofertach po przejściu z „Wg książki” na „Lista” nagłówek zostawał na „487 wydań”; teraz pokazuje „2457 pasujących ofert”.
- **Jedna liczba ofert.** Pasek górny pokazywał 2556 ofert (wszystkie w bazie, z odrzuconymi), menu 2457 (bez odrzuconych, ale liczone z listy Ofert z jej bieżącymi filtrami, więc po filtrowaniu zmieniało się w menu). Teraz oba pokazują oferty bez odrzuconych, liczone w bazie niezależnie od filtrów: pasek „2457 ofert · 99 odrzuconych”, menu „2457 zapisanych”, z rozbiciem w podpowiedzi. W weryfikacji „498 ofert · 457 decyzji” → „498 ofert w 457 decyzjach”: oferty z tym samym ISBN rozstrzyga jedna decyzja (znacznik „×N” przy ofercie).
- **Błąd:** okładki z Open Library dawały 404 w konsoli, a propozycje w weryfikacji pokazywały zaślepkę z literą. Przyczyna: Open Library nie ma okładek tych polskich wydań (sprawdzone wprost, np. 9788324156887, 9788324141432, 837418034X — 404). Nowa trasa `/api/cover?isbn=…`: najpierw zdjęcie zapisanej oferty tej książki (przypisanej do wydania z tym ISBN, sklepy przed serwisami ogłoszeniowymi, a potem dowolnej oferty, w której ogłoszeniu był ten ISBN), dopiero potem Open Library; gdy nic nie ma, przezroczysty obrazek zamiast błędu, a strona pokazuje zaślepkę. Na kopii danych z 2026-11-10: z 15 dzieł w Katalogu, które nie mają przypisanej oferty ze zdjęciem (dotąd tylko Open Library), 13 dostaje zdjęcie z ogłoszenia z tym ISBN; w kolejce weryfikacji 139 ze 142 ofert z ISBN ma zdjęcie oferty tej samej książki.

## 2026-11-10 (32) — Porządki techniczne

- **Kolejka weryfikacji: „Najdroższe najpierw”** — nowe sortowanie po cenie oferty malejąco (drogie oferty są najważniejsze przy odsprzedaży); przy obu sortowaniach po cenie oferty bez ceny są na końcu (wcześniej na początku).
- **Tabela tras.** Serwer ma jedną tabelę tras (63 trasy) zamiast łańcucha warunków, a trasy z `trading-api.mjs` — własną tabelę zamiast wyrażenia regularnego, które trzeba było uzupełniać przy każdej nowej ścieżce. Parametry ścieżki (`/api/sets/:offerId/editions/:editionId`) są dekodowane w jednym miejscu — ręczne dzielenie ścieżki spowodowało kiedyś błąd tras zestawów (zmiana 20).
- **Naprawy danych przy starcie raz, nie przy każdym uruchomieniu.** Cofnięcie błędnych odrzuceń z 8.11, odrzucanie kopii odrzuconych ofert, odrzucanie obcojęzycznych wydań i ujednolicanie wydawców wykonują się teraz jednorazowo (flaga w bazie; ujednolicanie wydawców jeszcze raz, gdy zmienią się reguły pisowni). Dalej robią to: zapis nowej oferty, decyzja „odrzuć” (kopie tej oferty czekające w weryfikacji są odrzucane od razu, a nie przy następnym starcie), każde przejście identyfikacji i włączenie „Tylko polskie wydania”. Przy każdym starcie zostały tylko: wczytanie uniwersów i wariantów nazw do pamięci oraz zastosowanie połączeń nazw serii (serie zapisują BN i ogłoszenia bez tej listy). Cykl i tom z tytułów ogłoszeń liczy już tylko zadanie co 10 minut. Na kopii danych z 2026-11-10 żadna z przeniesionych napraw nic nie zmieniła (0 zmian), a kolejne uruchomienie trwa 48 ms zamiast 120 ms.
- **Szybsze rozpoznawanie dzieła (migracja 128).** Klucz dzieła (tytuł główny + nazwisko autora, tytuł oryginalny) jest w indeksowanej tabeli; zmienione dzieła są przeliczane same (wyzwalacze), a po zmianie uniwersów — wszystkie. 300 wyszukań: 75 ms zamiast 1387 ms, z tym samym wynikiem.
- **Frazy ofert jako tabela (migracja 127)** zamiast przeszukiwania JSON w każdym zapytaniu: oznaczanie ofert, których pełny skan nie zwrócił, i statystyki fraz.
- **Jeden kształt oferty przy zapisie skanu** (`offer-ingest.mjs`, typ JSDoc `ScannedOffer`): title, price, image, isbn — bez równoległych nazw. Sprawdzanie typów bez budowania: `npm run typecheck` (TypeScript tylko jako narzędzie deweloperskie) dla ścieżki oferty i repozytorium.

## 2026-11-10 (31) — Pomiar nisz

- **Ustawienia → „Skuteczność zapytań i nisz”** ma tabelę profili skanu obok siebie: liczba ofert, mediana dostępnych, **odsetek sprzedanych w 14 dni**, **mediana ceny sprzedanych**, **liczba ofert powyżej 50 zł**. Te same trzy kolumny są przy każdej frazie i źródle. Ma to rozstrzygnąć po kilku tygodniach, czy zostać przy niszy, czy poszerzać zakres — wystarczy zapisać drugi profil (np. „Kryminał PRL”) i skanować oba.
- „Sprzedane w 14 dni” to oferty, których strona pokazała „Sprzedane” najpóźniej 14 dni po pierwszym wykryciu. Liczone tylko wśród ofert widzianych po raz pierwszy co najmniej 14 dni temu, żeby nowa fraza nie wypadała gorzej tylko dlatego, że jest nowa. Mediana w SQL, w groszach.
- Na danych z 2026-11-10: „Uniwersa” — 1209 ofert, mediana dostępnych 40 zł, 10 sprzedanych (mediana 104,50 zł), 491 powyżej 50 zł; „Autorzy i cykle” — 819 ofert, mediana 35 zł, 0 sprzedanych, 273 powyżej 50 zł. Odsetek sprzedanych w 14 dni pokaże się od ok. 15.11 — wszystkie oferty w bazie są młodsze niż 14 dni.

## 2026-11-10 (30) — Uniwersa w danych zamiast w kodzie

- **Uniwersa do edycji (migracja 126).** Katalog → „Wydawcy i serie” ma sekcję „Uniwersa”: nazwa, inne zapisy (np. „Discworld; Discworld series”), serie wydawnicze związane z uniwersum („Black Library; Czarna Biblioteka”) oraz cykle i postacie, które je wskazują („Herezja Horusa; Drizzt”). Można dodać uniwersum (np. „Wiedźmin; The Witcher”), poprawić je, zmienić mu nazwę albo je usunąć; jeden zapis może należeć tylko do jednego uniwersum. Zmiana obowiązuje od razu dla tytułów czytanych od teraz.
- Wcześniej nazwy uniwersów były wpisane osobno w 9 modułach, każdy z trochę inną listą. Teraz wszystkie listy powstają z jednej tabeli: usuwanie nazwy uniwersum z tytułu („World of Warcraft: Illidan” = „Illidan”), odróżnianie uniwersum od cyklu w serii z BN, uniwersum w widoku Serie, słowa pomijane przy porównywaniu tytułów i odrzuconych ofert, poszerzanie wyszukiwania („Świat Dysku” znajduje też „Discworld”). Dane początkowe to obecne wartości z kodu, połączone: Świat Dysku, Warcraft, Warhammer, Dragonlance, Forgotten Realms oraz Diablo, StarCraft i Star Wars (dotąd tylko na części list).
- Na danych z 2026-11-10 różnica względem dotychczasowych list: 19 z 2741 tytułów ma inny tytuł główny (np. „Diablo: Wojna grzechu…” → „Wojna grzechu…”, „Star Wars: Mroczny uczeń…” → „Mroczny uczeń…”, „Warhammer Age of Sigmar: Malign sorcery” → „Malign sorcery”), 49 tytułów dostało uniwersum w widoku Serie (głównie Diablo, Star Wars i „Zapomniane Krainy” → Forgotten Realms), a serie „Diablo” i „Star Wars” z BN są uniwersami zamiast cyklami. Istniejące dzieła nie są przy tym automatycznie łączone.

## 2026-11-10 (29) — Szybki skan najnowszych ofert

- **Drugi tryb skanu.** W „Automatyczny skan” jest nowa sekcja „Szybki skan najnowszych ofert” z własnym odstępem (1–24 h, domyślnie co 2 h), **domyślnie wyłączona**. Czyta jedną stronę wyników na frazę, posortowaną od najnowszych, tylko w źródłach, które pozwalają tak sortować — sprawdzone na żywej stronie: Vinted (`order=newest_first`; ok. 90 ogłoszeń na stronie). Używa tego samego profilu co pełny skan; gdy oba są do wykonania, pierwszeństwo ma pełny.
- **Nie oznacza ofert jako zniknięte** — nawet gdy fraza ma tylko jedną stronę wyników. Robi to wyłącznie pełny skan, który pozostaje bez zmian.
- Nowe oferty z szybkiego skanu są widoczne w pasku „Od ostatniej wizyty” jak każde nowe oferty (liczone po dacie pierwszego wykrycia).

## 2026-11-10 (28) — Ceny porównują porównywalne

- **Rodzaj oferty.** Każda oferta ma rodzaj wynikający ze źródła: nowa w sklepie (Empik, Dedalus, sklepy z Empik Marketplace), antykwariat (Tezeusz, antykwariaty sprzedające przez Empik), prywatny egzemplarz (Vinted, OLX, Allegro Lokalnie). Reguły są w jednym miejscu i działają tak samo w kodzie i w zapytaniach SQL. Na danych z 2026-11-10: 1936 prywatnych, 365 ze sklepów, 77 z antykwariatów. Oferty z Empiku zapisane przed zmianą 26 nie mają nazwy sprzedawcy, więc do najbliższego skanu liczą się jako sklepowe.
- **Ceny książki osobno dla każdego rodzaju i stanu.** Na stronie książki w Katalogu pierwszy kafelek to **„Sprzedane na Vinted”** (mediana, liczba sprzedaży, zakres) — cena odsprzedaży. Obok mediany dostępnych ofert osobno dla nowych w sklepie, antykwariatów i prywatnych egzemplarzy, a w tabeli także wg stanu egzemplarza (nowa / bardzo dobra / dobra / zadowalająca / nieznany). Wcześniej jedna mediana mieszała nową książkę z Empiku z używanym egzemplarzem z Vinted: na danych z 2026-11-10 67 książek ma dostępne oferty więcej niż jednego rodzaju, a w 22 z nich wspólna mediana różniła się od mediany prywatnych egzemplarzy o ponad 20%.
- **Statystyki cen liczone w SQL**, w groszach (mediana, najniższa, najwyższa, sprzedane). Zapis skanu nie ocenia już cen modułem historii (`price-analysis.mjs`) — skan zwraca zapisane oferty jednym zapytaniem. Model historii zostaje tylko dla eksportu „Historia ofert” i dawnych odpowiedzi API.

## 2026-11-10 (27) — Wiarygodny sygnał sprzedaży na Vinted

- **Historia stanów oferty (migracja 125).** Każdy zaobserwowany stan jest zapisywany z datą: pierwsze i ponowne pojawienie się w skanie, brak w pełnym skanie frazy, każde sprawdzenie strony ogłoszenia (dostępna / zarezerwowana / sprzedana / usunięta / nieczytelna). Dzięki temu sprzedaż ma przedział: „między ostatnim widzeniem a sprawdzeniem”. W szczegółach oferty sprzedanej: „Sprzedana między 3.11 a 5.11” oraz rozwijana „Historia stanów”. Z wcześniejszych danych odtworzone: 2378 pierwszych wykryć i 23 zmiany znalezione przy sprawdzaniu (10 sprzedanych, 11 usuniętych, 2 dostępne).
- **Drogie oferty sprawdzane wcześniej i częściej.** Oferta, której skan już nie zwraca, jest sprawdzana:
  - od 100 zł — po 12 h nieobecności, potem co 24 h;
  - 40–99,99 zł — po 24 h, potem co 48 h;
  - poniżej 40 zł — po 48 h, potem co 96 h (wcześniej wszystkie: po 2 dniach, co 3 dni).

  W kolejce najpierw najdroższe. Tempo bez zmian: 8 stron na 10 minut, przez wspólną bramkę źródła. Na danych z 2026-11-10 do sprawdzenia czeka 1902 ofert (wg starej reguły 1505), w tym 463 od 100 zł — te zostaną sprawdzone w pierwszych ok. 10 godzinach.
- **Ponowne wystawienia.** Nowa oferta tego samego sprzedawcy o tym samym tytule albo ISBN, która pojawia się po zniknięciu poprzedniej (brak w pełnym skanie albo strona usunięta), jest z nią powiązana. W szczegółach obu ofert widać „Wcześniej wystawiona jako… / Wystawiona ponownie jako…” z przyciskiem „To różne ogłoszenia”. Powiązanie jest w „Ostatnich decyzjach” jako „Ponowne wystawienie (automatycznie)” i można je tam rozłączyć; rozłączona para nie jest łączona ponownie. Nic nie jest przez nie odrzucane — oferta przechodzi identyfikację jak każda inna. Działa od teraz: sprzedawca jest zapisywany od zmiany 26, więc starszych ofert (360 ofert Vinted w 95 grupach o identycznym tytule) nie da się powiązać wstecz.

## 2026-11-10 (26) — Pełny zapis obserwacji oferty

- **Stan egzemplarza (migracja 124).** Każda oferta ma teraz zapisany stan tak, jak podało go źródło („Bardzo dobry”, „Nowy z metką”, „Ze śladami użytkowania”), i jego klasę: nowa / bardzo dobra / dobra / zadowalająca / nieznana. Vinted podaje stan na liście wyników, więc ma go każda nowa oferta; dla ofert Allegro Lokalnie i Tezeusza stan jest raz przepisany z odczytanych wcześniej stron ogłoszeń. Na danych z 2026-11-10: 329 ofert dostało stan (bardzo dobra 161, dobra 69, nowa 24, nieznana 75 — „Używana”, „Produkt kolekcjonerski”).
- **Opłata kupującego, sprzedawca, polubienia (Vinted).** Zapisywane z listy wyników: opłata za ochronę kupującego (np. 4,45 zł przy cenie 31,07 zł), identyfikator sprzedawcy i to, czy jest firmą, liczba polubień (aktualizowana przy każdym skanie).
- **Opis, liczba zdjęć i data wystawienia (Vinted) bez dodatkowych zapytań.** Skan i tak otwiera stronę każdej nowej oferty Vinted, żeby sprawdzić język. Teraz zapisuje z niej też opis, liczbę zdjęć, stan i wiek ogłoszenia („Dodane 3 godz.” → przybliżona data wystawienia). Opis trafia do opisów ogłoszeń, więc oferta oznaczona później jako zestaw nie jest pobierana drugi raz.
- **Empik: prawdziwa dostępność i sprzedawca.** Wcześniej każda oferta z Empiku była „dostępna”. Teraz liczy się stan z kafelka (wysyłka w 24 h, przedsprzedaż); niedostępny produkt nie jest zapisywany jako oferta. Zapisywany jest też sprzedawca: Empik albo sklep z Empik Marketplace (np. antykwariat) — przyda się do rozróżnienia nowych książek od używanych.
- **Surowe dane ogłoszenia.** Przy pierwszym zapisie i przy każdej zmianie (polubienia i wiek ogłoszenia się nie liczą) zapisywany jest obiekt oferty z listy wyników i ze strony ogłoszenia, do 16 KB — żeby po zniknięciu ogłoszenia dało się odczytać pola, których dziś nie przewidujemy.
- **Pominięte przed zapisem.** Panel „Przebieg skanu” pokazuje, ile ogłoszeń skan odrzucił i dlaczego: obcy język, brak podanego języka (Vinted), spoza tematu frazy, nie-książki. Liczby zapisują się w podsumowaniu skanu. Na przykładowej stronie Vinted „pratchett”: 66 zapisanych, 23 spoza tematu, 3 w obcym języku.
- **Szczegóły oferty** pokazują stan, opłatę kupującego, sprzedawcę, liczbę zdjęć, datę wystawienia, polubienia i dostępność w sklepie — tylko to, co źródło podało.
- **Czego źródła nie podają:** Vinted nie umieszcza na stronie kosztu dostawy (przeglądarka pobiera go osobno po załadowaniu strony) ani liczby wyświetleń; daty wystawienia nie podaje wprost, tylko „Dodane 3 godz.”. OLX i Allegro Lokalnie na liście wyników nie podają sprzedawcy.

## 2026-11-08 (25) — Książka zamiast wydania: dopasowanie, warianty cenowe, ceny całej książki

- **Ceny całej książki.** Strona dzieła w Katalogu pokazuje teraz ceny wszystkich ofert ze wszystkich wydań: medianę, najniższą, liczbę dostępnych i sprzedanych, wykres odczytów cen w czasie i tabelę wariantów cenowych (`GET /api/catalog/works/:id/prices`). Wcześniej przy 10 wydaniach ceny rozkładały się na 10 osobnych kart po 1–3 oferty.
- **Warianty cenowe (migracja 123).** Wydania o podobnej cenie są grupowane automatycznie: ten sam wydawca (warianty nazwy łączone: „Prószyński i S-ka” = „Prószyński Media”) i ta sama oprawa. Wydania zbiorcze, specjalne (kolekcjonerskie, ilustrowane, box) i obcojęzyczne są osobno; wydanie bez wpisanej oprawy nie dołącza do wydań w oprawie twardej ani miękkiej. Przy każdym wydaniu jest wybór „Wariant: → …” (inny wariant, osobny, z powrotem automatycznie), a „Popraw warianty” łączy dwa warianty. Na danych z 2026-11-08 „Blask fantastyczny” to 5 wariantów zamiast 10 wydań.
- **Dopasowanie do książki, wydanie opcjonalne.** Kandydaci z katalogu w weryfikacji to teraz książki, a nie poszczególne wydania. Wydanie jest wybierane tylko wtedy, gdy ogłoszenie je wskazuje: po ISBN, gdy książka ma jedno wydanie, albo gdy rok, oprawa lub wydawca z tytułu i opisu ogłoszenia pasują do dokładnie jednego wydania. W pozostałych przypadkach oferta trafia do „Wydanie nieustalone” tej książki. Wcześniej system zaznaczał „najczęściej używane” wydanie, czyli zgadywał. To samo dotyczy zbiorczego zatwierdzania, wyszukiwarki w weryfikacji („cała książka”) i zmiany przypisania w katalogu.
- **„Wydanie nieustalone”** to jedno zastępcze wydanie na książkę, ukryte na listach wydań i niewliczane do ich liczby. Na stronie książki pojawia się jako osobna pozycja z liczbą ofert; po jej otwarciu każda oferta ma wybór „Wskaż wydanie”. Ceny takich ofert liczą się do ceny całej książki, ale do mediany żadnego wariantu.

## 2026-11-08 (24) — Odrzucone nie wracają, zestawy z opisu, tylko polskie wydania, oferty wg książki

- **Odrzucone oferty nie wracają do puli.** Ta sama oferta zawsze zostawała odrzucona, ale ogłoszenie wystawione ponownie (nowy numer na Vinted, drugi adres produktu w Empiku) wracało jako nowa oferta. Nowa oferta o tym samym tytule w tym samym źródle albo o tym samym ISBN co oferta odrzucona ręcznie jest odrzucana od razu, z decyzją „Jak wcześniej odrzucona oferta: …” (do cofnięcia w „Ostatnie decyzje”). Tytuły krótkie albo złożone z samej nazwy uniwersum („World of Warcraft”) nie wystarczają. W Ofertach odrzucone mają status „Odrzucona” i domyślnie są ukryte (filtr: „Odrzucone”, „Wszystkie, także odrzucone”); nie ma ich w „Nowe z ostatniego skanu”.
- **Poprawka reguły powtórek:** pierwsza wersja (działająca krótko 8.11) gubiła litery spoza alfabetu łacińskiego i porównywała tytuły między źródłami, przez co odrzuciła 6 ofert (np. „World of Warcraft. Маг” jako powtórkę „Клятва на крови”). Przy starcie automatyczne odrzucenia, których poprawiona reguła nie potwierdza, wracają do identyfikacji (decyzja „Cofnięto automatyczne odrzucenie”).
- **Zestawy uzupełniają się z opisu ogłoszenia (migracja 120).** Opis ogłoszenia Vinted jest czytany w tle (4 zestawy co 3 min, wspólne tempo źródła), a pusty zestaw dostaje raz książki z katalogu, które opis wymienia („Blask fantastyczny / Trzy wiedźmy / Straż! Straż! …”). Skład zostaje „do potwierdzenia” z notką „dodane automatycznie z opisu — porównaj ze zdjęciem”; książek usuniętych przez operatora proces nie dodaje ponownie.
- **„Tylko polskie wydania”** — przełącznik pod źródłami w Skanerze, domyślnie włączony, zapisany w bazie (obowiązuje też skany automatyczne i z telefonu). Skan prosi źródła o polskie wydania, a wydanie rozpoznane później jako obcojęzyczne (kategoria Empiku, język oferty) jest odrzucane od razu zamiast czekać w „Gry / obce”. Na danych z 2026-11-08: 77 ofert opuszcza kolejkę; podręczniki do gier zostają.
- **Oferty „Wg książki”** — przełącznik „Lista / Wg książki”: jedna karta na wydanie (okładka, autor, wydawca, rok, ISBN, źródła, zakres cen, liczba ogłoszeń); karta rozwija ogłoszenia od najtańszego, ogłoszenie otwiera zwykły panel. Filtry listy działają w obu układach; oferty bez wydania są policzone pod kartami (`GET /api/offer-groups`).
- **Wspólne, adaptacyjne tempo źródeł:** każde zapytanie do serwisu (wyniki, strony ofert, opisy zestawów, sprawdzanie dostępności) przechodzi przez jedną bramkę na źródło. Odmowa (429, 403, CAPTCHA) podwaja odstęp dla źródła do 30 s, każda udana odpowiedź skraca go o 10% do wartości bazowej (2 s; Allegro Lokalnie 8 s) — nowe źródło nie wymaga osobnych ustawień.
- **Katalog → „Wydawcy i serie” (migracja 121):** wydawcy oraz serie wydawnicze i uniwersa z liczbą wydań; „Połącz z…” robi z nazwy wariant innej („Discworld series” → „Świat Dysku”, „Prószyński Media” → „Prószyński i S-ka”), przemianowuje wydania i obowiązuje dla wydań zapisanych później; warianty można usunąć. Filtr „Wydawca” podpowiada nazwy.
- **ISBN z lubimyczytac.pl (migracja 122):** dla ISBN, których nie znają BN, Open Library ani e-ISBN (nowe wydania Copernicusa), w tle szukany jest tytuł z ogłoszenia na lubimyczytac.pl; liczy się tylko strona książki z tym samym ISBN. Formularz „Utwórz wydanie z ogłoszenia” dostaje wtedy tytuł, autora, wydawcę, rok i odnośnik („Hereticus” — Copernicus Corporation 2009, cykl Eisenhorn t. 3), a utworzone wydanie także cykl i tom. Każdy ISBN sprawdzany raz w miesiącu.
- **Nowe źródła ofert:** sprawdzone pojedynczymi zapytaniami (Tania Książka — wyniki ładowane skryptem, Bonito — od razu 429, Skupszop i Świat Książki — inne adresy wyszukiwania). Żadne nie nadaje się do prostego adaptera bez dalszego rozpoznania; zostają osobnym zadaniem.

## 2026-11-08 (23) — Audyt: stan źródeł, propozycje, zestawy, wydawcy, poprawki interfejsu

- **Błąd (migracja 119):** źródło, w którym odpowiedziała tylko część fraz (Allegro Lokalnie: 61–130 ofert na skan, potem 429), nie zapisywało udanego odczytu i było pokazywane jako „nigdy nie zadziałał”, odznaczane i pomijane przez automatyczny skan. Ostatni udany odczyt jest odtworzony z zapisanych skanów. Samo HTTP 429 to stan „ogranicza tempo” (bursztynowy, źródło zostaje zaznaczone), a nie „nie działa”; Allegro Lokalnie dostaje 8 s odstępu między zapytaniami. Strona CAPTCHA podana jako 429 pozostaje blokadą.
- **Propozycje po tytule:** ogłoszenie z nazwiskiem innego autora z katalogu nie dostaje cudzej książki („Smoki jesiennego zmierzchu M. Weis, T. Hickman” ≠ „Smoki” Nilesa, „Zabójca smoków William King” ≠ „Zabójca” Guymera), a jednowyrazowy tytuł w długim ogłoszeniu bez autora nie jest proponowany. Na kolejce z 2026-11-08: 22 błędne propozycje mniej, żadnej trafnej utraconej.
- **Zestawy:** ogłoszenie z dwoma lub więcej tytułami z katalogu („Bezgłośna klinga, Grzbiet świata, Sługa reliktu”, „Fourth Wing i Iron Flame”) jest zestawem — nie dostaje automatycznie ISBN jednego tomu i trafia do zakładki „Zestawy?” (36 zamiast 1). Pomijane: nazwy cykli innego tytułu („Wojna starożytnych: Studnia wieczności”), tytuły będące nazwiskiem autora i odwołania („Autorka Fourth Wing”). 21 wcześniejszych automatycznych przypisań takich ogłoszeń wraca raz do weryfikacji — m.in. zestaw, którego zdjęcie było okładką „Alabastrowej laski”. Propozycja z ISBN wpisanego przez sprzedawcę ma etykietę „ISBN podany w ogłoszeniu”.
- **Wydawcy:** jedna pisownia na wydawcę („"ISA"”, „Isa”, „IAS” → ISA; „Zysk i S-ka. Wydaw” → Zysk i S-ka; „Wydawnictwo MAG” → Mag; Prószyński, Rebis, Insignis, Filia…), przy zapisie z BN, Open Library, e-ISBN i ogłoszeń oraz raz przy starcie (75 wariantów → 48). Wydania poprawione ręcznie zachowują swoją pisownię.
- **Licznik „Do weryfikacji”** w menu, na pasku skanera i w nagłówku pokazuje całą kolejkę, nie liczbę z otwartej zakładki (po „Inne” menu pokazywało „25 do decyzji” w całej aplikacji). Nagłówek: „475 ofert · 437 decyzji” / „36 z 475 ofert”.
- **Interfejs:** każda zakładka pamięta własne przewinięcie (Oferty nie otwierają się w połowie listy); pola „Skan” i „Zmiany w skanie” w filtrach ofert mają zwykłą wysokość; bez zdania „Brak nowych ofert od ostatniej wizyty” obok „Nowe z ostatniego skanu (35)”; oferta niesprawdzona na stronie ogłoszenia to „Widziana dziś / wczoraj / 2 dni temu”, nie „Aktywna”; „ostatnio działał dziś/wczoraj” liczone po dniach kalendarzowych; oznaczenia źródeł są kwadratami (czerwona kropka Empiku wyglądała jak „nie działa”), OLX ma własny kolor; Ustawienia opisują błędy źródeł po polsku zamiast `SOURCE_HTTP_429` i nie pokazują już „brak potwierdzenia działania” po wejściu prosto w Ustawienia.
- **Katalog:** liczby w jednej linii pod tytułem zamiast trzech kafelków, narzędzia (duplikaty, podejrzane przypisania, BN, filtry) w jednym rzędzie — lista zaczyna się na pierwszym ekranie; bez powtórzonej listy wydań nad szczegółami dzieła.

## 2026-11-08 (22) — Skaner: martwe źródła, jeden panel wyniku, profile jednym kliknięciem

- **Błąd:** niedziałające źródła nie były odznaczane, gdy poprzedni skan je zapisał (prawie zawsze). Teraz są odznaczone i pogrupowane pod „Nie działały w ostatnim skanie” z datą ostatniego udanego odczytu („ostatnio działał 3 dni temu” / „nigdy nie zadziałał”); wczytany profil też je pomija, z komunikatem.
- **Błąd:** „Ponów nieudane zadania” ponawiał blokady (CAPTCHA, 403) i zadania pominięte po blokadzie. Teraz „Ponów chwilowe błędy (N)” wysyła tylko 429, 5xx, timeouty i błędy połączenia; podsumowanie skanu zapisuje przy błędach `blocked` / `skipped` / `retryable`.
- **Automatyczny skan:** pomija źródła, które nie zadziałały w ostatnim skanie, przez dobę (potem próbuje raz, żeby mogły wrócić). Wynik „częściowo udany — błędy: …” zamiast „udany” przy każdej odpowiedzi HTTP 200. Stan (co ile, profil, następny skan, ostatni z błędami) widać w nagłówku sekcji bez jej rozwijania.
- **Jeden panel wyniku:** „Po skanie · co dalej?” jest stopką panelu „Przebieg skanu” — przyciski z liczbami („Nowe oferty (35)”, „Zmiany cen (8)”, „Do weryfikacji (455)”); usunięto zdublowane kafelki i przycisk „Oferty z tego skanu”. Centrum skanowania (zdarzenia, tempo) przeniesione do Ustawień i odpytywane tylko, gdy jest otwarte. Ten sam opis błędów źródeł w obu miejscach; pasek „Od ostatniej wizyty” nie powtarza już listy martwych źródeł.
- **Przed skanem:** linia planu „6 fraz × 3 źródła = 18 zapytań · ok. 4 min” (tempo z ostatniego skanu) z ostrzeżeniem o zaznaczonych martwych źródłach i przekroczonym limicie fraz.
- **Profile jednym kliknięciem:** przyciski profili nad frazami — nazwa wczytuje, ▶ wczytuje i skanuje; zapis/aktualizacja/usuwanie w „Zarządzaj profilami”. Frazy, które od 30 dni nie dały nowej oferty, są wskazane pod polem (`GET /api/scan-queries/freshness`).
- **Frazy tylko po wierszach:** przecinek nie dzieli już frazy („Ogniem i mieczem, tom 1”).
- **Lista po prawej:** „Nowe z ostatniego skanu” zamiast kopii zakładki Oferty (gdy skan nie dał nowych — najnowsze zapisane, z opisem).
- **Nowy wygląd zakładki:** jedna karta formularza zamiast kart w kartach; źródła jako przełączniki-pigułki z kropką stanu (zielona / bursztynowa / czerwona) i jedno zdanie o niedziałających zamiast notki pod każdym; stopka „18 zapytań · 6 fraz × 3 źródła” z przyciskiem „Skanuj”; profile i harmonogram jako cienkie wiersze z chevronem (harmonogram: „co 12 h · następny …” i znacznik „ostatni z błędami”); spokojniejszy nagłówek i linijka „od ostatniej wizyty”; lżejsza lista nowych ofert.
- Powiadomienie przeglądarki po skończonym skanie, gdy karta jest w tle; poprawione literówki („przed chwilą”, „wykonać”, „adapterów”); Centrum skanowania zna stan „Anulowany”.

## 2026-11-08 (21) — Przegląd UX: weryfikacja, katalog, serie, zestawy, skaner

- **Oferta:** w szczegółach osobno stan ogłoszenia (Aktywna / Mogła zniknąć / Sprzedana) i stan identyfikacji — „Zakończona” nie udaje już zamkniętego ogłoszenia. „Najnowsze” sortuje po pierwszym wykryciu; karty ofert pokazują datę wykrycia. Przycisk „Oznacz jako zestaw” w szczegółach oferty (z potwierdzeniem, gdy odłącza przypisanie).
- **Weryfikacja:** cała kolejka jest wczytywana (liczniki menu, nagłówka i zakładek się zgadzają). Gdy jedna książka z katalogu wyraźnie wygrywa, jej najczęściej używane wydanie jest zaznaczone — wystarczy `Enter`; przy remisie różnych książek ostrzeżenie. Gadżety i dodatki (dziennik, kolorowanka, opis świata, podręcznik, kalendarz…) mają mocno obniżony wynik; zapisane propozycje są przy starcie przeliczane bez zapytań do sieci. Oferty z tym samym ISBN, które pójdą za pierwszą decyzją, są jednym wierszem „×N”. Panel identyfikacji zwija się, gdy nic nie działa; skróty pod przyciskiem „Skróty”. Okładki propozycji widoczne także w wąskim panelu. Telefon: przesunięcie w lewo pomija ofertę, w prawo wraca.
- **Katalog:** tytuły bez polskich znaków albo pisane wielkimi literami („PROSPERO W PLOMIENIACH”) dostają litery z przypisanych ogłoszeń o tych samych słowach; „Tytuł : podtytuł” z BN wyświetla się jako „Tytuł: podtytuł”. Dzieło bez autora o tym samym tytule co dzieło z autorem (też z dopiskiem „(ŚWIAT DYSKU)”) trafia do „Możliwych duplikatów”.
- **Serie (migracja 118):** lista tomów cyklu wklejana w widoku Serie nadaje numery dziełom o pasujących tytułach i podpisuje brakujące tomy tytułami („Szukaj brakujących” szuka po tytule). Numer tomu ustawia się pod okładką. Poza znanymi światami dzieła grupują się po autorze (warianty nazwiska razem, pojedyncze przypadkowe książki w „Poza seriami”). Braki można zapisać jako profil skanu „Braki w seriach”, który sam się aktualizuje.
- **Zestawy:** „Dodaj z opisu ogłoszenia” (wklejony opis → książki z katalogu) i „Dodaj tomy” z zakresu cyklu; nazwa świata zapisana jako cykl nie podsuwa już przypadkowych tomów.
- **Skaner:** pasek „Od ostatniej wizyty” (nowe oferty, decyzje, niedziałające źródła); stan źródeł przy polach wyboru, a niedziałające źródła nie są domyślnie zaznaczone; panel stanu katalogu zwinięty; liczniki zerowe ukryte, gdy nie trwa skan. Ceny skupu tylko w trybie handlu.

## 2026-11-08 (20) — Zestawy: działające dodawanie książek i widok jak w weryfikacji

- **Błąd:** dodawanie książki do zestawu, usuwanie jej i zdejmowanie oznaczenia zestawu nigdy nie działały — serwer liczył części adresu `/api/sets/<id>/…` razem z prefiksem i żadna ścieżka nie pasowała (stąd 96 zestawów bez ani jednej książki; nie działało też „Cofnij” po oznaczeniu zestawu w weryfikacji). Naprawione, z testem HTTP.
- **Link do ogłoszenia i potwierdzanie składu** były tylko w ukrytej sekcji trybu handlowego. Teraz są zawsze: „Ogłoszenie ↗” w nagłówku, pod zdjęciem i w przycisku „Otwórz ogłoszenie”; „Nie ma w katalogu” i „Skład sprawdzony z ogłoszeniem” w widoku zestawu. Tryb handlowy zachowuje tylko kalkulator kosztów pakietu.
- **Układ jak w weryfikacji:** lista z miniaturami, ceną i stanem (pusty / skład do potwierdzenia / potwierdzony), zakładki według stanu; po prawej zdjęcie z ogłoszenia, cena, książki zestawu jako karty z okładkami (liczba sztuk zapisuje się od razu).
- **Propozycje z tytułu ogłoszenia:** książki z katalogu, których tytuł ogłoszenie zawiera, wydanie z ISBN pokazanego w ogłoszeniu i pozostałe tomy cyklu („Przygody Gotreka i Felixa” → wszystkie tomy z katalogu w kolejności). Jedno wydanie na książkę; „Dodaj wszystkie”. Na danych z 2026-11-08: propozycje dla 77 z 96 zestawów.
- „Świat Dysku” nie jest już traktowany jako słowo tytułu przy dopasowaniu do katalogu (jak Warhammer i Warcraft).

## 2026-11-08 (19) — Tomy i cykle dla książek spoza BN

- **Cykl i tom z tytułów ogłoszeń** dla dzieł, których nie opisuje rekord BN (wydania z e-ISBN, Open Library, utworzone z ogłoszenia): „Duchy Gaunta. Tom 2. Komisarz Gaunt”, „Stacja Ocalenie - Dan Abnett … Duchy Gaunta tom 13”, „Kolor magii. Świat Dysku. Tom 1”. Z nazwy cyklu wypadają tytuł książki, autorzy (także współautorzy i tłumacze z katalogu), nazwy uniwersów i inicjały; zakresy („TOM 1-3”), połówki („Tom 1,5”) i numeracje kolekcji gazetowych są pomijane. Wygrywa cykl i numer, na który wskazuje najwięcej ogłoszeń (tytuł wydania liczy się podwójnie); remis co do numeru = brak numeru.
- Pierwszeństwo bez zmian: ręczna adnotacja > seria z rekordu BN / e-ISBN > cykl z tytułu BN > ogłoszenia. Dane z ogłoszeń mają źródło `listing` i są przeliczane przy starcie i co 10 minut.
- **Seria z e-ISBN:** opis serii wydawcy (ONIX `Collection`, z numerem części) trafia do serii wydania.
- Widok serii oznacza numery z ogłoszeń przerywaną ramką i „?”; karta wydania podpisuje serię „z ogłoszeń” / „e-ISBN”.
- Serie wydawnicze zapisane w BN jako cykle („Nowa Fantastyka”, „Sensacja - Fantastyka”, „… : fantasy adventure”) nie tworzą już osobnych cykli.
- Na danych z 2026-11-08: numer tomu ma 126 dzieł zamiast 107.

## 2026-11-08 (18) — Rejestr e-ISBN jako źródło opisu książki

- **e-ISBN** (e-isbn.pl, krajowy rejestr ISBN prowadzony przez Bibliotekę Narodową) jest pytany, gdy BN i Open Library nie znają numeru (także gdy Open Library ma awarię). Wydawcy rejestrują tam książkę przy nadaniu ISBN, często zanim BN ją skataloguje. Z rekordu ONIX brane są: tytuł, autor, wydawca (imprint), rok, język i oprawa. Przed Google Books; `BOOKFLIP_E_ISBN=0` wyłącza.
- Pomiar na kolejce 2026-11-08: e-ISBN zna 12 z 81 numerów „nieznanych źródłom” (31 ze 139 ofert, m.in. Pratchett z Prószyńskiego, Warcraft i Diablo z Insignis). Nowych wydań Copernicusa (978-83-8232, 978-83-61656) nie zna — dla nich zostaje „Utwórz wydanie z ogłoszenia”.
- Migracja 117: oferty czekające z „ISBN nieznany źródłom” przechodzą resolver jeszcze raz.

## 2026-11-08 (17) — Zestaw bez potwierdzania

- „Zestaw” (Z) w weryfikacji działa od razu, bez okna potwierdzenia; komunikat ma „Cofnij”, a panel przechodzi do następnej oferty.

## 2026-11-08 (16) — Empik: tylko polskie książki, pełne wyniki; podręczniki do gier osobno

- **Empik szuka w kategorii „Książki”** zamiast w całym sklepie: koniec figurek, gier wideo i „Książek obcojęzycznych”, których żadne polskie źródło nie rozpozna.
- **Empik czyta wszystkie strony wyników.** Pager Empiku rysuje JavaScript, więc w HTML nie było linku „dalej” i skaner kończył na pierwszych 60 wynikach; pełna strona 60 kafelków oznacza teraz, że jest następna.
- **Starsze produkty Empiku** (`,301657,ksiazka-p` — często używane egzemplarze z księgarń partnerskich) nie były w ogóle odczytywane.
- **Powieści bez nazwy uniwersum w tytule** („Kosmiczny Wilk. Tom 1”, „Duchy Gaunta. Tom 2”) przechodzą, gdy Empik zalicza je do „Fantastyka, horror”; inne gatunki nadal muszą zawierać szukaną frazę.
- **Odczyt strony oferty Empiku:** tylko kategoria produktu (ISBN Empik ładuje osobnym API, którego nie czytamy). Import z „Książek obcojęzycznych” dostaje język „obcojęzyczna”.
- **Zakładka „Gry / obce”:** podręczniki do gier Games Workshop (Codex, Battletome, Arcane Journal, Rulebook, General's Handbook, Getting Started, Dawnbringers…) i wydania obcojęzyczne nie trafiają automatycznie do katalogu ani do „Zatwierdź pewne”; w zakładce można je odrzucić hurtem. Polskie podręczniki RPG (np. Warhammer Fantasy Roleplay) zostają jak dotąd. Migracja 116 jednorazowo przepuszcza przez resolver oczekujące oferty, których tytuł na to wskazuje.

## 2026-11-08 (15) — Przegląd drogi od skanu do katalogu: luki i szybsza weryfikacja

- **Allegro Lokalnie: odczyt ISBN nie umiera na HTTP 429.** Źródło, które odpowiada 429 albo wyzwaniem, ma 30 minut przerwy (wcześniej co 5 s kolejne żądanie i kolejna oferta traciła próbę — 106 ofert nie było już nigdy sprawdzanych). Limit nie zużywa prób oferty, a te 106 ofert wraca do kolejki odczytu. Inne źródła działają dalej.
- **Nowy ISBN z ponownego skanu** (sprzedawca dopisał lub poprawił numer) odsyła ofertę z weryfikacji z powrotem do automatycznej identyfikacji.
- **Oferty z tym samym ISBN idą za pierwszą decyzją.** Gdy wydanie z danym ISBN trafi do katalogu (zatwierdzenie, dodanie ręczne, BN, zasilanie katalogu), oferty czekające z „ISBN nieznany źródłom” lub „kilka opisów w BN” same się dopasowują. Ręcznie dodane wydanie dostaje oba warianty ISBN (10 i 13).
- **„Utwórz wydanie z ogłoszenia”** dla ISBN, którego nie zna BN, Open Library ani Google Books: tytuł i autor wypełniają się z ogłoszeń z tym numerem (bez nazw uniwersów, tomu i autora w tytule), jedno kliknięcie tworzy wydanie i przypisuje ofertę, pozostałe oferty z tym ISBN dołączają same. Wydanie jest „niezweryfikowane”; BN jest pytana ponownie mniej więcej raz w tygodniu i po odpowiedzi wydanie dostaje pełny rekord (migracja 115).
- **Kilka opisów jednego ISBN w BN:** gdy to ten sam tytuł (dodruk opisany dwa razy), resolver bierze najstarszy druk; gdy tytuł ogłoszenia wskazuje jeden z nich — ten. W pozostałych przypadkach panel pokazuje opisy do wyboru (klawisze 1–9). Oferty wstrzymane wcześniej z tego powodu przechodzą resolver jeszcze raz.
- **Zakładki kolejki:** Szybkie (jest w katalogu / pewna propozycja), Do dodania, Bez ISBN, Zestawy?, Inne — z licznikami dla całej kolejki. W „Szybkich” **„Zatwierdź pewne…”** pokazuje listę jednoznacznych dopasowań (tytuł pasuje do jednego dzieła z katalogu ≥ 90% albo pewna propozycja BN); poniżej 90% trzeba zaznaczyć ręcznie.
- Panel oferty z ISBN pokazuje też wydania z katalogu pasujące tytułem (często dodruk znanej książki).
- Filtr „Pasuje do katalogu” i „Zaznacz wszystkie z filtra” obejmują całą kolejkę, nie tylko wczytane strony. Przewijanie kolejki w trakcie skanu nie kończy się błędem `CATALOG_CHANGED_DURING_PAGINATION`.
- Podpowiedziane wydanie spoza pierwszych 250 wczytanych dzieł jest dociągane z serwera.
- **Przerwany skan** zapisuje się jako skan („przerwany: tylko ukończone frazy”), więc jego oferty widać w „wynikach skanu”; niczego nie oznacza jako zniknięte.
- „Pomiń” pamięta oferty po odświeżeniu strony; skaner pokazuje, ile ofert Vinted bez podanego języka pominięto; komunikaty katalogu po polsku zamiast kodów; formularz ręcznego wpisu z weryfikacji ma już tytuł i ISBN.

## 2026-11-07 (14) — Zaznaczanie wielu ofert w „Do weryfikacji”

- **„Zaznacz wiele”** obok wyszukiwarki: kliknięcie oferty zaznacza ją zamiast otwierać, Shift+klik zaznacza zakres, „Zaznacz wszystkie z filtra” bierze całą przefiltrowaną listę.
- **Jedna akcja dla wszystkich zaznaczonych:** przypisanie do jednego wydania z katalogu (ręczna decyzja), oznaczenie jako zestawy, ponowna identyfikacja albo odrzucenie. Każda akcja wymaga potwierdzenia i idzie tymi samymi endpointami co pojedyncza decyzja, oferta po ofercie. Nieudane (np. chronione ręczne przypisanie) zostają zaznaczone z powodem, reszta znika z kolejki.
- W trybie zaznaczania skróty klawiszowe pojedynczej oferty są wyłączone.
- Poprawka: wyszukiwarka przypisania oferty bez wydania brała zły początek tytułu.

## 2026-11-07 (13) — Oferty w trakcie skanu, bez ponownego sprawdzania języka

- **Wyniki na bieżąco:** oferty każdej ukończonej pary źródło + fraza są zapisywane od razu i od razu trafiają do kolejki identyfikacji. Wcześniej wszystko czekało na koniec całego skanu. Skaner pokazuje „Zapisano N ofert z: …” i co kilka sekund odświeża listy. Końcowy zapis dodaje podsumowanie skanu; liczniki nowych ofert i zmian cen, liczba wykryć i lista fraz nie są liczone podwójnie. Anulowany skan zachowuje oferty z ukończonych zadań.
- **Język Vinted sprawdzany raz:** oferty już zapisane w katalogu przeszły kontrolę języka przy pierwszym zapisie, więc nie są ponownie otwierane. Pozostałe decyzje (np. ogłoszenia obcojęzyczne) są pamiętane 90 dni zamiast 6 godzin. Powtórny skan frazy z 17 ofertami: 3 s zamiast 61 s.

## 2026-11-07 (12) — Zmiana i odłączanie przypisań ofert

- **W karcie wydania** każda powiązana oferta ma „Zmień lub odłącz”: wyszukiwarka wydań z katalogu (tytuł, autor, tłumacz, ISBN) albo odłączenie, oba z potwierdzeniem. To samo w panelu oferty (sekcja „Przypisanie”), także „Przypisz do wydania” dla ofert bez przypisania.
- Zmiana to ręczna decyzja w historii przypisań i decyzji weryfikacji. Odłączona oferta wraca do „Do weryfikacji”, a odłączone wydanie jest dla niej zapamiętane jako odrzucone: automatyczna identyfikacja nie przypisze jej tam ponownie (`operator_rejected_edition`). Zestawy edytuje się nadal w zakładce Zestawy.
- Endpointy `PUT /api/offers/:id/assignment` (`{editionId}`) i `DELETE /api/offers/:id/assignment`.
- Poprawka: panel oferty nie miał dostępu do komunikatów (`toast`), więc błąd porównania cen kończył się wyjątkiem.

## 2026-11-07 (11) — Budowa bazy: dane z MARC, osoby, zasilanie z BN, cykl życia ofert

- **Rekord MARC zamiast sklejonych pól BN:** czysty tytuł (z podtytułem i numerem części), autor i tłumacz osobno, wydawca bez powtórzeń, oprawa (`020 $q`), liczba stron i format, miejsce wydania, gatunek, tytuł i język oryginału. Istniejące wydania są uzupełniane jednorazowo z zapisanych rekordów, bez internetu; wydania i dzieła poprawione ręcznie nie są nadpisywane. Migracja 112.
- **Osoby z rolami:** tabela osób i ról w wydaniach (autor, tłumaczenie, ilustracje, redakcja). Wyszukiwarka katalogu znajduje tłumaczy i tytuły oryginalne, a kliknięcie osoby w karcie wydania pokazuje jej książki. Endpointy `GET /api/catalog/persons`, `GET /api/catalog/persons/:id`.
- **Serie z rekordu:** pola 490/8XX z numerem tomu, z podziałem na świat, serię wydawniczą i cykl. Widok Serie korzysta z nich w pierwszej kolejności, więc braki w cyklach (np. Herezja Horusa, Gotrek i Felix) są widoczne.
- **Grupowanie dzieł:** po oczyszczeniu tytułów dodruki tego samego tytułu i autora łączą się automatycznie (bez dzieł edytowanych ręcznie). Drugi klucz to tytuł oryginału z autorem, więc przekłady wydane pod różnymi polskimi tytułami trafiają do jednego dzieła.
- **Zestawy w ogłoszeniach:** gdy tytuł wskazuje kilka książek („zestaw”, „6 tomów”, „tom 1-3”, „+”), a ogłoszenie ma jeden ISBN, oferta trafia do weryfikacji (`possible_bundle`) zamiast do jednego wydania. Wcześniejsze automatyczne przypisania takich ofert zostały jednorazowo cofnięte do weryfikacji.
- **Zasilanie katalogu z BN:** panel w Katalogu przyjmuje autora, wydawcę albo tytuł serii. W tle, stronami po 50 rekordów i w tempie limitu BN, dodawane są wszystkie książki z ISBN jako wydania wzorcowe, bez przypisywania ofert. Odrzucane są audiobooki i, opcjonalnie, wydania obcojęzyczne. Awaria BN wstrzymuje zasilanie na 30 minut. Migracja 113.
- **Allegro Lokalnie: ISBN ze strony oferty:** odczytywana jest tylko tabela parametrów sprzedawcy, nigdy opis ani zdjęcia. Empik ładuje szczegóły osobnym API, więc nie jest odczytywany.
- **Cykl życia ofert:** oferty, których skan nie widział od dwóch dni, są sprawdzane na stronie ogłoszenia (najwyżej 8 co 10 minut, każda nie częściej niż co 3 dni). Vinted rozróżnia sprzedane, zarezerwowane i aktywne, a strona 404/410 oznacza ofertę usuniętą. Zapisywana jest data zmiany, a ostatnia cena zostaje. Karta wydania pokazuje liczbę i medianę cen sprzedanych ogłoszeń. Migracja 114; `BOOKFLIP_OFFER_LIFECYCLE=0` wyłącza sprawdzanie.
- **Google Books jako trzecie źródło:** pytane tylko wtedy, gdy BN nie zna numeru lub jest niedostępna, a Open Library nie ma rekordu. Wymaga własnego klucza w `BOOKFLIP_GOOGLE_BOOKS_KEY`, bo limit anonimowy jest wspólny i wyczerpany. Klucz nie trafia do zapisanych wyników.
- **Profile startowe i rotacja:** przy pierwszym uruchomieniu bez profili tworzone są profile „Uniwersa” i „Autorzy i cykle” (bez Allegro i OLX) oraz harmonogram „Wszystkie profile po kolei” co 12 godzin. Harmonogram może teraz skanować kolejne profile na zmianę.
- **Zablokowane źródła:** portal, który odrzucał wszystkie trzy ostatnie skany (CAPTCHA lub HTTP 403), jest oznaczony w skanerze i domyślnie odznaczony. Blokady nie są obchodzone.
- **Automatyczna kopia zapasowa:** codzienna, ze sprawdzeniem integralności, w folderze `backups` (zostaje 7 najnowszych). `BOOKFLIP_BACKUP_DIR` dodaje drugą kopię, np. na innym dysku. Kopie nie zostawiają już plików `.tmp-wal`/`.tmp-shm`. `BOOKFLIP_AUTO_BACKUP=0` wyłącza kopię.

## 2026-11-07 (10) — Automatyczna wycena skupu

- **Tryb automatyczny (domyślnie włączony):** serwer co 10 minut sprawdza, czy w katalogu są ISBN bez wyceny lub z wyceną starszą niż 7 dni, i wycenia je w tle w tym samym wolnym tempie. Nowe wydania dostają cenę skupu same, bez klikania.
- Po przerwaniu serii przez 5 błędów z rzędu automat czeka 2 godziny. Przełącznik „Sprawdzaj automatycznie” na pulpicie (`PUT /api/buyback/auto`), wyłączenie przerywa trwającą serię. Migracja 111 (`buyback_settings`); `BOOKFLIP_BUYBACK_AUTO=0` wyłącza automat przy starcie.

## 2026-11-07 (9) — Cena skupu hurtowego (skupksiazek.pl)

- **Minimalna cena odsprzedaży:** karta wydania pokazuje wstępną wycenę skupksiazek.pl („Sprawdź cenę skupu” / „Sprawdź ponownie”), lista wydań w karcie dzieła — znacznik „skup: X zł”. Stany: cena, wycena ręczna, nie skupują, błąd.
- **Jak:** serwis nie ma API wyceny; klient robi to co formularz „Wyceń” — sesja + token CSRF ze strony, `POST /cart/{kod}` z ISBN, odczyt ceny z pozycji koszyka i natychmiastowe `DELETE` tej pozycji. Wygasła sesja (419) jest odnawiana raz.
- **Ostrożnie wobec serwisu:** najwyżej jedno zapytanie na 8 s (wycena ≈ 16 s), wyniki w bazie na 7 dni (błędy 6 h), dobra stara wycena nie jest nadpisywana chwilowym błędem. Sprawdzanie całego katalogu tylko na przycisk na pulpicie („Sprawdź ceny skupu (N)”), wydania z ofertami najpierw, przerwanie po 5 błędach z rzędu.
- Migracja 110 (`buyback_quotes`), endpointy `GET /api/buyback/quotes?isbn=`, `POST /api/buyback/check`, `GET|POST /api/buyback/batch`, `POST /api/buyback/batch/cancel`.

## 2026-11-07 (8) — Uniwersum dzieła, nazwy grup

- **Uniwersum ręcznie:** w karcie dzieła pole „Uniwersum w widoku Serie” (Automatycznie / istniejące uniwersa / Poza seriami) — przenosi dzieło przypisane tylko przez frazę skanu na właściwą półkę. Migracja 109 (`work_universe_overrides`), endpoint `PUT /api/catalog/universe/:workId`; łączenie dzieł zachowuje wybór.
- **Literówka we frazie skanu nie jest nazwą grupy:** fraza bardzo podobna do autora dzieł (do 2 liter różnicy) jest pokazywana jako jego nazwisko — „Terry Prachet” → „Terry Pratchett”. Autorzy z BN sklejeni w jeden napis są rozdzielani na osoby.

## 2026-11-07 (7) — Kolejka identyfikacji przy awarii BN

- **Przyczyna zatoru:** serwer `data.bn.org.pl` ma wygasły certyfikat TLS (`CERT_HAS_EXPIRED`), więc każde zapytanie do BN kończy się błędem. Weryfikacja certyfikatu nie jest wyłączana.
- **Nowe oferty przed zaległymi:** zadania były brane według daty utworzenia, a ~120 ponowień co 5 minut zajmowało całą przepustowość — 104 nowe pozycje nie zostały ani razu sprawdzone. Teraz najpierw idą zadania z najmniejszą liczbą prób.
- **Coraz rzadsze ponowienia:** 5, 10, 20, 40 min, potem co godzinę (zamiast co 5 min w nieskończoność). Gdy BN znów odpowie na którekolwiek zapytanie, czekające zadania ruszają od razu.
- **Open Library zastępczo:** gdy BN jest niedostępna, a Open Library zna ISBN, rozpoznanie idzie z jej danych (wcześniej OL pytano tylko, gdy BN nie znała numeru).
- **Pulpit:** komunikat „Biblioteka Narodowa niedostępna — <przyczyna>” z liczbą czekających ofert i tym, co aplikacja z tym robi. Przyczyna błędu sieci (kod `CERT_HAS_EXPIRED`, `ECONNRESET`, HTTP 503…) jest zapisywana w wyniku zadania.

## 2026-11-07 (6) — Zgodność ISBN z tytułem, braki w seriach

- **ISBN innej książki nie trafia już do katalogu.** Jeśli tytuł ogłoszenia nie ma ani jednego wspólnego słowa z rekordem dla podanego ISBN (tytuł, seria, uniwersum, nazwisko autora; „Świat Dysku” = „Discworld”, odmiana po rdzeniu), resolver zostawia ofertę w weryfikacji z powodem `isbn_title_mismatch` zamiast przypisać ją lub tworzyć nowe dzieło. Ogólne ogłoszenia („Książka Warcraft”) dalej przechodzą. ISBN wpisany lub sprawdzony ręcznie w weryfikacji nie podlega tej kontroli. W kolejce: etykieta „ISBN innej książki?” i ostrzeżenie nad propozycjami.
- **Katalog → „Podejrzane przypisania”**: dotychczasowe automatyczne przypisania z tym samym problemem (na obecnej bazie 8, m.in. „Logik der Forschung” pod Warcraftem). „Do weryfikacji” cofa przypisanie i wraca ofertę do kolejki; „To prawidłowe” zamienia je w ręczne i nie pokazuje ponownie. Endpointy `GET /api/catalog/title-conflicts`, `POST /api/catalog/title-conflicts/resolve`.
- **Braki w seriach** (widok „Serie”): licznik brakujących tomów, „Kopiuj listę braków” oraz przy każdym cyklu z lukami „Szukaj brakujących” — wpisuje do skanera frazy „<cykl> tom N” (do 10) i przełącza na Skaner.

## 2026-11-07 (5) — Serie w katalogu

- **Katalog → widok „Serie”** (obok „Lista” i „Okładki”): uniwersum (Świat Dysku, Warhammer, Warcraft, Dragonlance, Forgotten Realms; inne — według frazy skanu) → cykl z numerami tomów (Herezja Horusa, Legenda Drizzta, Duchy Gaunta…) → półka okładek. Brakujące tomy są pustymi, przerywanymi miejscami; przy długich lukach (Świat Dysku 1…41) tylko podsumowanie. Cykl i tom pochodzą z opisu serii BN; ręczne oznaczenie serii w karcie dzieła ma pierwszeństwo. Numeracja wydawnicza („Wielka kolekcja”, „Czarna Biblioteka”) nie jest traktowana jako cykl. Endpoint `GET /api/catalog/series-tree`. Widok pokazuje też źle przypisane dzieła (np. obca książka pod Warcraftem) — łatwo je wyłapać.
- Duża okładka dzieła bierze zdjęcie wydania, gdy dzieło nie ma własnego.

## 2026-11-07 (4) — Propozycje z własnego katalogu

- **„Już w Twoim katalogu”** w weryfikacji ofert bez ISBN: wydania dzieł, które już są w katalogu i pasują tytułem, pojawiają się od razu (bez BN, bez sieci), nad propozycjami z BN / Open Library. Wybór klawiszem `1`–`9` wskazuje wydanie, `Enter` przypisuje. Nazwy uniwersów („World of Warcraft”, „Warhammer”) nie wystarczą do dopasowania — muszą się zgadzać słowa samego tytułu. Najpierw polskie wydania i te z największą liczbą ofert. Endpoint `GET /api/identification-jobs/:id/local-candidates`. Na obecnej bazie dotyczy 53 z 257 ofert bez ISBN.
- **Kolejka:** pozycje bez ISBN pasujące do dzieła z katalogu mają etykietę „jest w katalogu”, są pierwsze w swojej grupie, a filtr „Pasuje do katalogu” pokazuje tylko je (najszybsze decyzje: `1` + `Enter`). Sortowanie „Najpewniejsze propozycje” nazywa się teraz „Najszybsze decyzje”.
- **Duplikaty dzieł:** przedrostek uniwersum na okładce („World of Warcraft: Illidan” vs „Illidan / World of Warcraft”) nie rozdziela już dzieła — panel „Możliwe duplikaty dzieł” pokazuje takie pary (autor nadal musi się zgadzać), a nowe wydania trafiają do istniejącego dzieła.

## 2026-11-07 (3) — Uzupełnianie zdjęć i telefon

- **„Uzupełnij zdjęcia”** na pulpicie skanera: w tle odczytuje `og:image` ogłoszeń bez zdjęcia (najpierw kolejka weryfikacji, potem oferty z katalogu), jeden wątek na źródło przez wspólną bramkę tempa. Źródło, które od początku blokuje (3 błędy z rzędu), jest pomijane w tym przebiegu; odpowiedź 429 („za szybko”) oznacza przerwę 1/2/4 min i ponowienie, a nie pominięcie. Endpointy `GET/POST /api/images/backfill`, `POST /api/images/backfill/cancel`.
- **Telefon (390 px):** podpowiedź skrótów klawiszowych nie rozpycha już weryfikacji w poziomie, tabela jakości źródeł mieści się w ekranie.

## 2026-11-07 (2) — Zdjęcia, nowa weryfikacja i wygląd v5

- **Zdjęcia ofert.** Skaner zapisuje zdjęcie z ogłoszenia (Vinted, Allegro, Allegro Lokalnie, OLX, Empik, Tezeusz.pl, Dedalus.pl); migracja 108 dodaje `offers.image_url`. Starsze oferty dostają zdjęcie przy pierwszym podglądzie (jednorazowy odczyt `og:image` strony ogłoszenia) albo przy kolejnym skanie. Obrazy idą przez lokalne `/api/image` z cache na dysku (`image-cache` w katalogu danych) i listą dozwolonych CDN — strona nadal ma `img-src 'self'`.
- **Okładki wydań** w katalogu: zdjęcie przypisanej oferty (najpierw księgarnie), w drugiej kolejności Open Library po ISBN; zastępcza okładka z inicjałami.
- **Weryfikacja od nowa:** duże zdjęcie z ogłoszenia obok propozycji; karty propozycji z oczyszczonym tytułem, autorem, serią i wydawcą BN oraz podświetleniem tego, czym kandydaci się różnią; stały pasek akcji; skróty jednym klawiszem (`1`–`5`, `Enter`, `X`, `S` pomiń, `Z` zestaw, `J/K`, `F` tryb skupienia, `/` szukaj); kolejka grupowana według frazy skanu (serii); pojedyncza pewna propozycja jest od razu sprawdzana (bez przypisywania).
- **Pulpit skanera „Stan katalogu”** zamiast „Następnych kroków zakupowych”: lejek oferty → ISBN → katalog → decyzja, postęp każdej frazy/serii, jakość źródeł (ISBN, katalog, zdjęcia), kompletność wydań. Endpoint `/api/catalog/insights`.
- **Katalog:** widok listy albo siatki okładek, filtr „Tylko niekompletne”, oczyszczone tytuły, autorzy i wydawcy z BN.
- **Tryb handlu** (Ustawienia → Interfejs, domyślnie wyłączony) ukrywa statusy zakupu, ceny docelowe, kalkulator i koszty. Teksty interfejsu mówią o katalogu, nie o zakupach.
- **Paleta poleceń `Ctrl+K`**: widoki, akcje, wyszukiwanie ofert i dzieł z miniaturami.
- **Wygląd v5:** jeden arkusz `app/app.css` (scalone 5 plików), nowe tokeny, motyw jasny/ciemny/systemowy do wyboru, gęstość list, czcionki Segoe UI Variable i szeryfowe tytuły książek.

## 2026-11-07 — Skaner, katalog i weryfikacja

- **BN: wszystkie formy ISBN.** Adapter pytał tylko o dokładną formę numeru, więc książki indeksowane w BN pod ISBN-10 uchodziły za nieznane. Teraz sprawdzane są obie formy. Migracja 105 usuwa stare negatywne odpowiedzi z cache i ponownie kolejkuje oferty zamknięte jako „nie znaleziono”.
- **ISBN nieznany źródłom nie znika z kolejki.** Wynik `not_found` zostawia zadanie w weryfikacji (z istniejącym przepływem „Dodaj do katalogu”), zamiast zamykać je poza katalogiem i kolejką.
- **Strony szczegółów (Tezeusz.pl).** ISBN, wydawca, autor i rok są czytane z danych strukturalnych produktu (JSON-LD, atrybuty). Treści opisów, adresów obrazków i „polecanych ofert” nie czytamy — na Allegro Lokalnie zawierają ISBN-y innych książek. Migracja 106.
- **Propozycje po tytule** dla ofert bez ISBN (BN, ocena zgodności z tomem, autorem, językiem i rodzajem dokumentu). Tylko podpowiedź — przypisanie wymaga potwierdzenia. Migracja 107. W kolejce: znacznik pewności, sortowanie „Najpewniejsze propozycje”, skróty Alt+Enter i Alt+1…5.
- **Dodruki w jednym dziele.** BN nie podaje identyfikatora dzieła, więc każde ISBN tworzyło osobne dzieło. Nowe wydanie o tym samym tytule i pierwszym autorze trafia do istniejącego dzieła. Panel „Możliwe duplikaty dzieł” w Katalogu łączy istniejące grupy.
- **Poprawki błędów:** łączenie dzieł kończyło się błędem 500 przy dziełach z rekordami zewnętrznymi (tabela jest niezmienna); bramka tempa źródeł przekazywała `signal: null` do timera i padała na drugim żądaniu bez sygnału przerwania.
- **Skaner:** automatyczny skan wybranego profilu co N godzin (domyślnie wyłączony), skuteczność zapytań (oferty / w katalogu / czeka / bez ISBN), ceny-śmieci (≥ 10 000 zł) zapisywane jako nieznane, log bez wpisów przy braku pracy.
- **Porządek:** archiwalne raporty przeniesione do `docs/archive`, usunięte kopie starych arkuszy CSS, zrzuty i logi testów; usunięto 25 reguł CSS, które niczego nie zmieniały; historia Git od tego punktu.

## 2026-11-04 — Reliability fixes from project audit

- Identification drains ready batches continuously (default 25 jobs) instead of waiting for the next poll between small batches. Pause, stop and provider request limits remain respected.
- Concurrent ISBN lookups share requests; Open Library work and author resources use a bounded one-hour memory cache. Manual-review tasks no longer appear as unfinished automatic work in progress indicators.
- Added offline queue-throughput, request-coalescing, resource-cache and progress regressions plus a synthetic identification benchmark.

- Reworked all six workspaces around sourcing, explicit edition review and purchase decisions. Scan membership, saved scenarios, actual purchase prices, bundle quantities and unknown members use migration 104.
- Added full-dataset purchase filters and single offer pagination, a shared accessible details drawer, five primary mobile destinations with a More menu, and unsaved-form protection.
- Added work/edition metadata editing, previewed work merges, review corrections preserving immutable history, source health and verified backups from Settings.
- Updated offline integration tests and the browser smoke workflow for the new interactions.

- Restore transaction nesting after failed COMMIT and version the excluded-review schema upgrade as migration 103, with backup and integrity checks before commit.
- Normalize Polish Unicode consistently in catalog, author, offer and review searches; preserve UTF-8 characters across HTTP request chunks.
- Isolate each test process's runtime files and enforce a 30-second test timeout through `npm test`; include JavaScript tests and tooling changes in CI triggers.
- Compute book statistics in batches, reduce historical prices in SQL for legacy snapshots, scope manual book projection and group scan identifiers once per edition.
- Add a matched-edition scan benchmark and ignore SQLite databases in Git. Existing migration SQL files remain unchanged.

## 2026-10-31 — SQLite-first catalogue

- Retired the obsolete JSON scan mirror/outbox recovery modules after the SQLite-only HTTP cutover (PR #50). Historical SQLite migration files remain immutable.

- SQLite became the default store for offers, prices, manual catalogue actions and ISBN identification (PR #36).
- Added background identification polling and retry after restart (PR #37).
- Added offline end-to-end scanner and HTTP persistence regressions (PR #38 and #40).
- Prevented overlapping local scans and tightened book-product filtering (PR #41).
- Fixed literal catalogue searches, retry handling and migration documentation (PR #41–42).
- Replaced the 10,000-record startup limit with incremental loading (PR #43).
- Added cross-platform syntax checks and editor defaults (PR #44).
- Extended SQLite-backed global searching and bounded large-list DOM rendering (PR #45–46).

**Runtime:** After PR #49 the local HTTP server is SQLite-only; historical JSON import/parity CLI tools remain available. No automatic data deletion or import is performed.

**Known limitations:** marketplace parsers still need sanitized, confirmed real-world page fixtures; historical JSON import and migration test code remains archived in the repository; page filters and sorting beyond the server-side text query need complete backend pagination coverage.
