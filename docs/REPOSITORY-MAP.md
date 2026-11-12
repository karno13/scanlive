# Mapa repozytorium — aktualny BookFlip

**Kierunek produktu:** [handel książkami, nie zarządzanie prywatną kolekcją](PRODUCT-DIRECTION.md). Katalog, serie i wydania są narzędziami identyfikacji oraz wyceny towaru.

## Aktywna aplikacja

| Warstwa | Pliki |
| --- | --- |
| Uruchamianie | `Uruchom BookFlip Scanner.cmd`, `local-app.mjs` (tabela tras `localRoutes`), `router.mjs` (tabela tras: wzorce `/api/x/:id`, kolejność, dekodowanie parametrów) |
| Frontend, 6 zakładek (Dziś, Kolejka, Książki, Oferty, Źródła, Ustawienia) | `app/index.html`, `app/app.css`, `app/app.js`, `app/views/*.js` |
| Skanowanie | `marketplaces.mjs` (adaptery, `readSourceHtml`), `marketplace-gate.mjs` (wspólne, adaptacyjne tempo na źródło), `local-scan.mjs`, `vinted-detail.mjs`, `source-blocks.mjs` + `scan-diagnostics.mjs` (blokady, przebieg skanu), `language-policy.mjs` („Tylko polskie wydania”) |
| SQLite | `catalog-production.mjs` (otwarcie bazy), `startup-jobs.mjs` (naprawy danych jako zadania jednorazowe z flagą; co start tylko to, co musi), `offer-ingest.mjs` (jedyna droga zapisu ofert ze skanu, typ `ScannedOffer`; `npm run typecheck`), `sqlite-catalog-repository.mjs`, `catalog-api.mjs` (odczyty list, kolejka weryfikacji), `trading-api.mjs` (mniejsze trasy `/api/...`), `offer-sets.mjs` |
| ISBN / metadane | `catalog-resolver.mjs`, `identification-worker.mjs`, `metadata-lookup.mjs`, `metadata-sources/` (BN → Open Library → e-ISBN → Google Books; `lubimyczytac.mjs` tylko przez `isbn-lookups.mjs` dla nieznanych ISBN), `publisher-names.mjs` + `name-aliases.mjs` (jedna pisownia wydawców i serii) |
| Weryfikacja (od 2026-11-07) | `title-proposals.mjs` (propozycje po tytule), `offer-enrichment.mjs` + `source-details.mjs` (dane ze strony produktu), `offer-editions.mjs` (wydania z ogłoszeń, gdy nikt nie zna ISBN), `game-material.mjs` (podręczniki do gier i wydania obcojęzyczne), `edition-series.mjs` (cykl i tom z ogłoszeń i e-ISBN), `app/views/review.js` + `review-bulk.js` (zakładki, „Zatwierdź pewne…”, zaznaczanie wielu), `bundle-detection.mjs` (zestawy po słowach i po dwóch tytułach z katalogu), `rejected-offers.mjs` (powtórki odrzuconych ofert), `catalog-api.mjs` → `listIdentificationJobs` z `view=list` (kolejka stronicowana na serwerze: jedna pozycja na decyzję, rozmiary grup fraz, „pominięte” w `app_preferences.review_skipped`) i `approveJobAsBook` (klawisz N: książka bez ustalonego wydania) |
| Katalog: braki wydań | `edition-gaps.mjs` (wydawca i rok z e-ISBN, Google Books i stron produktu; tabele `edition_field_fills`, `edition_gap_checks`; cofanie partii), `catalogGaps` w `catalog-insights.mjs` (`GET /api/catalog/gaps`, filtr `gap=` listy dzieł) |
| Katalog: dzieła i duplikaty | `work-grouping.mjs`, `distinct-works.mjs` („To różne książki”, `distinct_work_pairs`, odwracalne), `app/views/duplicates.js`, `app/views/catalog-names.js` (wydawcy, serie i uniwersa) |
| Uniwersa | `universes.mjs` — tabela `universes` (nazwy, serie wydawnicze, cykle i postacie); z niej wszystkie listy nazw uniwersów używane przez `bn-marc`, `catalog-series`, `edition-series`, `offer-editions`, `rejected-offers`, `search-policy`, `title-consistency`, `title-proposals`, `work-grouping` |
| Katalog: wydania i ceny książki | `edition-variants.mjs` (warianty cenowe, „Wydanie nieustalone”, wybór wydania z ogłoszenia), `offer-kinds.mjs` (rodzaj oferty: nowa w sklepie / antykwariat / prywatna), `price-stats.mjs` (statystyki cen w SQL, w groszach), `app/views/work-prices.js` |
| Historia (narzędzia) | `sqlite-history-read.mjs` (`sqliteHistoryModel`) + `price-analysis.mjs` — tylko eksport „Historia ofert” (`/api/history`), `/api/book` i dawne odpowiedzi `/api/catalog` bez `compact`; nie w ścieżce skanu |
| Zestawy | `offer-sets.mjs` (`dismissOfferSet`: „Nie interesuje mnie” z listy, `POST /api/sets/:offerId/dismiss`), `set-descriptions.mjs` (skład z opisu ogłoszenia), `app/views/sets.js` |
| Obserwacje ofert | `offer-observations.mjs` (stan egzemplarza i jego klasa, opłata kupującego, sprzedawca, zdjęcia, data wystawienia, polubienia, surowe obiekty ogłoszenia w `offer_raw_snapshots`) |
| Sygnał sprzedaży | `offer-status.mjs` (historia stanów oferty, przedział sprzedaży, ponowne wystawienia, progi sprawdzania wg ceny), `offer-lifecycle.mjs` (sprawdzanie stron ofert: Vinted, Tezeusz, Empik, Allegro Lokalnie; kod dostępności z listy Empiku i Dedalusa; `source-blocks.mjs` → `NO_LEGAL_ACCESS` dla Allegro i OLX), `offer-availability.mjs` |
| Oferty | `app/views/offers.js` (lista ofert; grupowanie „Wg książki”: `GET /api/offer-groups`) |
| Skaner: harmonogram i jakość | `scan-schedule.mjs` (pełny skan i szybki skan najnowszych — `mode: 'newest'`, `NEWEST_ORDER_SOURCES` w `marketplaces.mjs`), `offer-availability.mjs`, `app/views/scan-schedule.js` |
| Zdjęcia i okładki | `offer-images.mjs` (walidacja URL, proxy `/api/image` z cache, mniejszy wariant z serwisu dla miniatur `thumb=1` — Allegro `s180`, Tezeusz `product_thumb`, reszta oryginał, `og:image`; okładka po ISBN `/api/cover`: zdjęcie zapisanej oferty tej książki, potem Open Library, a gdy brak — przezroczysty obrazek 1×1), `app/core/bibliography.js` (czyste etykiety BN, okładki; `thumbnailSrc` dla okładek do 56 px), `app/views/review-photo.js` (powiększenie zdjęcia w weryfikacji, zdjęcie obok okładki propozycji) |
| Pliki statyczne | `static-asset-path.mjs` (które ścieżki wolno podać), `static-files.mjs` (gzip, `ETag`, odpowiedź 304, `Cache-Control: no-cache`) |
| Pulpit i paleta | `catalog-insights.mjs` (`/api/catalog/insights`), `app/views/dashboard.js` (zwinięty „Stan katalogu” na dole ekranu Dziś), `app/views/palette.js` (bez trafień: skan, szukanie, dodanie przez ISBN), `app/core/preferences.js` |
| Ekran „Dziś” | `today.mjs` (`GET /api/today?since=`: nowe oferty i zmiany cen od ostatniej wizyty — z filtrami listy, kolejka, źródła, ostatni i następny skan), `source-status.mjs` (`GET /api/source-status`: czy źródło działa, od kiedy nie i dlaczego), `catalog-measures.mjs` (cztery miary z trendem, tabela `metric_snapshots`), `app/views/today.js`, `app/views/since-last-visit.js` (moment poprzedniej wizyty) |
| Kolejka | `app/views/queue.js` (zakładki typów nad Weryfikacją, Zestawami i `#view-checks` — podejrzane przypisania i duplikaty dzieł; wspólne skróty), `GET /api/queue/summary` (`queueSummary` w `trading-api.mjs`) |
| Decyzje wsadowe | `review-batches.mjs` (`POST /api/review-batches/{quick,add}/plan` i `/apply`, `GET /api/review-batches`, `POST /api/review-batches/:id/undo`; tabele `review_batches`, `review_batch_decisions`), `app/views/review-batch.js` (siatka kart w „Szybkie” i „Do dodania”) |
| Reguły odrzucania | `rejection-rules.mjs` (tabela `rejection_rules`, `/api/rejection-rules`; działa po każdym przebiegu identyfikacji, decyzje z `created_by = rejection_rule:<id>`), `app/views/reject-rule.js` (okno „Odrzuć z regułą…”, lista w Ustawieniach) |
| Aktualizacje na żywo | `live-events.mjs` (`GET /api/events`, server-sent events: `scan`, `queue`, `source`; serwer porównuje odciski co 2 s tylko wtedy, gdy ktoś słucha), `app/core/live.js` (EventSource, ponowne łączenie i pełny odczyt stanu po powrocie) |
| Trwały katalog danych / backup | `catalog-data-location.mjs`, `scripts/backup-catalog.mjs` |
| Migracje — zachować | `migrations/001_catalog.sql` … `007_offer_sets.sql`, `099`–`132`; nowa migracja = kolejny numer, nigdy edycja istniejącej |
| Testy Node | `*.test.mjs`, `test/*.test.js`, `scripts/run-tests.mjs`, `.github/workflows/scanner-tests.yml` |
| Test startu interfejsu | `scripts/browser-smoke.mjs` (włącza tryb handlu w `localStorage`, bo sprawdza kalkulator i cenę docelową; kontrast tekstu w obu motywach), `.github/workflows/browser-smoke.yml` |
| Kolory i motywy | `app/app.css`, sekcja „v5.1 Tokeny i motywy”: każdy kolor to zmienna, motyw ciemny zmienia tylko ich wartości; pilnuje tego `theme-tokens.test.mjs` |
| Publiczne demo | Osobna gałąź `gh-pages` — bez produkcyjnego API |

