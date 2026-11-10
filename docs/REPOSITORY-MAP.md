# Mapa repozytorium — aktualny BookFlip

**Kierunek produktu:** [handel książkami, nie zarządzanie prywatną kolekcją](PRODUCT-DIRECTION.md). Katalog, serie i wydania są narzędziami identyfikacji oraz wyceny towaru.

## Aktywna aplikacja

| Warstwa | Pliki |
| --- | --- |
| Uruchamianie | `Uruchom BookFlip Scanner.cmd`, `local-app.mjs` |
| Frontend, 6 zakładek | `app/index.html`, `app/app.css`, `app/app.js`, `app/views/*.js` |
| Skanowanie | `marketplaces.mjs` (adaptery, `readSourceHtml`), `marketplace-gate.mjs` (wspólne, adaptacyjne tempo na źródło), `local-scan.mjs`, `vinted-detail.mjs`, `source-blocks.mjs` + `scan-diagnostics.mjs` (blokady, przebieg skanu), `language-policy.mjs` („Tylko polskie wydania”) |
| SQLite | `catalog-production.mjs` (start: migracje i naprawy danych przy uruchomieniu), `sqlite-catalog-repository.mjs`, `catalog-api.mjs` (odczyty list, kolejka weryfikacji), `trading-api.mjs` (mniejsze trasy `/api/...`), `offer-sets.mjs` |
| ISBN / metadane | `catalog-resolver.mjs`, `identification-worker.mjs`, `metadata-lookup.mjs`, `metadata-sources/` (BN → Open Library → e-ISBN → Google Books; `lubimyczytac.mjs` tylko przez `isbn-lookups.mjs` dla nieznanych ISBN), `publisher-names.mjs` + `name-aliases.mjs` (jedna pisownia wydawców i serii) |
| Weryfikacja (od 2026-11-07) | `title-proposals.mjs` (propozycje po tytule), `offer-enrichment.mjs` + `source-details.mjs` (dane ze strony produktu), `offer-editions.mjs` (wydania z ogłoszeń, gdy nikt nie zna ISBN), `game-material.mjs` (podręczniki do gier i wydania obcojęzyczne), `edition-series.mjs` (cykl i tom z ogłoszeń i e-ISBN), `app/views/review.js` + `review-bulk.js` (zakładki, „Zatwierdź pewne…”, zaznaczanie wielu), `bundle-detection.mjs` (zestawy po słowach i po dwóch tytułach z katalogu), `rejected-offers.mjs` (powtórki odrzuconych ofert) |
| Katalog: dzieła i duplikaty | `work-grouping.mjs`, `app/views/duplicates.js`, `app/views/catalog-names.js` (wydawcy i serie) |
| Katalog: wydania i ceny książki | `edition-variants.mjs` (warianty cenowe, „Wydanie nieustalone”, wybór wydania z ogłoszenia), `app/views/work-prices.js` |
| Zestawy | `offer-sets.mjs`, `set-descriptions.mjs` (skład z opisu ogłoszenia), `app/views/sets.js` |
| Oferty | `app/views/offers.js`, `app/views/offer-groups.js` („Wg książki”, `GET /api/offer-groups`) |
| Skaner: harmonogram i jakość | `scan-schedule.mjs`, `offer-availability.mjs`, `app/views/scan-schedule.js` |
| Zdjęcia i okładki | `offer-images.mjs` (walidacja URL, proxy `/api/image` z cache, `og:image`), `app/core/bibliography.js` (czyste etykiety BN, okładki) |
| Pulpit i paleta | `catalog-insights.mjs` (`/api/catalog/insights`), `app/views/dashboard.js`, `app/views/palette.js`, `app/core/preferences.js` |
| Trwały katalog danych / backup | `catalog-data-location.mjs`, `scripts/backup-catalog.mjs` |
| Migracje — zachować | `migrations/001_catalog.sql` … `007_offer_sets.sql`, `099`–`123`; nowa migracja = kolejny numer, nigdy edycja istniejącej |
| Testy Node | `*.test.mjs`, `test/*.test.js`, `scripts/run-tests.mjs`, `.github/workflows/scanner-tests.yml` |
| Test startu interfejsu | `scripts/browser-smoke.mjs` (włącza tryb handlu w `localStorage`, bo sprawdza kalkulator i cenę docelową), `.github/workflows/browser-smoke.yml` |
| Publiczne demo | Osobna gałąź `gh-pages` — bez produkcyjnego API |

## Elementy historyczne

Nieaktywny runner GitHub (`run.mjs`, `process.mjs`, `continuation.mjs`, `enrich.mjs`, `page-cursor.mjs`) oraz jego dwa testy zostały usunięte. Nie obsługiwał lokalnego BookFlip ani żadnego osiągalnego workflow w tym repozytorium. Zachowano odrębnie testowane narzędzia parsowania kanałów (`feed.mjs`, `rss.mjs`) oraz aktualne moduły skanera.

Narzędzia importu JSON i prób migracji są historyczne, lecz nadal przydatne do analizy dawnych danych. Stare raporty projektowe przeniesiono do `docs/archive/`; usunięto nieaktywną instrukcję GitHub runnera, zrzuty i kopie dawnych arkuszy CSS. W `docs/archive/` zachowano jedynie dokumentację dawnej migracji JSON ze względu na aktywne odnośniki. Usunięte materiały są nadal dostępne w historii Git.

Workflow `source-connectivity.yml` i `buyback-test.yml` są odrębnymi testami łączności z portalami, a nie właściwym skanowaniem użytkownika.

## Bezpieczne sprzątanie

1. Usuwaj tylko nieużywane komponenty z potwierdzonym brakiem importów w aplikacji, testach i CI.
2. **Nigdy nie usuwaj ani nie modyfikuj historycznych migracji SQL**.
3. Nie publikuj plików SQLite, skanów, danych użytkownika, plików WAL ani tokenów.
4. Każda zmiana wymaga testów Node na Linux/Windows i smoke Chromium.
