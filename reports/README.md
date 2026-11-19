# Raporty rozwoju BookFlip

Ten katalog zawiera niezależne analizy i rekomendacje dla BookFlip. Dokumenty są przeznaczone zarówno dla właściciela projektu, jak i jako materiał wejściowy dla Claude Code w VS Code.

## Zasady

- Raporty zapisuj jako Markdown.
- Każdy pełny raport otrzymuje niezmienną nazwę datowaną: `archive/YYYY-MM-DD.md`.
- `latest.md` jest jedynym aktualizowanym plikiem i zawiera aktualny raport albo krótkie wskazanie do najnowszego raportu archiwalnego.
- Nie nadpisuj ani nie usuwaj raportów archiwalnych.
- Zapis raportu nie upoważnia do zmian kodu, konfiguracji, danych aplikacji, dokumentacji produktu ani innych plików repozytorium.
- Commituj wyłącznie pliki w `reports/`. Nie twórz PR-ów ani Issues bez osobnej prośby.
- Przed zapisem sprawdź aktualną zawartość repozytorium i istniejące raporty. Nie zakładaj, że wcześniejsze rekomendacje nadal są aktualne.

## Instrukcja dla Claude Code

Traktuj raport jako materiał analityczny, nie jako automatyczne polecenie wykonania zmian.

1. Przeczytaj `CLAUDE.md`, `README.md`, dokumentację kierunku produktu i mapę repozytorium.
2. Sprawdź aktualny stan kodu, testów i historii Git. Raport może być nieaktualny.
3. Zweryfikuj każdą rekomendację w kodzie i oznacz ją jako: potwierdzona, częściowo potwierdzona, nieaktualna albo błędna.
4. Nie implementuj niczego wyłącznie dlatego, że raport to sugeruje. Najpierw przedstaw plan i zakres zmian do akceptacji właściciela.
5. Zachowaj istniejące zachowanie, ręczne decyzje użytkownika, migracje SQLite i zasady bezpieczeństwa projektu.
6. Nie obchodź zabezpieczeń, CAPTCHA, limitów ani warunków korzystania ze źródeł internetowych.
7. Po zatwierdzeniu implementacji uruchom odpowiednie testy, w tym `npm run verify`, i opisz wyniki.

## Oczekiwana struktura raportu

- Metadane: data, zakres, commit bazowy, ograniczenia dostępu i poziom pewności.
- Zmiany w repozytorium od poprzedniego raportu.
- Najważniejsze rekomendacje (problem, dowody, rozwiązanie, pliki/moduły, korzyść, trudność, ryzyka, testy, priorytet).
- Nowe źródła ofert: legalność i realna dostępność automatycznego dostępu, pola danych, ograniczenia i linki.
- Zweryfikowane książki, serie, wydania, ISBN i frazy skanowania.
- Jeden eksperyment z hipotezą i miernikiem sukcesu.
- Jeden najlepszy następny krok z kryteriami akceptacji.
- Czego nie robić i dlaczego.

Każda propozycja powinna mieć status (NOWA / WARTA TESTU / JUŻ WDROŻONA / ODRZUCONA / WYMAGA DECYZJI), ocenę wartości, trudności i pewności dowodów (1–5), ryzyko techniczne/prawne oraz linki do źródeł. Wyraźnie odróżniaj fakty, szacunki i wnioski.

## Zakres produktu

BookFlip jest lokalną aplikacją Windows dla jednej osoby, opartą na Node.js i SQLite. Bieżący priorytet to skaner, katalog, identyfikacja wydań, serie i niezawodność źródeł. Handel i funkcje rentowności pozostają dalszym celem. Nie proponuj bez mocnego uzasadnienia chmury, kont, funkcji kolekcjonerskich ani zbędnej przebudowy technologicznej. Szczegóły i aktualne decyzje zawsze weryfikuj w dokumentacji projektu.
