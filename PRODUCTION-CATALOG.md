# BookFlip — produkcyjny katalog SQLite

## Obowiązujący przepływ

Lokalny serwer `local-app.mjs` zapisuje udane skany **bezpośrednio do SQLite**:

1. Zapis oferty i obserwacji ceny.
2. Zapis dowodów ISBN oraz zadania w `identification_jobs`.
3. Przetwarzanie kolejki poza transakcją zapisu skanu, z ograniczoną równoległością i limitami dostawców.
4. Zapis wydania albo skierowanie do weryfikacji, jeśli dowody są niejednoznaczne.

Nie ma produkcyjnego dual-write do `local-offer-history.json`. Historyczne narzędzia JSON są osobne. Nie trzeba korzystać z GitHub Actions do skanowania.

## Źródła metadanych

Identyfikacja sprawdza najpierw lokalny katalog ISBN, następnie Bibliotekę Narodową. Kolejne źródła (Open Library, e-ISBN, Google Books — ten ostatni tylko z kluczem `BOOKFLIP_GOOGLE_BOOKS_KEY`) są pytane dopiero po odpowiedzi BN `not_found`. ISBN, którego nie zna żadne z nich, jest w tle szukany po tytule na lubimyczytac.pl (`isbn-lookups.mjs`); liczy się tylko strona z tym samym ISBN, a wynik wypełnia jedynie formularz „Utwórz wydanie z ogłoszenia”. Awaria lub nieprawidłowa odpowiedź BN nie oznacza braku książki. Wyszukiwanie ISBN po tytule również korzysta najpierw z BN, a przy braku kandydatów z Open Library. Różnice między dostawcami nie blokują identyfikacji; przypisanie sprawdza wyłącznie ISBN, bez porównywania tytułu, autora, wydawcy, języka ani innych metadanych oferty. Nieprawidłowy ISBN i niejednoznaczne rekordy nadal wymagają wyjaśnienia.

## Lokalizacja danych

Domyślnie Windows: `%LOCALAPPDATA%\BookFlip\data\bookflip-catalog.sqlite`. Można nadpisać przez `BOOKFLIP_CATALOG_DB`. W nowej instalacji stary katalog `scan-results` **nie jest automatycznie importowany**.

Przed uruchomieniem niezaaplikowanych migracji istniejącej bazy wykonywany jest backup z kontrolą integralności. Kopie w `data/backups/` nie zastępują kopii poza urządzeniem. Nie zmieniaj ani nie usuwaj istniejących plików `migrations/*.sql` — ich sumy są zapisane w bazie.

## Konfiguracja

Jedyna pełna lista zmiennych środowiskowych (README tylko tu odsyła). Wartość `0` wyłącza daną funkcję; brak zmiennej oznacza ustawienie domyślne.

| Zmienna | Działanie |
| --- | --- |
| `BOOKFLIP_CATALOG_DB` | Jawna ścieżka bazy |
| `BOOKFLIP_CATALOG_ENABLED=0` | Wyłączenie katalogu |
| `BOOKFLIP_CATALOG_AUTO_RESOLVE=0` | Wyłączenie automatycznej identyfikacji |
| `BOOKFLIP_CATALOG_BATCH` | Liczba zadań w partii (domyślnie 25, maksymalnie 1000) |
| `BOOKFLIP_IDENTIFICATION_POLL_MS` | Odstęp sprawdzania bezczynnej kolejki (domyślnie 5000 ms); gotowe partie są przetwarzane bez tej przerwy |
| `BOOKFLIP_OPEN_LIBRARY_CONTACT` | Kontakt podawany przy żądaniach do Open Library |
| `BOOKFLIP_METADATA_TIMEOUT_MS` | Timeout zewnętrznych metadanych |
| `BOOKFLIP_CATALOG_LEASE_MS`, `BOOKFLIP_CATALOG_RETRY_MS` | Lease i opóźnienie ponowień |
| `BOOKFLIP_LOCAL_PORT` | Port lokalnego serwera (domyślnie 4317) |
| `BOOKFLIP_DETAIL_ENRICHMENT=0` | Wyłączenie pracy w tle czytającej strony serwisów: szczegóły ofert, propozycje po tytule, opisy zestawów, ISBN z lubimyczytac.pl |
| `BOOKFLIP_SCHEDULED_SCANS=0` | Wyłączenie harmonogramu automatycznych skanów |
| `BOOKFLIP_OFFER_LIFECYCLE=0` | Bez sprawdzania, czy znikające oferty są sprzedane/usunięte |
| `BOOKFLIP_E_ISBN=0` | Wyłączenie źródła e-ISBN |
| `BOOKFLIP_EDITION_GAPS=0` | Bez uzupełniania wydawcy i roku wydań ze źródeł metadanych (`edition-gaps.mjs`, co 10 minut po 6 wydań) |
| `BOOKFLIP_GOOGLE_BOOKS_KEY` | Klucz Google Books (bez klucza źródło jest pomijane) |
| `BOOKFLIP_AUTO_BACKUP=0`, `BOOKFLIP_BACKUP_DIR` | Wyłączenie codziennej kopii; drugi katalog kopii |
| `BOOKFLIP_CATALOG_SEEDS=0` | Bez zasilania katalogu z BN w tle |
| `BOOKFLIP_STARTER_PROFILES=0` | Bez profili startowych skanera |
| `BOOKFLIP_BUYBACK_AUTO=0` | Bez automatycznego pobierania cen skupu |
| `BOOKFLIP_STORAGE` | Tryb magazynu; jedyna dopuszczalna wartość to `sqlite` (domyślna) — inna przerywa start serwera błędem `SQLITE_ONLY_STORAGE_MODE` |
| `BOOKFLIP_TAILSCALE_HOST`, `BOOKFLIP_TAILSCALE_USER` | Ustawiane przez skrypt Tailscale (`docs/TAILSCALE.md`) |

