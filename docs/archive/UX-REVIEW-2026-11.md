# Poprawki wygody pracy — 11 listopada 2026

Praca na gałęzi `ux-review-improvements`, bez commitów i bez cofania zastanych zmian.
Jednorazowa kopia utworzona przez `scripts/backup-catalog.mjs`:
`scratch/ux-review-20261111/copy.sqlite` (2493 oferty, 364 dzieła, 144 zestawy).
Serwer pomiarowy: port 4399, wyłączone automatyczne rozpoznawanie, wzbogacanie,
skany harmonogramu, cykl ofert, kopie automatyczne, zasilanie katalogu i skup.
Baza użytkownika była wyłącznie źródłem kopii, otwartym do odczytu przez skrypt backupu.

## Wyniki etapów

| Etap | Przed | Po | Odbiór |
| --- | --- | --- | --- |
| 1. Weryfikacja | Lista od 374 px, 5 pełnych pozycji; akcje kończą się na 1105 px | Po etapie: lista od 250 px, 6 pozycji, akcje do 809 px; końcowo lista od 218 px | Tak |
| 1. Telefon | Zatwierdzenie na 1271–1315 px | Zatwierdzenie na 677–721 px, cała grupa do 779 px nad nawigacją | Tak |
| 2. Liczniki | 281 / 237 / 506 pod podobnymi etykietami | Wspólna kolejka: 237 decyzji, 281 ofert | Tak |
| 3. Zestawy | Strona 13990 px; wiersz 151 px; 3 książki | Strona 900 px; wiersz 58 px; 7 z 9 książek | Tak |
| 4. Oferty | Karty około 89 px; około 7 pozycji; 25 na stronę | Tabela 37 px; 14 pełnych pozycji; 50 na stronę | Tak |
| 5. Katalog | Wiersz 143 px; 5 dzieł; telefon od 538 px | Wiersz 70 px, maks. 83,1 px w pierwszych 100; zwarty 62,9 px; 9 dzieł; telefon po etapie od 330 px, końcowo 318 px | Tak |
| 6. Wspólne style | Metadane 11–12 px; selektor ustawień 902,2 px; zwinięta karta 101,5 px | Wspólna skala metadanych 13 px; selektor 260 px; karta 82 px; brak przepełnienia strony przy 390 px | Tak |

Pomiary etapów i zrzuty obu motywów: `artifacts/ux-review/stage1` do `stage5`.
Każdy z pięciu punktów etapu 6 ma osobne zrzuty wszystkich sześciu widoków:
`artifacts/ux-review/stage6-1` do `stage6-5`. Pliki `contact-*.png` zestawiają je do
oglądania. Końcowe pomiary: `artifacts/ux-review/final/metrics.json`.
Sprawdzenie ścieżek przy 1440×900, 1920×1080, 1100×900 i 390×844 w obu motywach:
`artifacts/ux-review/acceptance/results.json`.

## Co liczyły różne wartości

Prześledzono `catalog-api.mjs`, trasę statusu w `local-app.mjs`,
`app/app.js`, widoki weryfikacji, skanera i panel statystyk oraz
`app/core/identification-progress.js`:

- **506**: zadania `review_required` wszystkich źródeł w statystykach identyfikacji,
  w tym **225 referencji Empiku**. Postęp uruchomienia automatu może dodatkowo mieć
  własny zakres czasowy. Ten licznik nie oznacza ręcznej kolejki operatora.
- **281**: oferty oczekujące w ręcznej kolejce, bez Empiku. Nawigacja oraz pasek
  „Od ostatniej wizyty” liczyły te oferty.
- **237**: decyzje po połączeniu ofert z tym samym ISBN, gdy powód dotyczy samego ISBN
  (np. brak opisu w źródłach). Jedna decyzja może obejmować kilka ofert.

To różne jednostki i zakresy, nie utrata ofert. Błędem było podpisywanie ich tak samo.
`reviewQueueSummary()` oblicza globalną ręczną kolejkę w jednym miejscu; korzystają
z niej status, paginacja i statystyki. Nawigacja, katalog, skaner, pasek identyfikacji
i nagłówek weryfikacji używają liczby decyzji. Liczby ofert i zadań pozostały jako
jednoznacznie nazwane informacje pomocnicze. Filtry i tymczasowe pominięcie nie zmieniają
globalnej liczby nierozstrzygniętych decyzji; zmieniają bieżącą listę.

## Dlaczego tabela ofert była ukryta

W CSS były dwie bezwarunkowe deklaracje `.offers-table-wrap { display: none }`
oraz `.offers-mobile-list { display: block }`. Wymuszały karty niezależnie od szerokości.
Nagłówki sortujące, HTML tabeli i obsługa zdarzeń już istniały. Kod nie dokumentuje
uzasadnienia produktowego tej decyzji; można potwierdzić przyczynę techniczną, nie intencję.
Nowa końcowa reguła przełącza widoki przy 901 px. Karty telefonu zachowują swój renderer.

## Testy i świadome aktualizacje

- `review-queue-paging.test.mjs`: liczba globalnych decyzji zamiast ofert; nowy przypadek
  z referencją Empiku, filtrem i tymczasowo pominiętą ofertą.
