# BookFlip — skaner ofert i katalog książek

BookFlip to lokalna aplikacja na Windows, która skanuje oferty używanych książek, rozpoznaje książki i wydania (ISBN, tytuł, seria, tom) i prowadzi katalog w bazie SQLite, z interfejsem w przeglądarce. Główny serwer to `local-app.mjs`. **GitHub Pages jest tylko demonstracją**, nie uruchamia skanów ani nie przechowuje Twojego katalogu.

## Cel produktu i bieżący priorytet

**Teraz rozwijamy skaner, katalog i weryfikację:** pokrycie i niezawodność źródeł, strukturę dzieł, wydań i serii oraz szybkość i trafność rozpoznawania książek. Funkcje stricte handlowe (ocena okazji, zysk, rejestr transakcji, alerty zakupowe) są odłożone i domyślnie ukryte.

Cel docelowy się nie zmienia: BookFlip ma wspierać handel używanymi książkami, a nie prowadzenie prywatnej kolekcji. Katalog, serie i zestawy służą identyfikacji i wycenie towaru; **nie planujemy funkcji dla kolekcjonerów** (prywatne półki, brakujące tomy do własnego zbioru, statystyki czytania). Zasady decyzji, cel docelowy i lista celów poza zakresem: [Kierunek produktu](docs/PRODUCT-DIRECTION.md).

## Uruchomienie (Windows 11)

1. Zainstaluj Node.js **24 LTS (zalecany)** albo **22.16 lub nowszy z gałęzi 22**. W Node 22 moduł `node:sqlite` pozostaje eksperymentalny; wymagane API kopii SQLite pojawiło się w 22.16. Node 23 nie jest wspierany.
2. Pobierz aktualne repozytorium i rozpakuj je w osobnym folderze aplikacji.
3. Uruchom **`Uruchom BookFlip Scanner.cmd`** (lub `npm start`).
4. Otwórz `http://127.0.0.1:4317`.

Pozostaw serwer uruchomiony, gdy skanujesz lub identyfikujesz książki. Aplikacja domyślnie nasłuchuje **wyłącznie na localhost**; nie udostępniaj portu 4317 bez osobnego, przetestowanego rozwiązania uwierzytelnienia i sieci prywatnej.

