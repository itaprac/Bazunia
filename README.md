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

## Logowanie i zapis danych

- Tryb gościa: dane zapisują się lokalnie w przeglądarce.
- Tryb zalogowany: dane zapisują się na Twoim koncie (Supabase).
- Możesz korzystać bez logowania, ale prywatne talie (`Moje`) wymagają konta.

## Konfiguracja konta (Supabase)

1. Wykonaj skrypt: `supabase/schema.sql`.
2. Skopiuj `.env.example` do `.env`.
3. Ustaw w `.env`:

```env
BAZUNIA_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
BAZUNIA_SUPABASE_ANON_KEY=YOUR_SUPABASE_ANON_KEY
```

4. Włącz provider `Email` (opcjonalnie też `Google`) w Supabase Auth.

## Własna talia: najprostszy import JSON

Minimalny format:

```json
{
  "deck": {
    "id": "moja-talia",
    "name": "Nazwa talii"
  },
  "questions": [
    {
      "id": "q001",
      "text": "Treść pytania",
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
- `questions` musi zawierać co najmniej 1 pytanie.
- Pytanie może mieć:
  - `0` odpowiedzi (fiszka), albo
  - `2+` odpowiedzi (testowe).

## Najczęstsze komendy

```bash
docker compose logs -f web
docker compose restart web
docker compose down
```

## Dokumentacja w aplikacji

W aplikacji kliknij `Dokumentacja` w górnym pasku.
