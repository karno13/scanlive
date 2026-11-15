# Changelog

Zmiany widoczne dla użytkownika. Wpisy są numerowane, najnowszy na górze; liczby pochodzą z danych użytkownika (kopia bazy), gdy są dostępne. Poprawki błędów zaczynają się od „**Błąd:**”.

## 2026-11-15 (74) — Podejrzane przypisania: komunikat przy braku pozycji

- **Błąd:** w Kolejce → „Podejrzane przypisania” przy 0 pozycji ekran był pusty (panel był ukryty mimo komunikatu). Teraz widać komunikat „Każda przypisana oferta ma w tytule coś wspólnego ze swoim wydaniem.”

## 2026-11-15 (73) — Lista książek na pełną szerokość po powrocie ze strony książki

- **Błąd:** po otwarciu książki i powrocie („← Wszystkie książki”) widoki „Okładki” i „Serie” zajmowały tylko część szerokości (746 px przy 1440 px), prawa część ekranu była pusta. Lista ma teraz pełną szerokość zawsze, gdy strona książki nie jest otwarta.

## 2026-11-15 (72) — Lista książek nie zwija się po usunięciu; krótszy pasek serii

- **Błąd:** po rozwinięciu listy „Książki” ponad 100 pozycji kliknięcie „×” (albo „Cofnij”) zwijało ją z powrotem do 100. Teraz przy tych samych filtrach lista zostaje rozwinięta — sprawdzone na kopii bazy: 400 widocznych pozycji przed usunięciem, po nim i po „Cofnij”.
- **Błąd:** w widoku „Serie” pasek skrótów miał po jednym przycisku na każde uniwersum (83 na kopii bazy) i, przyklejony do góry, zasłaniał prawie cały ekran. Teraz to jedna linia: lista „Wszystkie serie (83)…” i 10 największych serii; na wąskim ekranie przewija się w poziomie.

## 2026-11-15 (71) — Usuwanie książki jednym kliknięciem z listy

- Na liście „Książki” (widok „Lista” i „Okładki”) po najechaniu na książkę na okładce pojawia się **„×”**. Kliknięcie od razu usuwa książkę z katalogu, bez okna potwierdzenia — działa jak „Usuń z katalogu” (oferty odrzucone, nowe oferty tej książki odrzucane same). Na telefonie „×” jest widoczny stale.
- „Usuń z katalogu” na stronie książki też nie pyta już o potwierdzenie.
- Zabezpieczeniem jest **„Cofnij”** w powiadomieniu albo „Narzędzia katalogu → Usunięte z katalogu → Przywróć”. Sprawdzone na kopii bazy: usunięcie i „Cofnij” przywracają książkę razem z jej ofertą.

## 2026-11-15 (70) — Krótsza strona książki: kafelki cen, akcje, oferty z linkami

- Na górze strony książki są **kafelki**: najniższa cena i mediana dostępnych ofert, mediana sprzedanych na Vinted, **cena skupu** (najwyższa wycena skupksiazek.pl spośród wydań z ISBN-13) i liczba ofert. Przykład z kopii bazy, „Fourth Wing”: 20,00 zł / 40,00 zł (275 dostępnych) / 30,00 zł (15 sprzedaży) / skup 16,55 zł / 298 ofert.
- Pod tytułem jest **pasek akcji**: „Szukaj w skanerze” (wpisuje tytuł i autora jako frazę), „Sprawdź skup”, „Popraw dane” (także łączenie duplikatu), „Seria i tom”, „Uniwersum” i „Usuń z katalogu”. Formularze otwierają się pod paskiem, jeden naraz. Cena skupu jest widoczna na stronie książki także poza trybem handlowym.
- **Oferty** to krótka lista: najpierw dostępne od najtańszej, potem sprzedane (wyszarzone); 15 na start, reszta pod „Pokaż więcej”. Każda ma link **„Ogłoszenie ↗”** otwierający ogłoszenie w nowej karcie; kliknięcie wiersza nadal otwiera szczegóły oferty.
- Wykres cen, tabele wg rodzaju oferty, stanu i wariantu oraz pochodzenie danych są zwinięte w „Szczegóły cen i pochodzenie danych” na dole. Wybór wariantu cenowego wydania jest w tej samej linii co wydanie. Strona „Fourth Wing” ma teraz ok. 2 600 px wysokości zamiast ok. 9 000 px.
- **Błąd:** znak „?” przy „Wydanie nieustalone” rozciągał się na pół szerokości wiersza.
- **Błąd:** na telefonie strona książki miała dwa przyciski powrotu („Wróć do listy” i „← Wszystkie książki”); został jeden.

