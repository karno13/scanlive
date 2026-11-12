# Allegro i OLX — legalne drogi dostępu (rozpoznanie, 11.11.2026)

Na kopii danych Allegro od pierwszego skanu (1.11.2026) odpowiada CAPTCHA, a OLX — HTTP 403. Na ekranie „Dziś” oba serwisy mają stan „nigdy nie zadziałał”.

Ten dokument jest tylko rozpoznaniem i nie zmienia kodu. BookFlip nie obchodzi CAPTCHA ani blokad. Każde zapytanie do serwisu idzie przez `marketplace-gate.mjs`, a ta zasada zostaje bez wyjątków.

## Allegro

**Oficjalna droga: REST API** ([developer.allegro.pl](https://developer.allegro.pl/about), [dokumentacja](https://developer.allegro.pl/documentation)).

- Trzeba zarejestrować aplikację (Client ID i Client Secret) i używać tokenów OAuth 2 ([Access token](https://developer.allegro.pl/tutorials/x8ixmw-VL6Yel7BnSz)).
- **Wyszukiwanie ofert po frazie (`GET /offers/listing`) nie jest dostępne dla nas.**
  - Od 1.06.2021 zasób był tylko dla zweryfikowanych aplikacji ([ogłoszenie z 15.03.2021](https://developer.allegro.pl/news/zmienilismy-regulamin-rest-api-v8Wdyj7mWfn)).
  - We wrześniu 2026 opiekunka repozytorium Allegro API odrzuciła prośbę o przywrócenie tego zasobu. Uzasadnienie: zasobu „obecnie nie ma w publicznym API” ([dyskusja #4584](https://github.com/allegro/allegro-api/discussions/4584)).
  - Prywatna aplikacja nie ma więc oficjalnego sposobu, by szukać ofert po tytule książki.
- **Katalog produktów (`GET /sale/products?phrase={EAN}&mode=GTIN`).**
  - To wyszukiwanie kart produktów po kodzie EAN/ISBN ([zmiana z 17.05.2022](https://developer.allegro.pl/news/usprawnilismy-wyszukiwanie-produktow-w-naszym-katalogu-7G92kkW53fY)).
  - Zwraca opis produktu, nie listę ofert z cenami, więc nie zastąpi skanu.
  - Mógłby co najwyżej uzupełniać metadane wydania. Wymaga zarejestrowanej aplikacji. Źródła zewnętrzne podają, że działa z poświadczeniami aplikacji (client credentials), ale w dokumentacji Allegro tego nie potwierdziłem.
- **Warunki.** Społeczność Allegro wspomina nowy regulamin REST API z 10.09.2025 ([wątek](https://spolecznosc.allegro.pl/t5/zaawansowani-sprzedawcy/10-09-2025-nowy-regulamin-rest-api/m-p/1079302)). Moderatorzy piszą, że nie wolno używać ofert (także archiwalnych) do pokazywania w serwisach konkurencyjnych. Zakaz prezentowania statystyk sprzedaży konkretnych użytkowników sięga regulaminu WebAPI z 2012 r. ([Antyweb](https://antyweb.pl/allegro-zmienia-zasady-korzystania-z-api-koniec-sledzenia-sprzedawcow-czy-moze-uruchomia-cos-wlasnego)). Pełnego tekstu z 2025 r. nie przeczytałem; przed rejestracją aplikacji trzeba go sprawdzić.
- **Allegro Lokalnie** to osobny serwis. W BookFlip działa przez zwykłe strony wyników, w tempie bramki — to rozpoznanie go nie dotyczy.

**Wniosek:** dla Allegro nie ma legalnej drogi do wyszukiwania ofert. Jedyna oficjalna możliwość to katalog produktów po ISBN — wyłącznie dla metadanych i po przeczytaniu regulaminu.

## OLX

**Oficjalna droga: OLX Partner API** ([developer.olx.pl](https://developer.olx.pl/swagger/20), [specyfikacja 2.0](https://doc.olxgroup.com/api/?p=789)).

- Partner musi wystąpić o dane klienta API. Każda aplikacja dostaje osobne poświadczenia.
- API służy do wystawiania i zarządzania własnymi ogłoszeniami oraz do wiadomości. Przykład z dokumentacji to `POST https://www.olx.pl/api/partner/adverts`.
- W oficjalnej dokumentacji nie znalazłem wyszukiwania cudzych ogłoszeń. Metody „get_offers” spotykane w bibliotekach to nieoficjalne nakładki na niepubliczne adresy ([przykład](https://github.com/Pawikoski/olx-api-wrapper)). Nie są dozwoloną drogą.

**Wniosek:** dla OLX nie ma legalnej drogi do wyszukiwania ogłoszeń. API partnera dotyczy własnych ogłoszeń sprzedawcy.

## Co z tego wynika dla BookFlip

1. Allegro i OLX zostają z obecnym stanem: „Dziś” pokazuje je jako niedziałające, z powodem i datą pierwszej nieudanej próby. Formularz skanu domyślnie ich nie zaznacza.
2. Możliwy następny krok (decyzja właściciela, nie część tego etapu): oznaczyć oba źródła na stałe jako „brak legalnego dostępu”, żeby nie trafiały do skanów z profili.
3. Gdyby katalog Allegro miał uzupełniać metadane (okładka, wydawca po ISBN), potrzebne są:
   - rejestracja aplikacji na developer.allegro.pl;
   - przeczytanie regulaminu z 10.09.2025;
   - zapytania przez `metadata-sources/*` z osobnym limitem, tak jak dla BN i Open Library.
