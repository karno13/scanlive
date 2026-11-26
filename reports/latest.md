# Najnowszy raport BookFlip

**Data:** 26.11.2026

Analiza dotyczy kodu w [karno13/bookflip](https://github.com/karno13/bookflip), a publikacja raportów odbywa się w [karno13/scanlive](https://github.com/karno13/scanlive). W BookFlip nadal jest tylko commit importu z 24.11; brak Issues i PR-ów. CI przeszło 4/4 kombinacje Windows/Linux i Node 22.16/24, ale nadal pomija typecheck.

Najważniejsze nowe ustalenie: lista `NO_LEGAL_ACCESS` dla Allegro, OLX i Dedalusa nie jest egzekwowana w najniższej warstwie pobierania, a ręczny workflow łączności wywołuje `scanMarketplace` dla Allegro. Nie stwierdzono uruchomienia tego workflow, ale ścieżkę należy zamknąć. Nowy kandydat źródła to BookLoft (ok. 1,5 tys. ofert, kategoria Fantasy, konkretne używane polskie wydania), lecz katalog odzwierciedla oferty sprzedawcy na Allegro i nie ma potwierdzonej zgody na automatyczny odczyt. Antykwariat.biz.pl ma zbyt małą podaż i nieuzupełniony regulamin. Raport zawiera 10 zweryfikowanych wydań/ISBN-ów z Warcraftu, Warhammera i fantasy oraz plan pilotażu bez scrapingu.

[Otwórz pełny raport z 26.11.2026](archive/2026-11-26.md)

[Archiwum raportów](archive/)