## 2026-11-14 (69) — Szybsze sprawdzanie języka na Vinted

- **Błąd:** oferty Vinted, na których stronie sprzedawca nie podał języka, były czytane od nowa w każdym skanie — około 110 stron na pełny skan (ok. 4 minuty przy tempie jednej strony na 2 s). Teraz wynik „brak języka” jest pamiętany przez 7 dni; po tym czasie strona jest czytana ponownie, bo sprzedawca mógł język uzupełnić.
- Pomiar na kopii bazy: skan z 14.11 wieczorem sprawdzał 1237 nowych ofert przez 63 minuty — to pierwszy skan nowych fraz (seria). Kolejne skany tych samych fraz czytają tylko nowe oferty (skany z 12–13.11: 22–41 stron, 5–7 minut).

## 2026-11-14 (68) — Usuwanie pozycji z katalogu

- Na dole strony książki („Książki” → wybrana książka) jest **„Usuń z katalogu”** — dla pozycji, które nie należą do kolekcji. Po potwierdzeniu (okno podaje liczbę wydań i ofert) książka znika z list razem z wydaniami, a wszystkie jej oferty są odrzucane i znikają z weryfikacji i z „Ofert”.
- Śmieć nie wraca: nowa oferta, która trafi na wydanie usuniętej książki albo ma jeden z jej numerów ISBN, jest odrzucana sama po każdym przebiegu identyfikacji.
- Wszystko da się cofnąć: „Cofnij” w powiadomieniu albo „Narzędzia katalogu → Usunięte z katalogu → Przywróć” przywraca książkę i każdą jej ofertę z przypisanym wydaniem. Pojedynczą ofertę można też otworzyć ponownie w „Ostatnich decyzjach” — blokada jej nie odrzuci drugi raz. Ręczne przypisanie ma pierwszeństwo przed blokadą.
- Nic nie jest kasowane z bazy: decyzje weryfikacji są niezmienne, więc usunięcie to ukrycie z blokadą. Oferty-zestawy, w których ta książka jest jednym z tomów, zostają.

## 2026-11-14 (67) — Skan po serii, do 200 fraz

- Nad polem fraz jest wybór **„Szukaj po serii”**: Świat Dysku (41 powieści), Herezja Horusa (tomy 1–48, z zapowiedziami) i Gotrek i Felix (17 głównych tomów). Wybór wstawia tytuły serii jako frazy; można je poprawić przed kliknięciem „Skanuj” i zapisać jako profil.
- Limit fraz w skanie i w profilu wzrósł z 10 do **200**. Więcej fraz to dłuższy skan: każda fraza jest osobnym zapytaniem w każdym wybranym źródle (antykwariaty czytają kategorię raz).

## 2026-11-14 (66) — Pięć antykwariatów internetowych jako nowe źródła

Nowe źródła do wyboru w skanerze: **BlackBooks.pl** (Gdańsk), **Antykwariat Conroy** (Kraków), **Szarlatan.pl** (Wrocław), **Stara Dobra Książka** (Gdynia) i **Antykwariat NWS** (Kraków). Ich oferty mają rodzaj „Antykwariat” i wspólny kolor.

- Antykwariaty nie są przeszukiwane frazą: skan czyta całą kategorię fantastyki / SF strona po stronie (tak pozwala ich `robots.txt`) i dopiero potem dopasowuje książki do fraz profilu. Książki, których żadna fraza nie nazywa, nie są zapisywane (liczone jako „temat”).
- Ta sama fraza w danym antykwariacie jest czytana najwyżej raz na 20 godzin; w kolejnych skanach tego dnia jest od razu oznaczona jako zrobiona. Pełny odczyt to ok. 250 stron (najwięcej BlackBooks i Stara Dobra Książka), więc pierwszy skan z antykwariatami trwa kilka minut dłużej. Szybki skan (najnowsze) ich nie obejmuje.
- Antykwariat Conroy podaje na liście ISBN, wydawcę, stan i wady — te oferty mają ISBN od razu. Pozostałe cztery podają tylko tytuł z autorem i cenę.
- Oferta, która zniknęła z przeczytanej do końca kategorii, jest oznaczana jako niewidziana; sprzedane egzemplarze Starej Dobrej Książki („Egzemplarz sprzedany”) nie są ofertami.
- Regulaminy pięciu sklepów nie zakazują automatycznego odczytu. **Skupszop.pl nie jest dodany:** fraza idzie w parametrze `filters[keyword]` razem z `routeName` ze strony wyszukiwania, której `robots.txt` zakazuje — do ustalenia przez właściciela.

