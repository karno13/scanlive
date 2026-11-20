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

## Decyzja z 12.11.2026: Allegro i OLX — „brak legalnego dostępu”

Punkt 2 powyżej jest wdrożony (`NO_LEGAL_ACCESS` w `source-blocks.mjs`):

- Allegro i OLX mają stały stan „brak legalnego dostępu do wyszukiwania ofert” (szary, nie czerwony). Nie są zliczane jako niedziałające w „Dziś” i w „Źródłach”, nie trafiają do „Ostatniego skanu — źródła z błędami”.
- Nie są skanowane: formularz skanu ich nie pokazuje, `validateSearchInput` odrzuca skan wyłącznie z nimi (a z innymi źródłami je pomija), harmonogram i szybki skan pomijają je w profilach. BookFlip nie wysyła do nich już nawet jednego zapytania na skan.
- Zmiana decyzji: usunąć wpis z `NO_LEGAL_ACCESS` (np. gdy pojawi się oficjalne API z wyszukiwarką ofert).

## Dedalus.pl — CAPTCHA (rozpoznanie, 12.11.2026)

Na kopii danych Dedalus działał 11.11 o 08:24, a o 10:12 zaczął przekierowywać każde zapytanie na `/captcha.php`. To jest kontrola botów, nie strona do odczytu.

- **Czego nie robimy:** nie omijamy CAPTCHA (żadnych zmian nagłówków podszywających się pod przeglądarkę, rotacji adresów ani rozwiązywania zadań). Zmiana nagłówków pod kątem „wyglądania jak człowiek” byłaby właśnie obejściem.
- **Co zrobiliśmy legalnie:** bazowy odstęp między zapytaniami do Dedalusa wynosi 6 s zamiast 2 s (`SOURCE_INTERVAL_MS`); po blokadzie bramka dalej podwaja odstęp (do 30 s), a skan odpuszcza resztę fraz tego źródła. Dedalus nie bierze udziału w sprawdzaniu dostępności stron ofert (`LIFECYCLE_SOURCES`); jego dostępność wynika z kodu `InStock` na liście wyników.
- **Co zostaje:** źródło pozostaje w stanie „nie działa (CAPTCHA)” z datą, a skan próbuje je raz na skan i sam wraca, jeśli serwis przestanie blokować. Ma tylko 4 oferty w bazie; nie warto ryzykować więcej. Jeśli Dedalus udostępnia kanał dla partnerów (np. feed produktów), to kontakt z nim jest decyzją właściciela.

## Decyzja z 17.11.2026: Tezeusz — strony autorów zamiast wyszukiwarki

Właściciel zatwierdził. Skan nie używa już `/szukaj?szukaj=…` (zakazane w `robots.txt`), tylko stron autorów `/autor/<imię-nazwisko>?strona=N`, które są dozwolone. Fraza zamieniana jest na adres (`tezeuszAuthorSlug` w `marketplaces.mjs`; dwa wyjątki pisowni: Salvatore → `r-a-salvatore`, Richard Knaak → `richard-a-knaak`). Fraza, która nie jest nazwiskiem autora („Warcraft”, „Świat Dysku”), nie ma strony (404) i z Tezeusza nic nie przynosi — bez błędu i bez uznawania wcześniej znalezionych ofert za zniknięte. Serie fantasy nie mają stron (`/seria/…` to kilkadziesiąt serii dziecięcych i obyczajowych), a kategoria fantasy ma 13 369 książek — za dużo, by czytać ją całą. Sprawdzone na żywo 17.11: Terry Pratchett 31 ofert na stronie 1 (24 strony), R. A. Salvatore 30.

## Decyzja z 17.11.2026: Dedalus — „brak legalnego dostępu”

Właściciel zatwierdził. `robots.txt` Dedalusa zakazuje adresu wyszukiwania, którego używa skan (`Disallow: /s?q=`), a serwis od 11.11 odpowiada CAPTCHA na każde zapytanie (ostatni udany odczyt 14.11). Dedalus jest teraz na liście `NO_LEGAL_ACCESS` (`source-blocks.mjs`) jak Allegro i OLX: nie jest skanowany, nie liczy się jako awaria, a zapisane profile pomijają go bez komunikatu. 4 zapisane oferty zostają w bazie.

## Empik — ISBN ze strony produktu (sprawdzone 17.11.2026)

