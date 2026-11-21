# Lokalny zespół agentów BookFlip

## Cel i granice

Zespół działa lokalnie przez Claude Code w katalogu roboczym repozytorium. Claude Pro wystarcza do uruchomienia tego modelu przez logowanie Claude Code; nie używamy Anthropic API, zewnętrznego orkiestratora, hostingu ani dodatkowej bazy danych.

„Continuous” oznacza powtarzalny cykl pracy: przegląd backlogu → wybór jednego zadania → analiza → implementacja → weryfikacja → raport → następne zadanie. Nie oznacza nieograniczonego procesu działającego bez nadzoru. Pierwsza wersja nie instaluje autostartu ani zadania Harmonogramu Windows. Właściciel uruchamia cykl lokalnie i może go przerwać; limity Claude Pro i czas pracy komputera nadal obowiązują.

## Architektura

- **Koordynator (główna sesja Claude Code):** jedyny właściciel planu, backlogu, bieżącej gałęzi i decyzji o zakresie. Czyta `CLAUDE.md`, wybiera zadanie o najwyższej wartości, rozbija je na małe kroki, deleguje tylko niezależne analizy i końcowy przegląd.
- **Product triage:** ocenia wpływ zadania na cel BookFlip, priorytet, ryzyko i kryteria akceptacji. Nie implementuje.
- **Scanner specialist:** pracuje nad źródłami, pobieraniem ofert, parsowaniem, bramką dostępu i niezawodnością skanowania.
- **Catalog specialist:** pracuje nad ISBN, metadanymi, dziełami, wydaniami, seriami, kolejką i decyzjami weryfikacyjnymi.
- **QA reviewer:** niezależnie przegląda diff, testy, regresje, bezpieczeństwo danych i zgodność z briefem. Domyślnie tylko odczytuje repo i uruchamia testy; nie poprawia po cichu kodu.

Definicje agentów znajdują się w `.claude/agents/`. Koordynator pozostaje głównym agentem Claude Code; nie dokładamy osobnego serwera agentów ani frameworka.

## Przepływ jednego cyklu

1. **Odczyt stanu:** `git status`, `git log -5`, otwarte TODO/issue i odpowiednie dokumenty. Nie zakładaj, że working tree jest czysty.
2. **Triage:** wybierz jedno zadanie z największym uzasadnionym wpływem na skaner, katalog lub weryfikację. Nie wymyślaj prac tylko po to, by utrzymać pętlę.
3. **Plan:** zapisz cel, zakres, ryzyko, pliki i testy. Jeśli kryteria akceptacji są niejasne, zaproponuj domyślne i odnotuj założenia.
4. **Rozpoznanie:** w razie potrzeby uruchom Product triage i właściwego specjalistę równolegle jako zadania tylko do odczytu.
5. **Implementacja:** koordynator lub jeden wskazany specjalista realizuje jeden spójny zakres. Nie uruchamiaj równolegle dwóch agentów edytujących te same pliki. W pierwszym etapie limit to maksymalnie 2 subagenty aktywne naraz, preferowane 1.
6. **Weryfikacja:** testy celowane, następnie `npm run verify`. Dla zmian UI dodatkowo `npm run browser-smoke` tylko jeśli skrypt i jego zależności są już skonfigurowane; dla CSS `css-snapshot --only` według instrukcji w `CLAUDE.md`.
7. **Niezależny review:** QA reviewer ocenia diff i wyniki. Każdy finding musi wskazywać plik/linijkę, ryzyko i warunek naprawy. Koordynator poprawia i ponawia testy.
8. **Zapis postępu:** zaktualizuj CHANGELOG i dokumentację, gdy wymagane. Zapisz krótki raport: co zmieniono, komendy i wyniki, ryzyka, czego nie sprawdzono.
9. **Zakończenie cyklu:** commituj ukończony i zweryfikowany etap zgodnie z `CLAUDE.md`. Nie pushuj i nie scalaj bez wyraźnej prośby właściciela. Dopiero po zakończeniu cyklu wybierz następne zadanie.

## Zasady wyboru zadań

Kolejność domyślna:
1. błędy powodujące błędną identyfikację, utratę lub uszkodzenie danych;
2. awarie skanowania, naruszenia zasad dostępu do źródeł, błędne ceny/dostępność;
3. jakość dopasowania ISBN/wydań i obsługa kolejki;
4. mierzalna wydajność i pokrycie testami;
5. ergonomia UI wspierająca powyższe procesy;
6. refaktoryzacja tylko wtedy, gdy zmniejsza ryzyko lub koszt kolejnych zmian.