## 2026-11-14 (65) — Rozpoznanie nowych źródeł i robots.txt obecnych

Bez zmian w aplikacji; wynik jest w `docs/SOURCES-ACCESS-2026-11.md` (sekcja z 14.11).

- **Skupszop.pl** to najlepszy kandydat na nowe źródło używanych książek: jego `robots.txt` wprost dopuszcza API listy produktów, a odpowiedź ma ISBN, stan egzemplarza, cenę dla każdego stanu i dostępność (200 678 używanych pozycji). Nie ustaliłem jeszcze zapisu frazy w adresie zapytania i nie czytałem regulaminu — dlatego źródło nie jest dodane.
- **Do decyzji:** `robots.txt` Tezeusza zakazuje adresu wyszukiwarki, z którego korzysta skan (`/szukaj?`), a Dedalusa — `/s?q=`. Vinted, Empik i Allegro Lokalnie dopuszczają używane adresy. Propozycja w dokumencie: Dedalus do „brak legalnego dostępu”, Tezeusz przez strony autorów albo produktów.
- Sprzedajemy.pl (zapytania zakazane), TaniaKsiazka (wyszukiwarka zakazana), Bonito i TakCzytam — ocena w tabeli.

## 2026-11-14 (64) — Allegro Lokalnie: mniej stron ofert naraz

Allegro Lokalnie odpowiedziało CAPTCHA po 13 stronach ofert czytanych z rzędu (12.11), a 14.11 odmówiło także skanu; to źródło daje 62 z 82 decyzji w kolejce, więc blokada kosztuje najwięcej.

- Zadania w tle (sprawdzanie dostępności i czytanie szczegółów ze strony oferty) czytają najwyżej **4 strony Allegro Lokalnie na rundę**; reszta czeka na następną rundę (dotąd do 20 przy dostępności i do 40 przy szczegółach). Odstęp 8 s między zapytaniami i pauza po blokadzie bez zmian. CAPTCHA nadal nie jest omijana.
- Skutek uboczny: szczegóły i dostępność ofert z tego źródła uzupełniają się wolniej. Czy to wystarczy, żeby blokady ustały, okaże się po kilku dniach pracy aplikacji — nie da się tego sprawdzić bez zapytań do serwisu.

## 2026-11-14 (63) — Czas skanu, cena sprzedaży z małej próby, test parsera Tezeusza

- **Dziś → „Ostatni skan”** pokazuje, ile trwał skan („· trwał 12 min”). Czas jest zapisywany przy każdym nowym skanie; starsze skany go nie mają. Pozwala ocenić koszt dodania frazy albo źródła.
- **Strona książki:** przy „Sprzedane na Vinted” z mniej niż 3 sprzedaży stoi „mało danych” (na kopii bazy 351 z 415 książek z ofertami nie ma żadnej zaobserwowanej sprzedaży, 55 ma jedną).
- **Tezeusz:** sprawdzone jednym zapytaniem przez bramkę — wyszukiwarka sklepu pokazuje z ceną egzemplarze, które strona produktu ma już jako „Produkt niedostępny”, więc oferta może być „nowa” i po chwili „Niedostępna”; to poprawne zachowanie, nie błąd. Karty bez ceny („Niedostępny”) nie są ofertami. Parser ma teraz test na zapisanym fragmencie strony (`fixtures/marketplaces/tezeusz-cards-captured.json`).

## 2026-11-14 (62) — Poprawki po przeglądzie aplikacji (część 1)