Strona produktu Empiku nie zawiera ISBN ani EAN (sprawdzona jedna strona przez bramkę, 1,7 MB HTML). Empik dociąga te dane przez `/gateway/api/graphql/products`, a ten adres jest w `robots.txt` **zakazany** (`Disallow: /gateway/api/graphql/products`). Odczytu ISBN z Empiku więc nie wdrażamy. Oferty Empiku zostają rozpoznawane jak dotąd: kategoria ze strony (język) i przypisanie do dzieła przez wydanie „nieustalone” (`auto_empik_work_v1`). Na kopii bazy z 17.11: 797 ofert Empiku, 0 z ISBN, 309 czeka w zakładce odniesienia.

## Nowe źródła i robots.txt obecnych — rozpoznanie (14.11.2026)

Tylko rozpoznanie: żadne źródło nie zostało dodane ani wyłączone. Odczytane zostały pliki `robots.txt` (po jednym zapytaniu) i strona główna albo jedna odpowiedź API kandydata. **Regulaminów serwisów nie czytałem** — przed dodaniem źródła trzeba to zrobić, tak jak dla Allegro i OLX.

### Obecne źródła a ich robots.txt (grupa `User-agent: *`)

| Źródło           | Adres używany przez skan                            | robots.txt                                                                                                                                                      |
| ---------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vinted           | `/catalog?search_text=…`, `/items/…`                | dozwolone (`Allow: /`; zakazane m.in. `/member/`, `/inbox`, `/checkout`)                                                                                        |
| Empik            | `/ksiazki,31,s?q=…&start=…`, strony produktów       | dozwolone (zakazane są adresy wyszukiwania z co najmniej trzema `&` i parametry typu `sort=`, `brand=`, `id=`)                                                  |
| Allegro Lokalnie | `/oferty/q/…`, `/oferta/…`                          | dozwolone (zakazane tylko `/oferty/wystaw/*`); mimo to serwis odpowiada CAPTCHA                                                                                 |
| **Tezeusz.pl**   | `/autor/…` (od 17.11; wcześniej `/szukaj?szukaj=…`) | **zakazane: `Disallow: /szukaj?`**; strony produktów, autorów (`/autor/…`) i wydawnictw są dozwolone; mapa strony: `feed.tezeusz.pl/sitemaps/sitemap_index.xml` |
| **Dedalus.pl**   | `/s?q=…`                                            | **zakazane: `Disallow: /s?q=`** (i wzorzec `*?q=*`); serwis i tak odpowiada CAPTCHA                                                                             |

Wniosek do decyzji właściciela: wyszukiwarki Tezeusza i Dedalusa są wyłączone z automatycznego odczytu przez same serwisy. `robots.txt` nie jest blokadą techniczną, ale jest wyraźnie wyrażoną wolą serwisu — spójnie z zasadą „nie obchodzimy blokad” należałoby:

- Dedalus (4 oferty w bazie, CAPTCHA od 11.11): przenieść do „brak legalnego dostępu”, jak Allegro i OLX;
- Tezeusz (122 oferty): zastąpić wyszukiwarkę dozwolonym adresem — stroną autora (`/autor/terry-pratchett`) albo stroną produktu dla ISBN znanego z katalogu — albo również wyłączyć.

Do czasu decyzji nic się nie zmienia; nowych funkcji na wyszukiwarce Tezeusza (np. skan po ISBN) nie budujemy.

### Kandydaci

| Serwis          | Co to jest                                                                                       | robots.txt                                                                                                                                                            | Ocena                                                   |
| --------------- | ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| **Skupszop.pl** | sklep z używanymi i nowymi książkami tej samej firmy co skupksiazek.pl (z którego są ceny skupu) | wyszukiwarka stron (`/wyszukiwarka`, `/wyszukaj`), sortowanie i stronicowanie zakazane; **`Allow: /api/search/listing*`** — API listy produktów jest wprost dozwolone | **najlepszy kandydat**                                  |
| TakCzytam       | sieć księgarni; sklep internetowy jest pod `takczytam.com` (platforma Redcart)                   | `takczytam.pl`: zakazane tylko `/wp-admin/`; `takczytam.com` niesprawdzony                                                                                            | do sprawdzenia: czy sklep sprzedaje używane egzemplarze |
| Sprzedajemy.pl  | ogłoszenia                                                                                       | zakazane m.in. `/Zapytanie`, `/Raport`, dane i wydruk oferty; lista nazwanych botów i narzędzi ma `Disallow: /`                                                       | wątpliwy: zapytania po frazie są zakazane               |
| Bonito.pl       | księgarnia (nowe, tanie)                                                                         | zakazane tylko `/zamowienie/`, `/proforma/`, `/d/`; lista narzędzi (`wget`, `libwww`, `Go-http-client`…) ma `Disallow: /`                                             | możliwa druga cena nowej książki obok Empiku            |
| TaniaKsiazka.pl | księgarnia (nowe)                                                                                | wyszukiwarka zakazana                                                                                                                                                 | tylko strony produktów; mała wartość                    |

