# Zadanie: poprawki BookFlip po przeglądzie całego projektu

Pracujesz w repozytorium BookFlip (lokalna aplikacja Node + `node:sqlite` + frontend bez frameworka). Zasady pracy są w `CLAUDE.md` — obowiązują w całości. Poniżej wynik niezależnego przeglądu projektu i lista zmian do wdrożenia. Przejdź przez wszystkie etapy po kolei, bez pytania o zgodę między nimi; zatrzymaj się tylko w sytuacjach opisanych w sekcji „Kiedy pytać”.

## Po co to robimy

Właściciel chce kupować książki do odsprzedaży. Jego decyzje (z 2026-11-10):

- sprzedaje na Vinted, więc ogłoszenia Vinted ze statusem „Sprzedane” są wzorcem ceny odsprzedaży;
- narzędzie jest tylko dla niego (jeden użytkownik, lokalnie);
- interesują go wydania polskie;
- nie zdecydował jeszcze, czy zostaje przy niszy (fantastyka z wyczerpanych nakładów), czy poszerza zakres — ma to rozstrzygnąć pomiar;
- może codziennie weryfikować oferty ręcznie.

Główny wniosek przeglądu: katalog (dzieło → wydanie → oferta) jest dobry, ale obserwacja rynku jest płytka. Aplikacja pobiera dane, których potem nie zapisuje, a po zniknięciu ogłoszenia nie da się ich odtworzyć. Dlatego najpierw zapis danych, potem jakość sygnału sprzedaży, dopiero potem reszta.

## Stan wyjściowy — ustalone fakty

- Drzewo robocze ma 46 zmienionych i 27 nieśledzonych plików, w tym migracje 119–123, które są już zastosowane w bazie użytkownika. `catalog-migrations.mjs` rzuca `MIGRATION_CHECKSUM_MISMATCH`, gdy plik migracji się zmieni.
- `reference-parsers.mjs` odczytuje stan egzemplarza (Vinted, OLX, Allegro Lokalnie) i opłatę kupującego Vinted (`buyerFee`), ale `parseMarketplace` w `marketplaces.mjs` przepuszcza tylko pola z `bibliographicMetadata` (`isbn.mjs`), a tabela `offers` nie ma na nie kolumn.
- Dla Allegro Lokalnie i Tezeusza stan trafia do `offer_enrichment.facts_json` (pole `condition`).
- `filterVintedPolishOffers` w `local-app.mjs` pobiera stronę szczegółów każdej nowej oferty Vinted, ale przekazuje dalej tylko język i ISBN. `parseVintedDetail` ma już opis, który jest porzucany, a potem dla zestawów pobierany drugi raz do `offer_descriptions`.
- Oferty Vinted z nieznanym lub obcym językiem oraz oferty odrzucone przez `acceptsBook` nie są nigdzie liczone trwale.
- `parseBookstore` wpisuje `available: true` na sztywno (dotyczy m.in. Empiku).
- `offer-lifecycle.mjs`: oferta jest sprawdzana po 2 dniach nieobecności w skanach, ponownie co 3 dni, 8 ofert na 10 minut; zapisywana jest tylko data ostatniej zmiany (`availability_changed_at`).
- Ponownie wystawione ogłoszenie Vinted dostaje nowy numer i jest nową ofertą. W danych z 2026-11-08: 360 ofert Vinted w 95 grupach o identycznym tytule.
- `stats()` w `edition-variants.mjs` liczy medianę ze wszystkich źródeł razem (nowe z Empiku, antykwariat, prywatne egzemplarze), bez stanu.
- `price-analysis.mjs` działa na starym modelu JSON odtwarzanym przez `sqliteHistoryModel` (9 miejsc użycia).
- `searchUrl` dla Vinted ustawia tylko `search_text` i `page`; harmonogram skanuje co 12 h pełne wyniki.
- Nazwy uniwersów (Warhammer, Warcraft, Świat Dysku…) są wpisane w ok. 25 modułach, m.in. `search-policy.mjs`, `work-grouping.mjs`, `title-proposals.mjs`, `edition-series.mjs`.
- `local-app.mjs` ma 67 warunków na ścieżkę; błąd tras `/api/sets/...` (changelog 20) wynikał z ręcznego dzielenia ścieżki.
- `ingestOffers` (`catalog-production.mjs`) przyjmuje równolegle `title`/`originalTitle`, `price`/`currentPrice`, `image`/`imageUrl`, `isbn`/`observedIsbn`.
- `findWorkByKey` (`work-grouping.mjs`) wczytuje wszystkie dzieła przy każdym wywołaniu; `markUnseenOffers` przeszukuje `matched_queries_json` przez `json_each`.
- `format:check` w `package.json` obejmuje tylko trzy pliki konfiguracyjne.
- Skala: 2378 ofert (Vinted 1664), 363 dzieła, 463 wydania, 10 potwierdzonych sprzedaży, 499 ofert w kolejce weryfikacji.