- **Błąd:** dzieło w katalogu nazwane samym nazwiskiem autora (np. „Terry Pratchett”, utworzone z ogłoszenia bez tytułu) było proponowane jako „pewne dopasowanie” (95%) dla każdej oferty tego autora — na kopii bazy 2 z 3 kart w siatce „Szybkie”. Taki wpis nie jest już nigdy propozycją po tytule.
- **Błąd:** oferty z ceną 10 000 zł i więcej zapisane przed wprowadzeniem limitu zachowywały tę cenę (2 oferty na kopii bazy, jedna otwierała listę zestawów). Jednorazowa naprawa przy starcie czyści takie ceny i ich odczyty w historii.
- **Błąd:** tytuł w formularzu „Utwórz wydanie z ogłoszenia” nie zostawia już samotnego cudzysłowu po usunięciu autora.
- **Błąd:** lista „Książki” pisała „1 ofert” i „3 ofert” zamiast „1 oferta”, „3 oferty” (to samo w „Możliwych duplikatach”); na telefonie plakietka „Niezweryfikowane” nie zasłania już tytułu, a liczniki nie nachodzą na „brak: rok / wydawca”.
- **Błąd:** na stronie książki przycisk „Dodaj książkę” nachodził na róg karty — jest tylko nad listą.
- **Źródła:** od 1100 px „Stan źródeł” stoi obok formularza skanu zamiast nad nim (formularz zajmował 620 z 1440 px, reszta była pusta). **Błąd:** kropki przy niedziałających źródłach były zielone — są czerwone jak na „Dziś”, przy Allegro i OLX szare.
- **Oferty:** kolumna „Stan” nazywa się „Katalog · ogłoszenie” i oprócz stanu w katalogu pokazuje stan ogłoszenia, gdy nie jest zwykły (Sprzedana, Niedostępna, Mogła zniknąć) — dotąd widać go było tylko na telefonie. Plakietka „Usunięta” nazywa się „Niedostępna”, tak jak w szczegółach oferty.

## 2026-11-14 (61) — Dokumentacja: jedno miejsce z ustaleniami i przepisami

Bez zmian w aplikacji.

- **`CLAUDE.md`** jest pełnym briefem na start pracy: co jest ustalone i o co nie pytać (jedna osoba, lokalnie, odsprzedaż na Vinted, polskie wydania, bez Allegro i OLX, handel odłożony), jak pracować, polecenia, gdzie co leży, przepisy „jak dodać trasę / migrację / zadanie w tle / źródło / widok / test” i tabela „co zaktualizować po zmianie”.
- **`docs/PRODUCT-DIRECTION.md`** ma sekcję „Założenia właściciela”.
- **`README.md`** ma spis „Dokumentacja — gdzie co jest” zamiast drugiego opisu architektury. Ścieżki bazy i polecenia kopii są opisane tylko w README; `PRODUCTION-CATALOG.md` i `docs/DATA-MIGRATION.md` do niego odsyłają.
- Przegląd interfejsu z 11.2026 przeniesiony do `docs/archive/`; archiwum ma `README.md` z informacją, że nie opisuje stanu bieżącego.

## 2026-11-14 (60) — Tańsza praca nad kodem: szybsze `verify`, schemat bazy w jednym pliku, więcej typów

Bez zmian w wyglądzie i działaniu aplikacji.

- **`npm run verify`: 70 s → 33 s.** Usunięty krok `check:syntax` (osobny proces `node --check` na każdy plik, 33 s); błędy składni i tak zatrzymuje lint, który parsuje każdy plik.
- **`docs/SCHEMA.sql`**: aktualny schemat bazy (57 tabel z indeksami i wyzwalaczami) w jednym pliku zamiast w 41 migracjach. Generuje go `node scripts/dump-schema.mjs`; test `test/schema-doc.test.mjs` nie przejdzie, gdy po nowej migracji plik jest nieaktualny.
- **Typy:** `// @ts-check` w 67 modułach zamiast 9 — 58 dodanych przeszły bez poprawek.
- **Trasy:** `trading-api.mjs` nazywa się `api-routes.mjs` (tabela `apiRoutes`) — większość jego tras to katalog, kolejka i ustawienia, nie handel. W `local-app.mjs` 57 tras nie powtarza już sprawdzenia „katalog otwarty”: handler, który bierze `catalog`, dostaje otwarty katalog albo żądanie kończy się 503 `CATALOG_DISABLED` (plik krótszy o 43 linie).
- **Usunięte** nieużywane moduły sprzed SQLite: `feed.mjs`, `rss.mjs`, `local-batch-scan.mjs` z testami (740 linii; zostają w historii Git). Narzędzia importu dawnej historii JSON zostały.
- **`local-app.mjs`: 2410 → 432 linie.** Skan jest w `scan-engine.mjs`, zadania w tle w `background-jobs.mjs`, wspólne elementy procesu w `app-runtime.mjs`, a 67 tras w pięciu plikach `routes/` (zdjęcia, weryfikacja, katalog, oferty, źródła). Żadne dwie trasy nie dopasowują tego samego żądania, więc kolejność tabel nie ma znaczenia. Sprawdzone na serwerze z pustą bazą: 21 adresów z każdego pliku tras odpowiada tak jak przedtem.
- **Testy serwera w `test/`:** 149 plików `*.test.mjs` przeniesionych z katalogu głównego, w którym zostało 113 plików zamiast 264. Jeden plik uruchamia `npm test -- test/nazwa.test.mjs`.
- Test importów pomija `scratch/` (pliki robocze spoza Git).

