# Fixtures parserów serwisów ogłoszeniowych

Pliki `*.json` są odczytywane przez `test/marketplace-fixtures.test.mjs`. Testy działają offline, bez pobierania danych z serwisów.

## Pochodzenie

- `kind: "synthetic"` — zbudowany ręcznie przykład struktury HTML/JSON-LD. **Nie jest dowodem, że parser nadal działa na aktualnej stronie serwisu.**
- `kind: "captured"` — fragment faktycznej strony z datą `capturedAt`, po ręcznej kontroli i anonimizacji `reviewedForPersonalData: true`.

Przykłady OLX i Allegro Lokalnie są **syntetyczne**. `vinted-search-captured.json` i `empik-tiles-captured.json` to fragmenty prawdziwych stron z 2026-11-10 (pojedyncze zapytania przez bramkę): numery ogłoszeń, identyfikatory sprzedawców i zdjęć Vinted zastąpione zmyślonymi. `tezeusz-cards-captured.json` to dwie karty z wyników Tezeusza z 2026-11-14 (egzemplarz z ceną i tytuł wyprzedany, który nie jest ofertą). Pięć plików `*-category-captured.json` to pierwsze trzy pozycje i pager stron kategorii antykwariatów z 2026-11-14 (pole `categoryUrl` przełącza test w tryb „kategoria”); to produkty sklepów, bez danych osób. Fragment BlackBooks pochodzi z podkategorii `/525-fantasy`, skan czyta nadrzędną `/524-…`. Z 2026-11-16: cztery kolejne pliki `*-category-captured.json` (Antykwariat Toruń, Kultura Wraca, Bookway, Antykwariat Gryf — w tym ostatnim dwie wyprzedane pozycje ze strony 1 i dwie dostępne ze strony 20) oraz `skupszop-listing-captured.json` — trzy książki z jednej odpowiedzi API listy Skupszopu, ograniczone do pól czytanych przez parser. Strona ogłoszenia Vinted w tym samym kształcie: `fixtures/details/vinted-item-captured.html` (język zmieniony na „Polski”, opis zmyślony).

## Dodawanie autentycznej próbki

1. Zapisz prywatnie HTML **publicznego wyniku wyszukiwania**, do którego masz uprawniony dostęp. Nie obchodź CAPTCHA ani mechanizmów autoryzacji i nie zapisuj ciasteczek logowania.
2. Ręcznie wytnij tylko fragment rozpoznawany przez odpowiedni parser (np. JSON-LD produktu lub właściwy wpis RSC). Nie kopiuj całego dokumentu, trackerów ani kodu analitycznego.
3. Usuń nazwy użytkowników, adresy e-mail, tokeny, identyfikatory sesji, adresy prywatne, numery telefonów i inne dane osób. Nazwy i ceny ofert można zastąpić danymi przykładowymi, zachowując istotny kształt pól.
4. Umieść w tym folderze plik JSON z `kind: "captured"`, `source`, `host`, `capturedAt`, `sanitized: true`, `reviewedForPersonalData: true`, `searchQuery`, `category`, `html` i `expected` (tablica `{url,price}`).
5. Uruchom `npm test` i przejrzyj diff przed commitem. Ogranicz pojedynczy fragment HTML do 300 KB.

Nie przechowuj tutaj nieoczyszczonych plików ani prywatnych zapisów stron. Testy nie potwierdzają autentyczności metadanych; dokumentuje ją osoba przygotowująca próbkę.