Nie sprawdzono, czy strony Vinted podają identyfikator sprzedawcy, datę wystawienia, liczbę polubień i wyświetleń, koszt dostawy ani czy wyniki da się sortować od najnowszych. Ustal to na plikach fixture, a jeśli ich nie ma — pojedynczymi żądaniami przez `readSourceHtml` (czyli przez bramkę). Pola, których strona nie podaje, pomiń i napisz o tym w raporcie.

## Etapy

### 0. Zabezpieczenie pracy

Uruchom `npm test`. Zatwierdź bieżący stan drzewa roboczego na obecnej gałęzi (wraz z nieśledzonymi plikami i migracjami 119–123), w sensownych commitach. Jeśli testy nie przechodzą przed Twoimi zmianami, zapisz które i nie naprawiaj ich w tym etapie.

### 1. Pełny zapis obserwacji oferty (najważniejsze)

Nowa migracja (kolejny numer po 123). Zapisuj dla każdej oferty, o ile źródło to podaje:

- stan egzemplarza: surowy tekst źródła oraz klasa (nowa / bardzo dobra / dobra / zadowalająca / nieznana);
- opłatę kupującego i koszt dostawy;
- identyfikator sprzedawcy;
- opis ogłoszenia i liczbę zdjęć — dla Vinted z już pobieranej strony szczegółów, bez dodatkowych żądań; ten sam opis ma zasilać `offer_descriptions`, żeby zestawy nie pobierały strony drugi raz;
- datę wystawienia, liczbę polubień i wyświetleń;
- rzeczywistą dostępność w Empiku zamiast `available: true`;
- surowy obiekt oferty z listy wyników i ze strony szczegółów (sam obiekt tej oferty, z limitem rozmiaru), przy pierwszym zapisie i przy zmianie — żeby dało się później odczytać pola, których dziś nie przewidujemy.

Uzupełnij stan dla istniejących ofert z `offer_enrichment.facts_json`. Do podsumowania skanu dodaj liczniki ofert odrzuconych przed zapisem, z podziałem na powód (język, temat, wykluczony produkt). Pola mają przejść całą drogę: parser → `parseMarketplace` → `searchOffers` → `ingestOffers` → `upsertOffer`, z testem, który sprawdza zapis w bazie, a nie tylko wynik parsera.

### 2. Wiarygodny sygnał sprzedaży na Vinted

- Historia stanów oferty w osobnej tabeli (stan, kiedy zaobserwowany), tak żeby sprzedaż miała przedział czasu „między ostatnim widzeniem a sprawdzeniem”.
- Drogie oferty sprawdzane wcześniej i częściej niż tanie; dobierz progi i opisz je w changelogu.
- Wykrywanie ponownych wystawień: nowa oferta tego samego sprzedawcy o tym samym tytule lub ISBN, która pojawia się po zniknięciu poprzedniej, jest z nią powiązana. Powiązanie ma być widoczne i odwracalne; nic nie jest przez nie odrzucane.

### 3. Statystyki cen, które porównują porównywalne

- Rodzaj oferty wynikający ze źródła: nowa w sklepie, antykwariat, prywatny egzemplarz — w jednym module.
- `workPriceOverview` liczy osobno dla każdego rodzaju i dla klas stanu; sprzedane na Vinted jako osobna, wyróżniona wartość.
- Statystyki cen w SQL. Usuń `price-analysis.mjs` ze ścieżki zapisu skanu i ogranicz `sqliteHistoryModel` do narzędzi historycznych.
- Ceny w jednej jednostce (grosze, liczby całkowite) w nowym kodzie; istniejących kolumn REAL nie migruj.

### 4. Szybki skan najnowszych ofert

