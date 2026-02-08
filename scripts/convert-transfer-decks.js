#!/usr/bin/env node
// convert-transfer-decks.js
// One-time converter from external transfer JSON format into app deck format.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const INPUT_DIR = path.join(ROOT, 'data' + '_transfer');
const OUTPUT_DIR = path.join(ROOT, 'data');

const DECKS = [
  {
    sourceFile: 'pytania_IO.json',
    outputFile: 'io-egzamin.json',
    id: 'io-egzamin',
    prefix: 'io',
    name: 'Inżynieria Oprogramowania',
    description: 'Pytania z inżynierii oprogramowania',
    group: 'Semestr 4',
    defaultSelectionMode: 'single',
  },
  {
    sourceFile: 'pytania_ZI.json',
    outputFile: 'zi-egzamin.json',
    id: 'zi-egzamin',
    prefix: 'zi',
    name: 'Zarządzanie informacją',
    description: 'Pytania z Zarządzania informacją',
    group: 'Semestr 4',
    defaultSelectionMode: 'multiple',
  },
  {
    sourceFile: 'pytania_GK.json',
    outputFile: 'gk-egzamin.json',
    id: 'gk-egzamin',
    prefix: 'gk',
    name: 'Grafika Komputerowa',
    description: 'Pytania z grafiki komputerowej',
    group: 'Semestr 4',
    defaultSelectionMode: 'multiple',
  },
  {
    sourceFile: 'pytania_GK2.json',
    outputFile: 'gk2-egzamin.json',
    id: 'gk2-egzamin',
    prefix: 'gk2',
    name: 'Grafika Komputerowa 2',
    description: 'Pytania z grafiki komputerowej 23.06.2025 Egzamin',
    group: 'Semestr 4',
    defaultSelectionMode: 'multiple',
  },
  {
    sourceFile: 'pytania_TD.json',
    outputFile: 'td-egzamin.json',
    id: 'td-egzamin',
    prefix: 'td',
    name: 'Transmisja Danych',
    description: 'Wszystkie dotychczas pytania z Transmisji danych',
    group: 'Semestr 4',
    defaultSelectionMode: 'multiple',
  },
  {
    sourceFile: 'pytania_TD2.json',
    outputFile: 'td2-egzamin.json',
    id: 'td2-egzamin',
    prefix: 'td2',
    name: 'Transmisja Danych 2',
    description: 'Pytania z Transmisji danych z egzaminu z dnia 26.06.2025',
    group: 'Semestr 4',
    defaultSelectionMode: 'multiple',
  },
  {
    sourceFile: 'pytania_POI.json',
    outputFile: 'poi-egzamin.json',
    id: 'poi-egzamin',
    prefix: 'poi',
    name: 'Podstawy ochrony informacji',
    description: 'Pytania z Podstaw ochrony informacji',
    group: 'Semestr 5',
    defaultSelectionMode: 'single',
  },
  {
    sourceFile: 'pytania_ZI2.json',
    outputFile: 'zi2-egzamin.json',
    id: 'zi2-egzamin',
    prefix: 'zi2',
    name: 'Zarządzanie informacją 2',
    description: 'Pytania z Zarządzania informacją 2',
    group: 'Semestr 5',
    defaultSelectionMode: 'multiple',
  },
  {
    sourceFile: 'pytania_KCM.json',
    outputFile: 'kcm-egzamin.json',
    id: 'kcm-egzamin',
    prefix: 'kcm',
    name: 'Komunikacja człowiek maszyna',
    description: 'Pytania z komunikacja człowiek maszyna',
    group: 'Semestr 5',
    defaultSelectionMode: 'multiple',
  },
  {
    sourceFile: 'pytania_SI.json',
    outputFile: 'si-egzamin.json',
    id: 'si-egzamin',
    prefix: 'si',
    name: 'Sztuczna inteligencja',
    description: 'Pytania ze Sztuczna inteligencja (Bez Logiki)',
    group: 'Semestr 5',
    defaultSelectionMode: 'single',
  },
  {
    sourceFile: 'pytaniaGry.json',
    outputFile: 'gry-egzamin.json',
    id: 'gry-egzamin',
    prefix: 'gry',
    name: 'Gry Komputerowe',
    description: 'Są to pytania wygenerowane przez Gemini na bazie wykładów',
    group: 'Semestr 5',
    defaultSelectionMode: 'single',
  },
  {
    sourceFile: 'pytaniaIPZ.json',
    outputFile: 'ipz-egzamin.json',
    id: 'ipz-egzamin',
    prefix: 'ipz',
    name: 'IPZ',
    description: 'Pytania z IPZ',
    group: 'Semestr 5',
    defaultSelectionMode: 'single',
  },
  {
    sourceFile: 'pytaniaAI.json',
    outputFile: 'ai-egzamin.json',
    id: 'ai-egzamin',
    prefix: 'ai',
    name: 'Aplikacje Internetowe',
    description: 'Pytania z Aplikacji Internetowych',
    group: 'Semestr 5',
    defaultSelectionMode: 'single',
  },
];

