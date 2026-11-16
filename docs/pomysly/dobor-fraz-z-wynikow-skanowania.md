# Pomysł: dobór fraz skanowania na podstawie zapisanych wyników

Status: **pomysł, nie wdrożony** (2026-11-16). Zrobiony tylko raport offline; mechanizmu automatycznych zapytań nie ma i nie powstał celowo.

## Pomysł

Zamiast ręcznie dopisywać nazwy książek, BookFlip analizuje wyniki dotychczasowych profili i proponuje:

- warianty tytułów bez podtytułów,
- alternatywne nazwy uniwersów i serii,
- frazy z nazwiskiem autora,
- frazy dla konkretnych tomów,
- pomijanie fraz, które dają głównie duplikaty.

Hipoteza: lepiej dobrane frazy znajdą więcej unikalnych, prawidłowo rozpoznanych ofert bez zwiększania liczby zapytań.

## Co zrobiono

- `query-yield.mjs` + `scripts/query-yield-report.mjs` (test: `test/query-yield.test.mjs`).
- Uruchomienie: `node scripts/query-yield-report.mjs <kopia.sqlite> [--profile "Nazwa"] [--json]`. Tylko odczyt, bez internetu; zawsze na kopii bazy (`scripts/backup-catalog.mjs`).
- Dla frazy: oferty, oferty znalezione tylko nią, rozpoznane, wydania, odsetek duplikatów. Dodatkowo lista „same duplikaty” i „szum” (<5% rozpoznanych).
- Propozycje fraz powstają **wyłącznie z rozpoznanych wydań** (ISBN), zgodnie z regułą „żadnego przypisania z samego podobieństwa tytułów”.

## Wyniki na kopii bazy (2026-11-16)

- 71 fraz, 5283 oferty, 2669 rozpoznanych (ok. 50%).
- Tylko 224 oferty (4%) znalazła więcej niż jedna fraza. Żadna fraza nie ma samych duplikatów.
- Szum: „Eryk” (354 oferty, 0 rozpoznanych), „Piramidy” (176/1), „Maskarada” (173/2), „Mort” (92/0), „Ruchome obrazki”, „Ciekawe czasy”, „Stara Ziemia”, „Szramy”.
- Najlepsze propozycje: „Przygody Gotreka i Felixa” (19 rozpoznanych, 6 poza obecnymi frazami), „Duchy Gaunta” (21/4), „Star Wars” (21/3), „Kosmiczny wilk” (6/3).

## Wnioski

1. **Duplikaty nie są problemem.** Frazy prawie się nie pokrywają, więc usuwanie fraz „dla duplikatów” nic nie da. Część hipotezy się nie potwierdziła.
2. **Problemem jest szum.** Pojedyncze słowa z tytułów (głównie Pratchett) ciągną setki nietrafionych ofert. Każda taka fraza to zapytanie, które bierze czas i limit źródła, a prawie nic nie wnosi.
3. **Prawdopodobnie lepsze są frazy z autorem**, np. „Pratchett Mort” zamiast „Mort”. To do sprawdzenia, nie pewnik.
4. **Wzrost zasięgu jest niewielki, ale realny.** Seria/uniwersum i konkretne tomy (Gotrek i Felix, Duchy Gaunta) łapią oferty, których obecne frazy nie pokrywają.
5. **Wiele propozycji jest zbyt ogólnych** („Kroniki”, „Legendy”, „Opowieści”) i same stałyby się szumem. Automat musiałby je odsiewać, więc ludzki przegląd jest potrzebny.

## Ograniczenia analizy

- Zapisane oferty pochodzą z obecnych fraz, więc raport nie widzi ofert, których żadna fraza nigdy nie zwróciła. Liczba „poza” oznacza tylko, że propozycja sięga dalej niż obecne frazy. Nie przewiduje, ile nowych ofert znajdzie.
- „Nierozpoznane” obejmuje też prawdziwe książki czekające na identyfikację, więc szum może być zawyżony.
- Nie zmierzono jeszcze, czy zamiana fraz faktycznie zwiększa liczbę rozpoznanych ofert.

## Do przemyślenia / możliwe wdrożenie

Kolejność od najtańszej:

1. **Ręcznie, z raportu.** Zamienić 2–3 frazy-szum na warianty z nazwiskiem, dodać „Duchy Gaunta” i „Przygody Gotreka i Felixa”. Po kilku skanach powtórzyć raport i porównać liczby (oferty rozpoznane na fazę). To jest właściwy test hipotezy.
2. **Widok „Propozycje fraz” w „Źródłach”** (tylko podgląd). Przycisk „dodaj do profilu” robi właściciel. Bez automatu i bez nowych zapytań.
3. **Automat — dopiero po punkcie 1 i tylko jeśli się opłaci.** Musiałby spełniać regułę „automatyczna decyzja”: być odwracalny, widoczny w „Ostatnich decyzjach” i nie powtarzać cofniętej propozycji. Dodatkowo próg minimalnej liczby ofert i lista zbyt ogólnych słów.

Pytania otwarte:

- Czy frazy z nazwiskiem autora naprawdę podnoszą odsetek rozpoznanych? (pomiar po punkcie 1)
- Czy szum zależy od źródła? Raport liczy po wszystkich źródłach razem; podział na Vinted i resztę może dać inne wnioski.
- Jak mierzyć „więcej unikalnych ofert bez zwiększania liczby zapytań”: liczba fraz w profilu jest stała, ale każda fraza to osobne żądanie do źródła.
