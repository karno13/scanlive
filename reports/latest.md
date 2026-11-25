# Najnowszy raport BookFlip

**Data:** 25.11.2026 (09:06 CET)

Analiza dotyczy aktualnego kodu w [karno13/bookflip](https://github.com/karno13/bookflip), a publikacja raportu — zgodnie z instrukcją — następuje w [karno13/scanlive](https://github.com/karno13/scanlive). To dwa odrębne repozytoria. Poprzednie ustalenie o `shipping-backfill.mjs` było prawdziwe dla starszego `scanlive`, ale poprawka jest już obecna w `bookflip`.

Najważniejsze wnioski: w BookFlip jest 16 adapterów źródeł kategorii i 228 plików testowych, więc nie rekomenduję teraz kolejnego adaptera. CI pomija typecheck, dwa istniejące źródła (Gelber i Kultura Wraca) wymagają domknięcia weryfikacji regulaminowej, a funkcje telefonu nie były jeszcze sprawdzone na rzeczywistym urządzeniu. Nowy kandydat źródła: Antykwariat Hobbit — dane katalogowe są obiecujące, ale brak potwierdzonej zgody na automatyczny odczyt. Raport zawiera sześć nowych wydań/ISBN-ów, w tym dwa osobne wydania „Potrójnego zera”.

[Otwórz pełny raport z 25.11.2026](archive/2026-11-25.md)

[Archiwum raportów](archive/)