## 2026-11-14 (59) — Style: plik na obszar, każdy selektor w jednym miejscu

Bez zmian w wyglądzie i działaniu. Style obliczone każdego elementu (także `::before`, `::after`, `::marker`, `::placeholder`, `::backdrop`) w 976 stanach — 61 widoków i stanów (okna, paleta poleceń, tryb skupienia, siatka wsadowa, „Odrzuć z regułą…”, puste listy, najechanie i fokus) × 390/1100/1440/1920 px × motyw jasny i ciemny × tryb handlu — są takie same przed i po każdym kroku (`node scripts/css-snapshot.mjs <port> <katalog> --verify`).

- **Pliki:** zamiast `app/app.css` (216 800 B, jedna linia do 3568 znaków) 12 plików w `app/styles/` dołączanych z `index.html` w stałej kolejności: tokeny i motywy, baza, powłoka, komponenty, Dziś, Kolejka, Książki, Oferty, Zestawy, Źródła, Ustawienia, tryb handlu. Razem 230 057 B po sformatowaniu Prettierem (najdłuższa linia 249 znaków); przesyłane z gzip: 42,4 KB → 49,0 KB.
- **Reguły:** 2164 → 1826. **Selektory zdefiniowane w więcej niż jednej regule tego samego kontekstu** (`@media`): 283 → 14; licząc z wariantami `@media`: 445 → 239. **`!important`:** 39 → 40 — 6 zbędnych usuniętych, ale kilka list selektorów rozdzielonych między pliki powiela swoje deklaracje.
- **Usunięte 199 selektorów**, które nie mogą niczego dopasować: wymagają klasy lub id, których nie ma w żadnym pliku aplikacji ani serwera (i żaden z 976 stanów ich nie pokazał).
- **Kolejność kaskady** jest kolejnością plików. 300 fragmentów reguł (16%) stoi w pliku późniejszego obszaru pod notatką „Z obszaru …”, bo muszą przyjść po tamtejszych regułach; 201 z 479 wariantów `@media` stoi zaraz za swoim komponentem (pozostałe przesunięte zmieniłyby wygląd).
- **Start aplikacji:** 68 zapytań zamiast 57 (11 arkuszy więcej, 58 statycznych zamiast 47; 228 KB zamiast 221 KB). Zwykłe przeładowanie: 71 zamiast 60, wszystkie arkusze odpowiadają 304 (10,7 KB).
- **Testy** nie czytają już tekstu CSS: zasady (kolory tylko jako zmienne, motyw ciemny zmienia tylko wartości, ukryte widoki, `[hidden]`, bezpieczny obszar paska na telefonie) sprawdzają sparsowane reguły wszystkich arkuszy (`app-styles.mjs`); zachowanie — `scripts/browser-smoke.mjs` (pola 16 px / 44 px na telefonie, cele 44 px i widoczny fokus w szczegółach oferty, ukryte przyciski weryfikacji, brak animacji przy ograniczeniu ruchu). Usunięte asercje, które sprawdzały tylko obecność napisu w `app.css`.

## 2026-11-12 (58) — Porządki w dokumentacji i jedno polecenie kontroli

Bez zmian w działaniu aplikacji.