Nie rozwijaj funkcji kolekcjonerskich. Nie obchodź CAPTCHA, blokad ani limitów serwisów. Nie dodawaj zależności bez wykazanej korzyści. Nie twórz zadania na podstawie samej sugestii agenta, jeśli nie ma ono związku z kierunkiem produktu.

## Granice autonomii

### Dozwolone bez pytania
- czytanie repo, testów, dokumentacji i historii Git;
- analiza backlogu i proponowanie zadań;
- zmiany w repozytorium, testy na izolowanych danych, lokalne commity;
- tworzenie raportów i proponowanie PR.

### Wymaga zgody właściciela
- push, merge, publikacja release lub deploy;
- zmiana/usunięcie istniejących funkcji lub ustalonego kierunku produktu;
- dotknięcie działającej bazy, danych z `%LOCALAPPDATA%\\BookFlip\\data`, plików backupów lub prywatnych danych;
- kasowanie/nadpisywanie danych, force push/reset, usuwanie branchy;
- operacje poza katalogiem repozytorium, instalacja nowych zależności/narzędzi, logowanie do zewnętrznych usług lub publikowanie treści.

### Dane i bezpieczeństwo
- Wszystkie testy używają izolowanych katalogów tymczasowych i baz in-memory.
- Nigdy nie odczytuj ani nie modyfikuj prawdziwej bazy właściciela.
- Nie commituj baz SQLite, cookies, tokenów, kluczy ani logów zawierających dane prywatne.
- Każdy request marketplace przechodzi przez `marketplace-gate.mjs`; nie obchodź blokad.
- Nie używaj `--dangerously-skip-permissions` ani nie przyznawaj globalnego dostępu do powłoki.
- Zatrzymaj cykl, gdy nie ma sensownego, bezpiecznego zadania. Nie generuj fikcyjnych TODO.

## Budżet i kontrola kosztu

Claude Pro ma limity użytkowania; wielokrotne subagenty zwiększają zużycie. Dlatego:
- maksymalnie 2 aktywne subagenty jednocześnie, zwykle 0–1;
- deleguj tylko zadania niezależne i ograniczone konkretnym pytaniem;
- nie uruchamiaj równolegle wielu pełnych analiz repo;
- jeden cykl = jedno zadanie implementacyjne;
- preferuj Sonnet do triage, przeglądu i typowych zmian; model mocniejszy tylko dla trudnych problemów architektonicznych;
- nie używaj API billing ani dodatkowego klucza API w tej konfiguracji.

## Uruchomienie lokalne

W katalogu repozytorium Windows Terminal / PowerShell:

```powershell
claude
```

Następnie polecenie dla koordynatora:

```text
Pracuj w trybie ciągłego zespołu BookFlip zgodnie z docs/AGENT-TEAM.md.
Zrób jeden pełny cykl: odczytaj stan, wybierz jedno zadanie o najwyższym priorytecie,
zaplanuj, zaimplementuj, uruchom właściwe testy i npm run verify, zleć niezależny review
agentowi QA, popraw ewentualne błędy, zaktualizuj dokumentację i wykonaj lokalny commit.
Nie pushuj, nie scalaj i nie dotykaj danych użytkownika. Po raporcie zatrzymaj się.
```

Aby wykonać kolejny cykl, ponów polecenie. Na tym etapie nie konfigurujemy automatycznego Harmonogramu Windows: najpierw trzeba ocenić jakość kilku cykli i rzeczywiste zużycie limitu Pro. Automatyzacja bez nadzoru może utrwalać błędne priorytety i zużywać limit bez wartości.

## Kryteria powodzenia pilotażu

Po 5–10 cyklach oceń:
- odsetek zadań kończących się zielonym `npm run verify`;
- liczbę regresji wykrytych po review;
- liczbę zadań cofniętych lub poprawianych;
- realny czas i zużycie limitu na ukończone zadanie;
- czy agent wybiera prace zgodne z priorytetami BookFlip.

Dopiero na podstawie tych danych zdecyduj, czy dodać lokalny harmonogram uruchamiający Claude Code. Nie włączaj samoczynnego merge ani dostępu do prawdziwej bazy.