Drugi tryb skanu: jedna strona wyników na frazę, od najnowszych, z własnym odstępem w harmonogramie (domyślnie wyłączony). Nie może oznaczać ofert jako zniknięte. Pełny skan zostaje bez zmian. Nowe oferty z tego trybu mają być widoczne w istniejącym pasku „Od ostatniej wizyty”.

### 5. Uniwersa w danych zamiast w kodzie

Najpierw zbierz wszystkie listy nazw uniwersów i ich warianty w jednym module, bez zmiany zachowania (istniejące testy mają przejść bez modyfikacji). Potem przenieś je do tabeli z obecnymi wartościami jako danymi początkowymi i edycją w „Katalog → Wydawcy i serie”.

### 6. Pomiar nisz

Rozszerz statystyki fraz (`scanQueryStats`) o: odsetek ofert sprzedanych w 14 dni, medianę ceny sprzedanych, liczbę ofert powyżej 50 zł. Widok ma pozwolić porównać profile skanu po kilku tygodniach.

### 7. Porządki techniczne

- Tabela tras zamiast łańcucha warunków w `local-app.mjs` i regexu przekierowującego do `trading-api.mjs`.
- Jeden kształt oferty na granicy `ingestOffers`, opisany typem JSDoc; sprawdzanie typów bez kroku budowania tylko dla ścieżki oferty i repozytorium.
- Naprawy danych przy starcie jako jednorazowe zadania z flagą wykonania (wzór: `bibliography_upgrade_v1` w `app_preferences`); zostaw przy każdym starcie tylko te, które muszą tak działać, i uzasadnij.
- Klucz dzieła w indeksowanej kolumnie zamiast wczytywania wszystkich dzieł w `findWorkByKey`.
- Tabela oferta–fraza zamiast przeszukiwania `matched_queries_json`.
- Sortowanie kolejki weryfikacji po cenie oferty.
- Na samym końcu, w osobnym commicie bez innych zmian: Prettier na całym kodzie i `format:check` obejmujący kod.

## Czego nie robić

- Nie zmieniaj stosu: Node, `node:sqlite`, frontend bez frameworka i bez bundlera zostają. Nie dodawaj zależności produkcyjnych.
- Nie przepisuj działających adapterów źródeł ani frontendu; nie dodawaj nowych źródeł.
- Nie rozwijaj funkcji handlowych (kalkulator zysku, ROI, rejestr transakcji) ani katalogowych (serie, osoby, wydawcy) poza tym, co wyżej.
- Nie obchodź blokad i CAPTCHA; każde żądanie do serwisu przez bramkę.
- Nie zbieraj wydań obcojęzycznych.
- Nie wysyłaj danych do usług zewnętrznych (np. powiadomień push).
- Pliki fixture ze stron serwisów zapisuj bez danych sprzedawców (zamień nazwy i identyfikatory na zmyślone).

## Jak pracować

- Jeden etap = osobne commity, wpis na górze `CHANGELOG.md` (po polsku, z liczbami z danych), aktualizacja README i `docs/REPOSITORY-MAP.md` przy nowych modułach i migracjach.
- Po każdym etapie `npm test`, `npm run lint`, `npm run check:syntax`.
- Efekt mierz na kopii bazy (`node scripts/backup-catalog.mjs <katalog tymczasowy>/copy.sqlite`), nigdy na bazie użytkownika. Podaj liczby przed i po.
- Automatyczne decyzje muszą być odwracalne i widoczne w „Ostatnie decyzje”; ręczne przypisania i zestawy zawsze wygrywają.

## Kiedy pytać

Tylko gdy: zmiana wymagałaby przekształcenia lub usunięcia istniejących danych użytkownika w sposób nieodwracalny; etap okazuje się niewykonalny bez złamania zasad z sekcji „Czego nie robić”; albo dwa etapy są ze sobą sprzeczne. W pozostałych przypadkach wybierz rozsądne rozwiązanie i opisz je w raporcie.

## Raport końcowy

Dla każdego etapu: co zrobiono, jak to sprawdzono (test, pomiar na kopii, odczyt prawdziwej strony), czego nie zrobiono i dlaczego, oraz które pola z etapu 1 okazały się niedostępne w źródłach. Na początku raportu lista rzeczy wymagających decyzji właściciela.