Ustawienia przez zmienne środowiskowe (port, wyłączanie zadań w tle, klucze źródeł, druga kopia zapasowa) opisuje tabela w [PRODUCTION-CATALOG.md](PRODUCTION-CATALOG.md#konfiguracja).

### Dostęp z telefonu (Tailscale)

BookFlip można otworzyć z telefonu przez **prywatną sieć Tailscale i Tailscale Serve** (HTTPS, bez publicznego portu, bez Funnel). Na komputerze i telefonie potrzebny jest Tailscale na tym samym koncie; komputer musi być włączony.

Na Windows zamknij stary serwer BookFlip i uruchom **`Uruchom BookFlip przez Tailscale.cmd`**. Skrypt wykryje adres MagicDNS i konto właściciela, uruchomi prywatne proxy `tailscale serve --bg 4317` i lokalny serwer w trybie zgodnym z Tailscale. Na telefonie włącz Tailscale i otwórz wyświetlony adres HTTPS. Działanie lokalne na `127.0.0.1` pozostaje bez zmian.

**Nie stosuj `tailscale funnel`, przekierowania portu ani `0.0.0.0`.** Serwer dopuszcza wyłącznie dokładny host Tailscale Serve i tożsamość właściciela, nadal nasłuchując wyłącznie na localhost. Szczegóły konfiguracji, wyłączania i rozwiązywania problemów: [BookFlip przez Tailscale na telefonie](docs/TAILSCALE.md).

## Obszary aplikacji

Sześć zakładek (jak w `app/index.html`): **Dziś**, **Kolejka**, **Książki**, **Oferty**, **Źródła**, **Ustawienia**. Aplikacja otwiera się na ekranie **Dziś**.

- **Dziś** — co zmieniło się od ostatniej wizyty: nowe oferty i zmiany cen, liczba decyzji w kolejce, stan każdego źródła (czy działa, a jeśli nie, od kiedy i dlaczego), ostatni i następny skan oraz cztery miary z trendem. Każdy kafel otwiera przefiltrowaną listę; na telefonie przycisk „Nowy skan” otwiera formularz skanu.
- **Kolejka** — wszystko, co czeka na decyzję, w zakładkach: Weryfikacja ofert, Zestawy do uzupełnienia, Podejrzane przypisania i Możliwe duplikaty dzieł. Skróty są wspólne: ↑/↓ wybór, Enter akcja, X odrzuć, S pomiń. Zakładki „Szybkie” i „Do dodania” otwierają się jako siatka pewnych decyzji (zdjęcie oferty obok okładki), które zatwierdzasz jednym Enterem i cofasz w całości w „Ostatnich decyzjach”. Przy odrzuceniu (klawisz R) możesz zapisać regułę „odrzucaj takie zawsze”; reguły są w Ustawieniach.
- **Książki** — dzieła, wydania i serie. Dodruki tej samej książki trafiają do jednego dzieła; „Braki w katalogu” pokazują wydania bez wydawcy lub roku; „Wydawcy i serie” to jedna pisownia nazw i uniwersa; katalog można zasilać z Biblioteki Narodowej po autorze, wydawcy lub serii.
- **Oferty** — zapisane ogłoszenia z filtrami, historią cen i szczegółami (stan egzemplarza, sprzedawca, zdjęcia); grupowanie „Wg książki”. Zestawy (jedna oferta z kilkoma wydaniami, cena dotyczy całości) są tu i w Kolejce.
- **Źródła** — stan źródeł, formularz i przebieg skanu, harmonogram (automatyczny skan profilu co N godzin, domyślnie wyłączony), „Tylko polskie wydania” oraz skuteczność fraz i profili skanu.
- **Ustawienia** — interfejs (motyw, tryb handlu), reguły odrzucania, dane i kopie zapasowe, diagnostyka identyfikacji i ręczne ponowienie kolejki.

`Ctrl+K` otwiera paletę poleceń w całej aplikacji. Stan na ekranie aktualizuje się na żywo: serwer wysyła zdarzenia (`/api/events`), a po zerwaniu połączenia strona łączy się ponownie i pobiera stan od nowa.

**Weryfikacja:** ISBN najpierw pokazuje propozycję; przypisanie następuje po zatwierdzeniu. Oferty bez ISBN dostają propozycje po tytule („pewna / możliwa propozycja”) — propozycja tylko wypełnia ISBN i uruchamia zwykły podgląd. ISBN nieznany źródłom zostaje w kolejce zamiast znikać. Znalezienie ISBN w źródłach zewnętrznych nie gwarantuje automatycznego przypisania: sprzeczne lub słabe dowody kierują ofertę do ręcznej weryfikacji. Z klawiatury: `1`–`5` propozycja, `Enter` zatwierdź, `X` odrzuć, `S` pomiń, `Z` zestaw, `J`/`K` następna/poprzednia, `F` tryb skupienia.

**Decyzje automatyczne (zawsze do cofnięcia w „Ostatnich decyzjach”):** ponownie wystawiona kopia ręcznie odrzuconej oferty (ten sam tytuł w tym samym źródle albo ten sam ISBN) jest odrzucana od razu; przy włączonym „Tylko polskie wydania” (domyślnie włączone) odrzucane są wydania obcojęzyczne. Ceny odniesienia z Empiku są w osobnej zakładce weryfikacji; pewne dopasowanie tytułu do katalogu może automatycznie przypisać dzieło z wydaniem „nieustalonym”, a cofniętej decyzji automat nie ponawia. Ręczne przypisania i zestawy nigdy nie są zmieniane automatycznie. Wydanie jest wybierane tylko, gdy ogłoszenie je wskazuje — inaczej oferta trafia do „Wydanie nieustalone” tej książki.

**Zdjęcia i okładki:** skaner zapisuje zdjęcie ogłoszenia; obrazy są pobierane przez lokalny serwer i trzymane w `image-cache` obok bazy.

**Tryb handlu** (Ustawienia → Interfejs) pokazuje statusy zakupu, ceny docelowe i koszty; domyślnie wyłączony.

## Dane i kopie zapasowe

**Nowa instalacja niczego nie importuje ze starego katalogu programu.**

- Windows: `%LOCALAPPDATA%\BookFlip\data\bookflip-catalog.sqlite`
- Linux: `$XDG_DATA_HOME/BookFlip/data/bookflip-catalog.sqlite` lub `~/.local/share/BookFlip/data/bookflip-catalog.sqlite`
- Plik stanu: `scan-status.json`, a log diagnostyczny: `local-app.log` — w tym samym katalogu danych.
- Zmienna `BOOKFLIP_CATALOG_DB` pozwala świadomie wskazać inną bazę.
- Stary `scan-results/` pozostaje nieużywany przez nowy domyślny magazyn SQLite; jego usunięcie nie jest wymagane i może pozbawić Cię archiwum.

**Aktualizacja:** zamknij BookFlip, wymień tylko pliki programu i uruchom ponownie. Nie usuwaj katalogu `%LOCALAPPDATA%\BookFlip\data`. Przed zmianami struktury istniejącej bazy program wykonuje kopię w podfolderze `backups`. Migracje bazy są niezmienne (nowa zmiana schematu to nowy plik w `migrations/`); co wnosi każda, opisuje [CHANGELOG](CHANGELOG.md).

### Kopia zapasowa

Serwer codziennie sam tworzy kopię w `backups` (zostaje 7 najnowszych); drugą kopię w innym miejscu włącza zmienna opisana w [PRODUCTION-CATALOG.md](PRODUCTION-CATALOG.md#konfiguracja). Kopię można też utworzyć w **Ustawienia → Dane i kopie zapasowe** albo poleceniem:

```powershell
npm run backup
npm run backup -- "D:\\Backups\\bookflip.sqlite"
```

Backup używa API SQLite (uwzględnia WAL), sprawdza integralność i nie nadpisuje istniejącej kopii. Zawiera katalog, historię cen, obserwowane oferty, notatki, serie i profile skanowania. Kopia na tym samym dysku nie chroni przed awarią dysku — trzymaj kopie także na innym.

### Przywracanie

1. Zamknij aplikację BookFlip przed przełączaniem plików katalogu.
2. Uruchom `npm run restore -- "ścieżka/do/kopii.sqlite" "ścieżka/do/odzyskanego.sqlite"`.
3. Narzędzie sprawdza integralność i wymagane tabele, a następnie tworzy **nowy** plik.
   Odmawia nadpisania istniejącej bazy, więc oryginał pozostaje nietknięty.
4. Uruchom aplikację ze zmienną `BOOKFLIP_CATALOG_DB` wskazującą odzyskany plik
   i zweryfikuj liczniki oraz przykładowe dane.
5. Dopiero po sprawdzeniu zdecyduj o zastąpieniu starej bazy. Nie podmieniaj pliku
   SQLite, kiedy serwer pracuje.

Nie commituj prawdziwych baz SQLite, historii skanów, cookies, kluczy ani innych danych prywatnych.

## Testowanie

```powershell
npm install          # jednorazowo: ESLint, Prettier, TypeScript (devDependencies)
npm run verify       # lint, typy, formatowanie i testy — po kolei, stop na pierwszym błędzie
npm test             # same testy; jeden plik: npm test -- rejected-offers.test.mjs
# test przeglądarkowy; jednorazowo: npm install --no-save --no-package-lock playwright@1.55.1 && npx playwright install chromium
node scripts/browser-smoke.mjs
```

`npm run verify` to kontrola przed zakończeniem pracy. `npm test` izoluje katalog SQLite, log i stan skanowania w katalogu tymczasowym osobno dla każdego procesu testowego i ogranicza czas testu do 30 sekund; uruchamiaj testy przez ten skrypt, aby nie korzystały z plików stanu użytkownika.

Test przeglądarkowy (`scripts/browser-smoke.mjs`) uruchamia Chromium na izolowanej niepustej bazie: wszystkie widoki w motywie jasnym i ciemnym, na komputerze i telefonie, z kontrolą kontrastu tekstu do tła (co najmniej 3:1). Nie zastępuje pełnego testu skanowania rzeczywistych portali. Pliki w `.github/workflows/` są pozostałością — repozytorium nie ma zdalnej kopii, więc nic ich nie uruchamia.

## Architektura i dalsza dokumentacja

- `local-app.mjs` — serwer; `routes/` i `api-routes.mjs` — trasy API; `scan-engine.mjs` — skan; `app/` — interfejs.
- `marketplaces.mjs`, `local-scan.mjs` — źródła skanowania (każde zapytanie przez `marketplace-gate.mjs`).
- `catalog-production.mjs`, `sqlite-catalog-repository.mjs`, `catalog-api.mjs`, `offer-sets.mjs` — zapis i odczyt katalogu oraz zestawów.
- `catalog-resolver.mjs`, `identification-worker.mjs`, `metadata-sources/` — dopasowanie ISBN i metadane.
- `migrations/` — **niezmienne** migracje SQLite; nie usuwaj ani nie zmieniaj starych plików.

Szczegóły: [Katalog i konfiguracja](PRODUCTION-CATALOG.md), [Przechowywanie i migracje](docs/DATA-MIGRATION.md), [Mapa repozytorium](docs/REPOSITORY-MAP.md), [CHANGELOG](CHANGELOG.md) (starsze wpisy w `docs/archive/`).

Elementy historyczne: nieaktywny runner GitHub Actions usunięto; zachowano odrębnie testowane parsery źródeł i narzędzia importu starej historii JSON (diagnostyka dawnych danych), opisane w mapie repozytorium. Stare raporty i dokumenty jednorazowe są w `docs/archive/`, a usunięte materiały w historii Git.

## Pomiar wydajności (bez internetu)

Pomiar kolejki identyfikacji: `npm run bench:identification -- --offers 1000`. Tworzy syntetyczne oferty bez ISBN w bazie pamięciowej i mierzy ich przekazanie do ręcznej weryfikacji. Nie korzysta z danych użytkownika ani z internetu; nie mierzy czasu odpowiedzi BN/Open Library ani skuteczności rozpoznawania książek.

Pomiar zapisu skanu: `npm run bench:scan -- --offers 1000`, a następnie `npm run bench:scan -- --offers 10000` — porównuje zapis nowych ofert z ponownym skanem zmieniającym 10% cen. Narzędzie tworzy osobną **syntetyczną** bazę w katalogu tymczasowym, nie łączy się z marketplace'ami, nie dotyka prywatnego katalogu i po pomiarze usuwa dane testowe. Opcja `--matched` przypisuje przed powtórnym skanem każdą ofertę do osobnego wydania (koszt analizy wielu grup; przygotowanie przypisań nie jest wliczane do czasu).

Wynik JSON zawiera czas obu operacji w milisekundach, liczbę ofert, zmian cen, obserwacji cenowych, rozmiar SQLite i RSS. Porównuj wyniki w podobnych warunkach (system, wersja Node, obciążenie). To nie jest pomiar rzeczywistego Vinted ani obietnica konkretnej szybkości.

## Opcjonalny autostart Windows

Serwer można uruchamiać w tle przy logowaniu bieżącego użytkownika. Rejestrację wykonuje właściciel; instalacja aplikacji ani start serwera nie włączają autostartu.

W PowerShell, w katalogu projektu:

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows-autostart.ps1 -Action Enable
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows-autostart.ps1 -Action Status
powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/windows-autostart.ps1 -Action Disable
```

`Enable` zapisuje zadanie „BookFlip Local Server” na następne logowanie, bez jego natychmiastowego uruchomienia. `Disable` usuwa autostart, ale nie zatrzymuje już działającego serwera. Skrypt nie nadpisuje istniejącego zadania. Po przeniesieniu repozytorium wyłącz autostart i włącz go z nowego katalogu. Node.js musi być dostępny w PATH użytkownika.

Logi: `%LOCALAPPDATA%\BookFlip\logs\autostart.log` i `autostart-error.log`. Okno aplikacji otwórz pod `http://127.0.0.1:4317`. Harmonogram działa tylko przy uruchomionym serwerze; autostart nie wybudza uśpionego komputera. Skrypt sprawdza, czy serwer już odpowiada, zanim uruchomi nowy proces.
