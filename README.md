# Bazunia

Bazunia to aplikacja webowa do nauki pytań egzaminacyjnych i fiszek.
Najważniejszy tryb to `Anki` (powtórki SM-2), dodatkowo masz `Test` i `Przeglądanie`.

## Co możesz robić

- Uczyć się na taliach `Ogólne` i `Moje` (w tym subskrybowanych).
- Przeglądać katalog `Udostępnione` i dodawać talie do swoich.
- Tworzyć własne talie (po zalogowaniu): ręcznie albo przez import JSON.
- Udostępniać własne talie innym użytkownikom.
- Subskrybować talie z katalogu `Udostępnione`.
- Oznaczać pytania flagą i wracać do nich w trybie `Oznaczone`.

## Szybki start

W katalogu projektu:

```bash
docker compose up -d
```

Aplikacja działa pod adresem:

- `http://localhost:8080`

## Deployment na Railway

Projekt ma konfigurację Dockerfile dla Railway. Kontener serwuje aplikację przez nginx, generuje `data/public-decks-manifest.json` podczas buildu i tworzy `/js/runtime-config.js` oraz `/api/runtime-config` na starcie z envów:

```env
BAZUNIA_CONVEX_URL=https://YOUR_DEPLOYMENT.convex.cloud
BAZUNIA_PUBLIC_DECK_PROVIDER=static
```

Railway używa `railway.json`, buduje z `Dockerfile` i sprawdza healthcheck pod `/`.

## Struktura repo (skrót)

- `css/` – style aplikacji.
- `js/` – logika frontendowa.
- `data/` – talie używane przez aplikację.
- `data/raw/` – surowe źródła JSON do konwersji.
- `scripts/` – skrypty pomocnicze (np. konwersja danych).
- `convex/` – backend Convex: schema, auth/session, talie, subskrypcje i głosy.
- `supabase/` – historyczny schemat sprzed migracji.

## Logowanie i zapis danych

- Tryb gościa: dane zapisują się lokalnie w przeglądarce.
- Tryb zalogowany: dane zapisują się na Twoim koncie (Convex).
- Możesz korzystać bez logowania, ale prywatne talie (`Moje`) wymagają konta.

## Konfiguracja backendu (Convex)

1. Zaloguj Convex CLI: `npx convex login`.
2. Uruchom lub podepnij deployment: `npx convex dev`.
3. Skopiuj `.env.example` do `.env`.
4. Ustaw w `.env`:

```env
BAZUNIA_CONVEX_URL=https://YOUR_DEPLOYMENT.convex.cloud
BAZUNIA_PUBLIC_DECK_PROVIDER=static
```

Frontend nadal używa pliku `js/supabase.js` jako warstwy kompatybilności, ale cała komunikacja idzie do Convexa przez `/api/rpc`.
Rolę `dev` można bootstrapować przez zmienną Convexa `BAZUNIA_DEV_EMAILS` (lista e-maili rozdzielona przecinkami).

## Własna talia: najprostszy import JSON

Minimalny format:

```json
{
  "deck": {
    "id": "moja-talia",
    "name": "Nazwa talii",
    "defaultSelectionMode": "single"
  },
  "questions": [
    {
      "id": "q001",
      "text": "Treść pytania",
      "selectionMode": "single",
      "answers": [
        { "id": "a", "text": "A", "correct": false },
        { "id": "b", "text": "B", "correct": true }
      ]
    }
  ]
}
```

Wymagania importu:

- `deck.id` i `deck.name` są wymagane.
- `deck.id`: tylko litery, cyfry, `_`, `-`.
- Opcjonalnie: `deck.defaultSelectionMode` = `single` lub `multiple`.
- `questions` musi zawierać co najmniej 1 pytanie.
- Pytanie może mieć:
  - `0` odpowiedzi (fiszka), albo
  - `2+` odpowiedzi (testowe).
- Tryb wyboru pytania:
  - `question.selectionMode` ma priorytet,
  - w przeciwnym razie używany jest `deck.defaultSelectionMode`,
  - gdy oba pola są puste, domyślnie działa `multiple` (zgodność wsteczna).
- Dla `selectionMode: "single"` pytanie statyczne musi mieć dokładnie 1 poprawną odpowiedź.
- Dla `selectionMode: "single"` z `correctWhen`: jeśli po losowaniu wyjdzie więcej niż jedna poprawna, pytanie jest tymczasowo pokazane jako `multiple`.

## Najczęstsze komendy

```bash
docker compose logs -f web
docker compose restart web
docker compose down
node scripts/generate-public-decks-manifest.js
npm run convex:dev
npm run convex:deploy
```

## Publiczne talie (Ogólne)

- Źródłem prawdy są pliki `data/*.json` oraz `data/public-decks-manifest.json`.
- Na Railway manifest generuje się automatycznie podczas buildu Dockerfile.
- Lokalnie możesz go odtworzyć ręcznie poleceniem `node scripts/generate-public-decks-manifest.js`.
- Widoczność `Ukryj/Pokaż` jest trzymana osobno w Convex (`publicDeckVisibility`).
- Treść talii ogólnych jest tylko do odczytu w aplikacji.

## Dokumentacja w aplikacji

W aplikacji kliknij `Dokumentacja` w górnym pasku.