**Skupszop — co zwraca `GET https://skupszop.pl/api/search/listing`** (jedna odpowiedź, 30 pozycji na stronę, lista stron w `data.pages`): dla każdej książki `isbn`, `name`, `author_raw`, `publisher.name`, `release_date`, `binding`, `price`, `price_regular`, `condition` (`nowa`, `jak nowa`, `dobry`, `widoczne ślady używania`), `is_available`, `on_stock`, `quantity_total`, `url`, `cover` oraz `variants` — osobna cena i liczba sztuk dla każdego stanu. Liczniki z odpowiedzi: 125 443 nowych i 200 678 używanych pozycji. To są dokładnie dane, których brakuje pozostałym źródłom: ISBN przy każdej ofercie (identyfikacja bez kolejki decyzji) i cena zależna od stanu.

Czego nie ustaliłem: **jak przekazać frazę albo ISBN** (zwykłe `?query=`, `?q=`, `?search=`, `?phrase=`, `?keyword=` nie filtrują wyników; filtr nazywa się `keyword`, ale jego zapis w adresie jest inny). Dalsze zgadywanie parametrów cudzego API przerwałem. Następny krok, jeśli właściciel chce to źródło: otworzyć sklep w przeglądarce, wyszukać frazę i odczytać adres zapytania do `/api/search/listing` z narzędzi deweloperskich (jedno kliknięcie), przeczytać regulamin sklepu, a potem dodać adapter według przepisu „Source” z `CLAUDE.md` (zapytania przez bramkę, zapisana odpowiedź w `fixtures/marketplaces/`).

## Antykwariaty internetowe — lista do wdrożenia (rozpoznanie, 14.11.2026)

Dla każdego serwisu odczytany `robots.txt` i jedna strona (kategoria fantastyki albo strona główna). **Regulaminów nie czytałem; kształtu strony produktu nie sprawdzałem** — liczby pochodzą z tej jednej strony. Żadne źródło nie jest dodane.

Wspólna cecha: wyszukiwarka bywa zakazana albo niepotrzebna, za to **strony kategorii są dozwolone i małe**. Dlatego te źródła czyta się po kategorii (fantastyka / SF), strona po stronie, a dopiero potem filtruje frazami profilu — nie przez zapytanie na każdą frazę.

**Wdrożone 14.11.2026 (wpis 66 w `CHANGELOG.md`):** BlackBooks.pl, Antykwariat Conroy, Szarlatan.pl, Stara Dobra Książka i Antykwariat NWS — `antiquarian-sources.mjs`, tryb „kategoria” w `scan-engine.mjs` (`readCategorySource`, ta sama fraza najwyżej raz na 20 h). Regulaminy pięciu sklepów przeczytane: żaden nie zakazuje automatycznego odczytu. Kategorie: BlackBooks `/524-fantasy-science-fiction-horror` (nadrzędna zamiast dwóch podkategorii), NWS fantasy (27) i SF (28; dalsze strony pod adresem z pagera sklepu). Strony produktów nie są czytane.

**Skupszop — stan po 14.11:** z kodu sklepu (`build/assets/Index-*.js`) wynika, że lista idzie przez `GET /api/search/listing` z parametrami `nodeId`, `routeName`, `page` (od 1), `perPage` i `filters[keyword]`; `routeName` pochodzi z ukrytego pola strony `/wyszukaj`, której `robots.txt` zakazuje. Bez niego zapytanie nie zostało sprawdzone — dalsze próby przerwane. Następny krok jak wyżej: odczytać jedno zapytanie w narzędziach deweloperskich przeglądarki.

**Wdrożone 16.11.2026 (wpis 93 w `CHANGELOG.md`):** Skupszop.pl oraz Antykwariat Toruń, Kultura Wraca, Bookway i Antykwariat Gryf.