## Elementy historyczne

Nieaktywny runner GitHub (`run.mjs`, `process.mjs`, `continuation.mjs`, `enrich.mjs`, `page-cursor.mjs`) oraz jego dwa testy zostały usunięte. Nie obsługiwał lokalnego BookFlip ani żadnego osiągalnego workflow w tym repozytorium. Zachowano odrębnie testowane narzędzia parsowania kanałów (`feed.mjs`, `rss.mjs`) oraz aktualne moduły skanera.

Narzędzia importu JSON i prób migracji są historyczne, lecz nadal przydatne do analizy dawnych danych. Stare raporty projektowe przeniesiono do `docs/archive/`; usunięto nieaktywną instrukcję GitHub runnera, zrzuty i kopie dawnych arkuszy CSS. W `docs/archive/` zachowano jedynie dokumentację dawnej migracji JSON ze względu na aktywne odnośniki. Usunięte materiały są nadal dostępne w historii Git.

Workflow `source-connectivity.yml` i `buyback-test.yml` są odrębnymi testami łączności z portalami, a nie właściwym skanowaniem użytkownika.

## Pomiary wygody interfejsu

- `scripts/ux-review-measure.mjs` — zrzuty i pomiary na kopii bazy, serwer na porcie 4399.
- `scripts/ux-shots.mjs` — zrzuty widoków przy 1440×900 i 390×844 w obu motywach z kontrolą poziomego przewijania i celów dotykowych poniżej 44 px.
- `scripts/measure-quick-tab.mjs` — liczba akcji potrzebnych do rozstrzygnięcia zakładki „Szybkie” (na kopii bazy: zapisuje decyzje).
- `scripts/page-settle.mjs` — czekanie na ciszę w sieci z pominięciem strumienia `/api/events` (Playwright nie doczeka się „networkidle” przy otwartym SSE).
- `docs/SOURCES-ACCESS-2026-11.md` — rozpoznanie legalnego dostępu do Allegro i OLX.
- `scripts/measure-network.mjs` — zapytania i bajty przy starcie, po przejściu przez widoki i po odświeżeniu (`--legacy` naśladuje serwer sprzed etapu 0: bez miniatur, gzip i 304).
- `scripts/ux-review-contact.mjs` — zestawienia wykonanych zrzutów do kontroli wizualnej.
- `scripts/ux-review-acceptance.mjs` — kontrola układu i ścieżek interfejsu przy 390, 1100, 1440 i 1920 px.
- `docs/UX-REVIEW-2026-11.md` — wyniki sześciu etapów i wyjaśnienie liczników.

## Bezpieczne sprzątanie

1. Usuwaj tylko nieużywane komponenty z potwierdzonym brakiem importów w aplikacji, testach i CI.
2. **Nigdy nie usuwaj ani nie modyfikuj historycznych migracji SQL**.
3. Nie publikuj plików SQLite, skanów, danych użytkownika, plików WAL ani tokenów.
4. Każda zmiana wymaga testów Node na Linux/Windows i smoke Chromium.

- `empik-references.mjs` — odwracalne przypisanie cen odniesienia Empiku do dzieła (wydanie nieustalone), z ochroną wcześniejszych decyzji, aktywnych przypisań i zestawów; `empik-references.test.mjs` sprawdza cofnięcie i brak ponowienia.

- `scripts/windows-autostart.ps1` — opcjonalne zadanie logowania Windows: Status/Enable/Disable oraz uruchomienie serwera w tle; nigdy nie rejestrowane automatycznie przez aplikację.
