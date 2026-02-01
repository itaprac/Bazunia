# Baza Deluxe

Aplikacja webowa do nauki z fiszkami (flashcards) z algorytmem powtarzania rozłożonego SM-2. Działa w przeglądarce, dane trzyma w `localStorage`.

## Wymagania

- Przeglądarka z obsługą ES6 modules (Chrome, Firefox, Safari, Edge)
- Lokalny serwer HTTP (aplikacja korzysta z ES6 modules, które nie działają z protokołu `file://`)

## Uruchomienie

Wejdź do katalogu projektu i uruchom dowolny serwer HTTP:

**Python 3:**
```bash
cd baza_deluxe
python3 -m http.server 8000
```

**Node.js (npx):**
```bash
cd baza_deluxe
npx serve .
```

**PHP:**
```bash
cd baza_deluxe
php -S localhost:8000
```

Następnie otwórz w przeglądarce: **http://localhost:8000**

## Struktura projektu

```
index.html          — strona główna (SPA)
css/
  main.css          — style bazowe, motyw jasny/ciemny
  components.css    — style komponentów UI
js/
  app.js            — główna logika aplikacji
  card.js           — model karty SRS
  deck.js           — zarządzanie taliami i kolejkami
  importer.js       — import talii z JSON
  sm2.js            — algorytm SM-2
  storage.js        — warstwa localStorage
  ui.js             — renderowanie interfejsu
  utils.js          — funkcje pomocnicze
data/
  poi-egzamin.json  — wbudowana talia (auto-import przy starcie)
  sample-exam.json  — przykładowa talia
```

## Format talii (JSON)

```json
{
  "deck": {
    "id": "moja-talia",
    "name": "Nazwa talii",
    "description": "Opcjonalny opis"
  },
  "questions": [
    {
      "id": "q001",
      "text": "Treść pytania",
      "answers": [
        { "id": "a", "text": "Odpowiedź A", "correct": false },
        { "id": "b", "text": "Odpowiedź B", "correct": true }
      ],
      "explanation": "Opcjonalne wyjaśnienie"
    }
  ]
}
```

Talie można importować przez przycisk **Importuj talię** w interfejsie aplikacji. Pliki JSON z katalogu `data/` są importowane automatycznie przy starcie.