- **Skupszop** — zapytanie odczytane w przeglądarce ze strony wyników sklepu: `GET /api/search/listing?nodeId=&routeName=listing.search&page=N&perPage=28&filters[keyword]=fraza` (bez `filters[with_filters]`, działa tak samo). `robots.txt`: `Allow: /api/search/listing*`; obok są ogólne `Disallow: *page=*` i `*with_filters*` — dłuższa, dokładniejsza reguła `Allow` ma pierwszeństwo (RFC 9309). Odpowiedź to JSON, więc `readSourceHtml` przyjmuje `application/json` tylko dla tego źródła. Regulamin sklepu przeczytany: nie zakazuje automatycznego odczytu (CAPTCHA dotyczy tylko formularza opinii).
- **Antykwariat Toruń** (Shoper): `/pl/c/Fantastyka/67`, kolejne strony `/67/N`; 18 na stronę, ok. 470 pozycji. `robots.txt`: kategorie dozwolone, zakazane m.in. `/*/searchquery`, `Crawl-delay: 1`. Regulamin przeczytany, bez zakazu.
- **Kultura Wraca** (Shoper, ten sam `robots.txt`): `/pl/c/Fantastyka%2C-science-fiction%2C-horror/314` (książki używane), 24 na stronę, 130 stron. **Regulaminu nie znalazłem** — odnośnik „Regulamin sklepu” prowadzi na stronę główną.
- **Bookway** (Drupal): `/ksiazki-kategoria/fantastyka`, strony `?page=N` liczone od zera, 11 na stronę. `robots.txt`: `Allow: /` dla `*` z sygnałem `ai-train=no` (BookFlip niczego nie trenuje; nazwane boty AI mają `Disallow`). Regulamin przeczytany, bez zakazu.
- **Antykwariat Gryf** (Warszawa, Shopify): `/collections/ksiazki-fantasy-science-fiction-horror?page=N`, 16 na stronę, 46 stron; wyprzedane pozycje zostają z plakietką „Wyprzedane”. `robots.txt`: kolekcje dozwolone, zakazane sortowanie i filtry. Regulamin przeczytany, bez zakazu.
- Stron produktów żadnego z tych sklepów skan nie czyta. ISBN na liście ma tylko Skupszop.

**Wdrożone 20.11.2026 (wpis 102 w `CHANGELOG.md`):** Lagano i Vanaheim — księgarnie z nowymi książkami (rodzaj oferty „Nowe w sklepie”), czytane po kategorii Warhammer. Oba źródła mają w `antiquarian-sources.mjs` pole `topic: 'Warhammer'`: frazy dopasowuje się do tytułu z dopisanym „Warhammer”, bo tytuły rzadko nazywają uniwersum.

- **Lagano** (WooCommerce): `/ksiazki/warhammer/`, strony `page/N/`, 24 na stronę, 124 pozycje (6 stron). `robots.txt` zakazuje filtrów listy, w tym `?gatunek=` (adres podany przez właściciela), sortowania i koszyka; ścieżki kategorii są dozwolone. ISBN jest w nazwie pliku okładki (zgodny z EAN Vanaheim dla 6 sprawdzonych tytułów; przyjmowany tylko z poprawną sumą kontrolną). Wyprzedane: klasa `product-card--outofstock`. Regulamin przeczytany, bez zakazu.
- **Vanaheim** (PrestaShop): `/pl/1125-black-library-pl`, strony `?page=N`, 30 na stronę, ok. 162 pozycje. `robots.txt`: zakazane m.in. `?order=`, `?search_query=`, `?n=`; kategorie i `?page=` dozwolone. Na liście EAN (`gtin13`), wydawca, cena brutto; `schema.org/InStock` bywa nieprawdziwe — dostępność z przycisku koszyka (`data-status`). Regulamin przeczytany, bez zakazu.
- Stron produktów skan nie czyta.

### Do wdrożenia (w tej kolejności)