const LETTERS = 'abcdefghijklmnopqrstuvwxyz'.split('');

function normalizeForDedup(text) {
  return String(text || '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase('pl');
}

function normalizeText(text, fallback = '') {
  const value = String(text == null ? fallback : text);
  return value.trim().replace(/\s+/g, ' ');
}

function toAnswerId(index) {
  return LETTERS[index] || `opt${index + 1}`;
}

function parseSourceDeck(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
  if (!Array.isArray(raw)) {
    throw new Error(`Expected array in ${filePath}`);
  }
  return raw;
}

function buildQuestion(record, index, prefix) {
  const text = normalizeText(record.question, `Pytanie ${index + 1}`);
  const options = Array.isArray(record.options) ? record.options : [];
  const normalizedOptions = options.map((opt) => normalizeText(opt, ''));
  const validCorrect = Array.isArray(record.correct)
    ? [...new Set(record.correct.filter((v) => Number.isInteger(v) && v >= 0 && v < normalizedOptions.length))]
    : [];

  let answers = [];
  let explanation = '';

  if (normalizedOptions.length < 2) {
    explanation = normalizedOptions[0]
      ? `Fiszka utworzona automatycznie. Źródłowa odpowiedź: ${normalizedOptions[0]}`
      : 'Fiszka utworzona automatycznie z rekordu, który miał mniej niż 2 opcje odpowiedzi.';
  } else if (validCorrect.length === 0) {
    explanation = 'Fiszka utworzona automatycznie. W źródle brak oznaczonej poprawnej odpowiedzi.';
  } else {
    answers = normalizedOptions.map((opt, optIndex) => ({
      id: toAnswerId(optIndex),
      text: opt || `Opcja ${optIndex + 1}`,
      correct: validCorrect.includes(optIndex),
    }));
  }

  return {
    id: `${prefix}-q${String(index + 1).padStart(3, '0')}`,
    text,
    ...(answers.length > 0 ? { answers } : { answers: [] }),
    ...(explanation ? { explanation } : {}),
  };
}

function convertDeck(config) {
  const inputPath = path.join(INPUT_DIR, config.sourceFile);
  const outputPath = path.join(OUTPUT_DIR, config.outputFile);
  const sourceQuestions = parseSourceDeck(inputPath);

  const seen = new Set();
  const deduped = [];
  let duplicateCount = 0;

  for (const record of sourceQuestions) {
    const key = normalizeForDedup(record && record.question);
    if (!key) continue;
    if (seen.has(key)) {
      duplicateCount++;
      continue;
    }
    seen.add(key);
    deduped.push(record);
  }

  const questions = deduped.map((record, idx) => buildQuestion(record, idx, config.prefix));

  const output = {
    deck: {
      id: config.id,
      name: config.name,
      description: config.description,
      version: 1,
      group: config.group,
      defaultSelectionMode: config.defaultSelectionMode || 'multiple',
    },
    questions,
  };

  fs.writeFileSync(outputPath, `${JSON.stringify(output, null, 2)}\n`, 'utf8');

  return {
    sourceFile: config.sourceFile,
    outputFile: config.outputFile,
    sourceCount: sourceQuestions.length,
    duplicateCount,
    finalCount: questions.length,
  };
}

function main() {
  if (!fs.existsSync(INPUT_DIR)) {
    throw new Error(`Missing input directory: ${INPUT_DIR}`);
  }
  if (!fs.existsSync(OUTPUT_DIR)) {
    throw new Error(`Missing output directory: ${OUTPUT_DIR}`);
  }

  const summary = DECKS.map(convertDeck);
  for (const item of summary) {
    console.log(
      `${item.sourceFile} -> ${item.outputFile} | source=${item.sourceCount} dedup=${item.duplicateCount} final=${item.finalCount}`
    );
  }
}

main();
