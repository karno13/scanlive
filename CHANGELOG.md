# Changelog

BookFlip uses small pull requests and GitHub Actions on Ubuntu/Windows to track changes.

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