| #   | Serwis              | Miasto, platforma    | Adres listy                                                                                                               | Na liście                                                                             | robots.txt                                                                                     | Uwagi                                                                                                       |
| --- | ------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 1   | Skupszop.pl         | sklep ogólnopolski   | `GET /api/search/listing`                                                                                                 | ISBN, stan, cena dla każdego stanu, dostępność                                        | API wprost dozwolone                                                                           | opis w sekcji wyżej; brakuje zapisu frazy w adresie                                                         |
| 2   | BlackBooks.pl       | Gdańsk, PrestaShop   | `https://blackbooks.pl/525-fantasy?page=N` (SF: `/527-science-fiction`, nadrzędna: `/524-fantasy-science-fiction-horror`) | tytuł z autorem, cena, dostępność; 24 na stronę                                       | kategorie i `?page=` dozwolone; zakazane `/szukaj`, `search_query`, `orderby`, `orderway`, `n` | fantasy: 1573 pozycje (66 stron) — największy zasób w niszy; ISBN i stan do sprawdzenia na stronie produktu |
| 3   | Antykwariat Conroy  | Kraków, osCommerce   | `https://www.antykwariat-conroy.pl/fantastyka-c-7.html?page=N`                                                            | tytuł, autor, wydawca, rok, **ISBN**, stan, wady, cena; 10 na stronę                  | kategorie i stronicowanie dozwolone; zakazane `/advanced_search.php`                           | 507 pozycji (51 stron); komplet danych już na liście, strony produktów niepotrzebne                         |
| 4   | Szarlatan           | Wrocław, WooCommerce | `https://szarlatan.pl/kategoria-produktu/ksiazki-wspolczesne/fantastyka/page/N/`                                          | tytuł z autorem, cena; do 150 na stronę                                               | kategorie, produkty i `?s=` dozwolone                                                          | 335 pozycji (3 strony); ma Warhammera; ISBN i stan na stronie produktu (do sprawdzenia)                     |
| 5   | Stara Dobra Książka | Gdynia, RedCart      | `https://staradobraksiazka.pl/1100-fantasy-science-fiction-horror`; wyszukiwarka `/q/?keywords=…`                         | tytuł i autor, cena, dostępność z liczbą egzemplarzy, znacznik „Egzemplarz sprzedany” | wszystko dozwolone; **`Crawl-delay: 1`**                                                       | sprzedane egzemplarze zostają na liście z ceną — gotowy sygnał sprzedaży; liczby pozycji nie znam           |
| 6   | Antykwariat NWS     | Kraków, własny sklep | `https://www.antykwariatnws.pl/antykwariat-27---N-Fantasy.html` (N od 0; SF: `antykwariat-28-…`)                          | autor, tytuł, wydanie z rokiem, cena; 15 na stronę                                    | `Allow: /`                                                                                     | fantasy 171, SF ok. 250; bez ISBN na liście; strony w starym kodowaniu znaków (nie UTF-8)                   |

### Możliwe później

- **Antykwariat Gelber** (Warszawa, WordPress): `https://antykwariatgelber.pl/category/fantastyka-i-horror-polska/page/N/`, ok. 200 pozycji, na liście ISBN, stan, cena i „Pozycja dostępna”; `robots.txt` niczego nie zakazuje. Bez koszyka — zamówienie e-mailem lub telefonicznie, więc to raczej odniesienie cenowe niż miejsce zakupu.
- **Bookbot.pl**: wyszukiwarka i filtry zakazane, strony wydawców (`/p/publisher/*`) i mapa strony dozwolone — dopiero gdy będzie skan po wydawcy.
- **Tezeusz po stronach autorów** (`https://tezeusz.pl/autor/terry-pratchett`): dozwolony zamiennik zakazanej wyszukiwarki.

### Odrzucone

| Serwis                                         | Powód                                                                                               |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Atticus (atticus.pl)                           | starodruki, mapy, grafika — nie nasz towar (wcześniej oceniony za wysoko, przed obejrzeniem oferty) |
| Antyk Sobieski                                 | książki sprzed 1945 r. i kolekcjonerskie; fantastyka tylko po angielsku                             |
| antykwariat.waw.pl                             | ma Warhammera, ale serwer odpowiada 403 na automatyczny odczyt                                      |
| czytam.pl                                      | `robots.txt` zakazuje `/sklep/*`                                                                    |
| Kwadryga, TakCzytam, TaniaKsiazka, Sprzedajemy | wyszukiwarka zakazana, oferta nie nasza albo niesprawdzona                                          |
| EnglishBooks.pl                                | książki po angielsku („Tylko polskie wydania”)                                                      |
| antykwariat.biz.pl                             | giełda ogłoszeń, brak `robots.txt`; niesprawdzona                                                   |

### Jak wdrażać

- Tryb „kategoria”: źródło ma listę adresów kategorii zamiast wzoru zapytania; skan czyta kolejne strony w tempie bramki, a oferty przechodzą przez ten sam filtr fraz co pozostałe. Pełny odczyt wszystkich pięciu antykwariatów to ok. 160 stron — przy odstępie kilku sekund kilkanaście minut, więc raz na dobę, nie przy każdym skanie.
- Oferta, która zniknęła z kategorii, jest sprzedana albo wycofana; Stara Dobra Książka mówi to wprost.
- Każde źródło: host w `localSourceHosts`, parser i zapisany fragment strony w `fixtures/marketplaces/` z testem, rodzaj oferty „antykwariat” w `offer-kinds.mjs`.
