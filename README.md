# Bazunia

Bazunia to aplikacja webowa do nauki pytań egzaminacyjnych, fiszek i współdzielonych talii.
Frontend jest statyczną aplikacją Vite/React, a backend kont, synchronizacji, talii
udostępnionych, głosów, ról i Google OAuth działa w Convex.

## Funkcje

- Tryb powtórek `Anki` oparty o SM-2.
- Tryb `Test` i `Przeglądanie` dla talii publicznych oraz prywatnych.
- Tryb gościa z zapisem lokalnym w przeglądarce.
- Tryb konta z synchronizacją przez Convex.
- Tworzenie prywatnych talii, ręcznie albo przez import JSON.
- Katalog talii udostępnionych z subskrypcjami.
- Role `admin` i `dev` dla zarządzania taliami publicznymi.
- Manifest talii publicznych generowany z plików `data/*.json`.

## Stack

- Frontend: Vite, React, CSS, moduły aplikacji w `js/`.
- Backend: Convex functions i HTTP actions w `convex/`.
- Dane: statyczne talie publiczne w `data/`.
- Produkcja: Railway, Docker i nginx.

## Wymagania

- Node.js 22 lub nowszy (`.nvmrc` jest w repo).
- npm.
- Dostęp do Convex CLI dla pracy nad backendem i deploymentu.
- Docker tylko do lokalnego testu kontenera zgodnego z Railway.

## Development Lokalny

Zainstaluj zależności:

```bash
npm install
```

Utwórz publiczną konfigurację runtime frontendu:

```bash
cp .env.example .env
```

Ustaw co najmniej:

```env
BAZUNIA_CONVEX_URL=https://YOUR_DEPLOYMENT.convex.cloud
BAZUNIA_PUBLIC_DECK_PROVIDER=static
```

Uruchom frontend:

```bash
npm run dev
```

Vite wystawia aplikację pod:

```text
http://localhost:5173
```

Przy pracy nad backendem uruchom Convex w drugim terminalu:

```bash
npm run convex:dev
```

## Środowisko Convex

Plik `.env` zawiera wyłącznie publiczne wartości runtime frontendu. Sekrety OAuth
ustawiaj w środowisku deploymentu Convex. Referencją jest `.env.convex.example`:

```env
BAZUNIA_GOOGLE_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID
BAZUNIA_GOOGLE_CLIENT_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET
BAZUNIA_APP_URL=http://localhost:8080
BAZUNIA_ALLOWED_REDIRECT_ORIGINS=http://localhost:8080
```

Obsługiwane są też aliasy zgodne z przykładami Convex Auth:

```env
AUTH_GOOGLE_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID
AUTH_GOOGLE_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET
```

Deployment funkcji Convex:

```bash
npm run convex:deploy
```

## Google OAuth

Logowanie przez Google działa przez Convex HTTP actions:

```text
https://YOUR_DEPLOYMENT.convex.site/api/auth/google/start
https://YOUR_DEPLOYMENT.convex.site/api/auth/google/callback
```

W Google Cloud utwórz OAuth client typu `Web application`. Nie używaj klienta
`Desktop app`, bo jego redirecty `localhost` nie pasują do callbacku Convex.

Po pobraniu pliku `client_secret_*.json` możesz ustawić zmienne Convex poleceniem:

```bash
npm run configure:google-oauth -- ~/Downloads/client_secret_....json
```

Sprawdzenie produkcyjnego flow:

```bash
npm run check:google-oauth
```

Szczegółowy runbook jest w `docs/google-oauth-runbook.md`.

## Talie Publiczne

Źródłem talii publicznych są pliki:

```text
data/*.json
```

Manifest aplikacji:

```text
data/public-decks-manifest.json
```

Regeneracja lokalna:

```bash
node scripts/generate-public-decks-manifest.js
```

Skrypt zachowuje istniejące `generatedAt`, jeśli zawartość talii się nie zmieniła.
Dzięki temu zwykły build nie powinien brudzić worktree samą datą.

## Format Importu JSON

Minimalny format prywatnej talii:

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
      "image": "https://example.com/pytanie.png",
      "selectionMode": "single",
      "answers": [
        { "id": "a", "text": "A", "correct": false },
        { "id": "b", "text": "B", "image": "https://example.com/odpowiedz.png", "correct": true }
      ]
    }
  ]
}
```

Zasady importu:

- `deck.id` i `deck.name` są wymagane.
- `deck.id` może zawierać litery, cyfry, `_` i `-`.
- `deck.defaultSelectionMode` może mieć wartość `single` albo `multiple`.
- `questions` musi zawierać co najmniej jedno pytanie.
- Pytanie może nie mieć odpowiedzi, jeśli ma działać jako fiszka.
- Pytanie testowe powinno mieć co najmniej dwie odpowiedzi.
- `question.selectionMode` nadpisuje `deck.defaultSelectionMode`.
- `image` w pytaniu lub odpowiedzi jest opcjonalnym URL-em obrazka.
- Statyczne pytanie `single` musi mieć dokładnie jedną poprawną odpowiedź.

## Deployment Produkcyjny

Aktualna ścieżka produkcyjna to Railway z plikami:

```text
railway.json
Dockerfile
nginx.conf
```

Railway buduje obraz Docker, uruchamia `npm run build`, serwuje wynik Vite przez
nginx i generuje `/js/runtime-config.js` na starcie kontenera z envów.

Wymagane zmienne Railway:

```env
BAZUNIA_CONVEX_URL=https://YOUR_DEPLOYMENT.convex.cloud
BAZUNIA_PUBLIC_DECK_PROVIDER=static
```

Healthcheck Railway:

```text
/
```

## Lokalny Kontener Produkcyjny

Tego trybu używaj do sprawdzenia kontenera zgodnego z Railway:

```bash
docker compose up --build
```

Aplikacja będzie dostępna pod:

```text
http://localhost:8080
```

Zatrzymanie:

```bash
docker compose down
```

## Komendy

```bash
npm run dev
npm run build
npm run preview
npm run typecheck
npm run convex:dev
npm run convex:deploy
npm run check:google-oauth
```

## Struktura Repo

```text
convex/   schema, funkcje i HTTP actions Convex
css/      style aplikacji
data/     statyczne talie publiczne i manifest
docs/     notatki operacyjne
js/       główne moduły aplikacji w przeglądarce
scripts/  konwersja danych i skrypty deploymentowe
src/      React shell montujący istniejący interfejs aplikacji
```

## Uwagi

- `js/supabase.js` jest warstwą kompatybilności; obecnie komunikuje się z Convex, nie z Supabase.
- Lokalny build, zależności, output Vercel, cache Playwright i lokalny stan Convex są ignorowane.
- Nie commituj `.env`, `.env.local`, sekretów OAuth ani lokalnych katalogów deploymentowych.