## Zasady integralności

- Identyfikacja nie przypisuje oferty automatycznie na podstawie samego podobieństwa tytułu.
- Po obsłużeniu partii automat od razu przechodzi do następnej, jeśli istnieją gotowe zadania. Pauza i zatrzymanie są respektowane pomiędzy partiami, a obsługa HTTP otrzymuje czas procesora.
- Równoczesne zapytania o ten sam ISBN (także odpowiednik ISBN-10/13) współdzielą pobranie. Dane dzieł i autorów Open Library są dodatkowo przechowywane do godziny w ograniczonej pamięci procesu. Błędy nie są utrwalane w tym cache.
- Limity zapytań do każdego dostawcy pozostają zachowane i są wspólne dla wyszukiwania po ISBN i po tytule. Nie przyspieszamy identyfikacji przez pomijanie kontroli konfliktów.
- Pasek pokazuje udział zadań obsłużonych przez automat. `review_required` oznacza oczekiwanie na decyzję użytkownika, a nie trwającą pracę automatyczną; błąd zakończonego zadania również nie jest prezentowany jako aktywna kolejka.
- Dokładny ISBN może pozwolić powiązać wydanie pomimo nieistotnych różnic zapisu tytułu; sprzeczne dowody mogą wymagać decyzji ręcznej.
- Ręczne przypisania i zestawy są chronione przed ponownym automatycznym przypisaniem do pojedynczej książki.
- Zestaw ma własny zapis powiązań do wielu wydań; cena nadal dotyczy całej oferty.
- `GET /api/catalog/status` zwraca liczniki i diagnostykę kolejki; w Ustawieniach dostępne jest ręczne ponowienie identyfikacji.

## Diagnostyka i testy

Log serwera: `%LOCALAPPDATA%\BookFlip\data\local-app.log`. Przed zakończeniem pracy uruchom `npm run verify` (lint, typy, formatowanie, testy); start interfejsu w Chromium sprawdza `node scripts/browser-smoke.mjs`. Te testy nie gwarantują, że zewnętrzny portal aktualnie pozwala na skanowanie.

## Weryfikacja i katalog (od 2026-11-07)

- BN jest pytana o każdą równoważną formę ISBN (13- i 10-cyfrową). Odpowiedź "nie znaleziono" oznacza, że żadna forma nie zwróciła rekordu.
- Ważny ISBN nieznany BN i Open Library nie zamyka zadania: oferta zostaje w weryfikacji z powodem „ISBN nieznany źródłom”.
- ISBN ze strony szczegółów jest uznawany wyłącznie z danych strukturalnych produktu. Pliki fixture: `fixtures/details/`.
- Propozycje po tytule (tabela `title_proposals`) nigdy nie przypisują oferty same; służą do wypełnienia pola ISBN i uruchomienia zwykłego podglądu.
- Nowe wydanie o tym samym tytule i pierwszym autorze co istniejące dzieło trafia do tego dzieła (powód `same_title_and_author_work`). Niejednoznaczny klucz (kilka takich dzieł) nie jest łączony automatycznie.
- Ceny ≥ 10 000 zł są traktowane jako nieznane (`MAX_PLAUSIBLE_PRICE_GROSZE`).