- **README** mówi o bieżącym priorytecie (skaner, katalog, weryfikacja; handel odłożony) i odsyła po cel docelowy do `docs/PRODUCT-DIRECTION.md`. Jeden opis sześciu zakładek (Dziś, Kolejka, Książki, Oferty, Źródła, Ustawienia) zamiast dwóch, w tym starej tabeli z „Skaner” i „Do weryfikacji”. Kopia i przywracanie w jednej sekcji; naprawione polskie znaki w akapicie o cenach Empiku; zamiast wyliczanki migracji 104–132 jedno zdanie.
- **Zmienne środowiskowe** są tylko w tabeli `PRODUCTION-CATALOG.md` („Konfiguracja”): dopisane `BOOKFLIP_EDITION_GAPS` (wcześniej dopisek pod tabelą) i `BOOKFLIP_STORAGE`; każda z 24 nazw w tabeli jest używana w kodzie i żadnej używanej nie brakuje.
- **CHANGELOG** zawiera wpisy od 2026-11-10 (33 wpisy z tym, 59 KB zamiast 102 KB); 27 starszych jest w `docs/archive/CHANGELOG-do-2026-11-09.md`. Dokument jednorazowy `PROMPT-POPRAWKI-PO-PRZEGLADZIE.md` przeniesiony do `docs/archive/`.
- **Mapa repozytorium** (`docs/REPOSITORY-MAP.md`): jedna linijka na plik; dopisane pliki, których brakowało: 39 z katalogu głównego, 16 widoków, 7 z `app/core`, 4 źródła metadanych i 9 skryptów. Moduły nieosiągalne z serwera (`feed.mjs`, `rss.mjs`, import JSON, próba migracji, porównanie historii, dawna reidentyfikacja, skan wsadowy) opisane w „Elementach historycznych”.
- **`npm run verify`**: lint, składnia, typy, formatowanie i testy po kolei, stop na pierwszym błędzie (`scripts/verify.mjs`, działa w PowerShell i Git Bash). Repozytorium nie ma zdalnej kopii, więc `.github/workflows` się nie uruchamiają — to polecenie jest kontrolą przed zakończeniem pracy.
- **Lint** łapie nieznane nazwy (`no-undef`; nazwy Node i przeglądarki wpisane w `eslint.config.mjs`), pomija `scratch/`, `artifacts/` i `screens/`. **Typecheck** obejmuje też `catalog-measures.mjs` i `rejection-rules.mjs`; nowy test nie przejdzie, gdy plik z `// @ts-check` nie jest wymieniony w `tsconfig.typecheck.json`.

## 2026-11-12 (57) — Sprawdzanie ofert, które zniknęły ze skanów: sprawiedliwa kolejność

Aplikacja działa krótko, raz dziennie, a kolejka sprawdzania sortowała należne oferty po cenie malejąco — przy limicie 20 na rundę tanie książki nigdy nie doczekiwały się sprawdzenia, więc nie wiedzieliśmy, czy się sprzedały.

- Progi cenowe (12/24/48 h) nadal tylko decydują, czy oferta jest już **należna**. Kolejność: najpierw nigdy niesprawdzone, potem najdawniej sprawdzone; cena rozstrzyga tylko remis.
- Gdy po rundzie zostają należne oferty z tej kolejki, następna runda rusza po **2 minutach** zamiast 10 (limit 20 na rundę, pauzy po blokadzie źródła i tempo bramki bez zmian). Oferty wciąż widoczne w skanach dalej dostają tylko resztę budżetu.
- Wartości na kopii bazy: należnych **392** (≥100 zł: 256, 40–100 zł: 132, <40 zł: 4), z czego nigdy niesprawdzonych **251** (119 / 132 / 0). W pierwszej rundzie 20 ofert: przed — 3 nigdy niesprawdzone, po — 20. Pierwsza tania (<40 zł) oferta była przed na pozycji 389 w kolejce, teraz na 256; całą zaległość (392) nadrobi ok. 20 rund (~40 min).

## 2026-11-12 (56) — Dziś: cztery miary z trendem

Pod kafelkami „Dziś” są cztery liczby liczone w SQL (`catalog-measures.mjs`, `GET /api/today` → `measures`). Wartości na kopii bazy:

- **Rozpoznane automatycznie: 70,2%** (1796 z 2558 ofert; bez odrzuconych jako „nie książka”). Automatycznie to aktywne przypisanie, którego nie zrobił człowiek (ISBN, metadane, reguła Empiku). Samo rozpoznanie, także ręczne, to 2173 z 2558 = 84,9%.
- **Najstarsza decyzja w kolejce: 1 d** (111 decyzji; od 11.11, 09:54; Empik jako wzbogacanie cen nie liczy się do kolejki).
- **Kompletne wydania: 85,6%** (471 z 550; wydawca i rok, bez „Wydań nieustalonych”) — po uzupełnieniu braków (wpis 54) 89,6%.
- **Dostępność potwierdzona: 10,8%** (288 z 2660) — po wpisie 55 24,8%.

Trend to różnica względem najstarszego zapisu z ostatnich 7 dni. Zapis powstaje raz na dzień i miarę (migracja **132**, `metric_snapshots`), więc przez pierwszy dzień karta pokazuje „trend od jutra”. Strzałka jest zielona, gdy zmiana idzie w dobrą stronę (dla wieku najstarszej decyzji dobra jest zniżka).

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

## Starsze wpisy

Wpisy do 2026-11-09 włącznie: [docs/archive/CHANGELOG-do-2026-11-09.md](docs/archive/CHANGELOG-do-2026-11-09.md).