- `review-error-handling.test.mjs`: katalog korzysta ze wspólnej kolejki decyzji,
  zamiast wymagać starej etykiety „ofert do decyzji”.
- `mobile-bottom-navigation.test.mjs`: Zestawy są główną pozycją, tylko Ustawienia
  wymagają przycisku „Więcej”.
- `scripts/browser-smoke.mjs`: desktop otwiera ofertę z tabeli; Zestawy są dostępne
  bez menu; nakładane narzędzia zamyka się przed wyborem pozycji pod nimi. Kontrola
  kontrastu nadal obejmuje wszystkie widoki, oba motywy i obie szerokości.
  Celowo opóźnione pobranie serii sprawdza też natychmiastowe otwarcie wydania i powrót do dzieła.
- Zachowano test widoczności nieaktywnych widoków; jego pierwszy błąd usunięto
  przez jawne `:not([hidden])`, bez osłabiania testu.

Po etapach 1–5: 639/639 testów. Po etapie 6: 640/640, w tym testy zestawów,
niezapisanych zmian i tokenów motywu. Kontrole końcowe są zapisane w
`scratch/ux-review-20261111/`.

Końcowo przeszły: `npm test` (640/640), `npm run check:syntax` (318 modułów),
`npm run typecheck`, `npm run lint`, `npm run format:check`,
`node scripts/browser-smoke.mjs` (w tym kontrast przy 1440×900 i 390×844 w obu motywach)
oraz `node scripts/ux-review-acceptance.mjs` (8 kombinacji rozmiaru i motywu).

## Przyjęte warianty

- Wiersze ofert mają 37 px, czyli mniej niż dopuszczalne 48 px; zachowano natywny
  przycisk tytułu do obsługi klawiaturą oraz klikalność całego wiersza.
- Zdjęcie zestawu przeniesiono do nagłówka, aby skład miał pełną szerokość.
- Statystyki fraz mają ograniczone przewijanie i przyklejone nagłówki zamiast paginacji.
  Szerokie tabele przewijają się we własnym kontenerze; strona telefonu nie przewija się poziomo.
- Narzędzia weryfikacji i historia są nakładane; zamykają się także po kliknięciu poza
  nimi lub naciśnięciu Escape.
- Nie zmieniano logiki decyzji, resolvera, handlu ani migracji. Czynności zatwierdzania,
  odrzucania i zmiany składu sprawdzają istniejące izolowane testy, bez wykonywania
  tych operacji na bazie użytkownika.
- Dodatkowo naprawiono wykryty wyścig: widoczne przyciski wydań dostawały obsługę
  kliknięcia dopiero po pobraniu danych edytora serii. Teraz reagują od razu;
  wolne dane pomocnicze nie blokują otwarcia wydania.

## Etap 7 — po drugim przeglądzie (ten sam dzień)

Przegląd na świeżych zrzutach wszystkich widoków (1440×900 i 390×844) wykazał, że po zagęszczeniu
list największe straty wygody zostały w samej decyzji.

| Miejsce | Przed | Po |
| --- | --- | --- |
| Weryfikacja, ISBN nieznany źródłom | „Zatwierdź” wyszarzony, „Utwórz wydanie i przypisz” poniżej zgięcia (445 z 779 px), Enter bez skutku | Przypięty przycisk przejmuje akcję; Enter tworzy wydanie (na kopii: 237 → 236 decyzji, 281 → 278 ofert) |
| Weryfikacja, brak wyboru | Wyszarzony przycisk bez wyjaśnienia | Jedno zdanie pod przyciskami: czego brakuje |
| Propozycje różniące się tylko ISBN | Dwie identyczne karty | Adnotacja i wyróżniony ISBN; tytuł najwyżej w dwóch wierszach |
| Oferty | „Wymaga decyzji” / „Do sprawdzenia” / „—” dla tego samego stanu | Jedna funkcja `offerState` i kolumna „Stan” |
| Listy | „Wymaga decyzji” w każdym wierszu kolejki; czerwone „pusty” przy 92 ze 144 zestawów | Tylko wyróżniki |
| Telefon, zestaw | Podpis zdjęcia w kolumnie 72 px (ramka 72×237 px); przypięte akcje 130 px | Zdjęcie obok tytułu, jeden odnośnik, akcje w treści |
| Telefon, nawigacja | Ustawienia za oknem „Więcej” | Sześć pozycji w pasku |
| Telefon, cele dotykowe | 9 (skaner), 9 (katalog), 4 (weryfikacja), 3 (zestawy), 2 (oferty) poniżej 44 px | 0 we wszystkich sześciu widokach |

Świadomie bez zmian: lista katalogu już jest przyklejona pod paskiem (reguła z etapu 5), więc nie
wymagała osobnych paneli; przyciski „Nowe oferty / Zmiany cen” w karcie „Ostatni skan” zostały,
bo prowadzą do przefiltrowanych Ofert, a nie tylko powtarzają panel obok. Okno „Więcej” pozostało
w HTML (niewidoczne) dla zgodności testu nawigacji.

Kontrole: `npm test` (644/644), lint, typecheck, format:check, check:syntax, browser-smoke.
