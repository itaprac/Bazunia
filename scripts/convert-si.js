#!/usr/bin/env node
// convert-si.js — Converts pytania_SI_sorted.json to the app's deck format

const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '..', 'pytania_SI_sorted.json');
const outputPath = path.join(__dirname, '..', 'data', 'si-egzamin.json');

const raw = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// Build category index from sorted data
const categoryOrder = [];
const categoryMap = new Map();

for (const q of raw) {
  if (!categoryMap.has(q.category)) {
    categoryMap.set(q.category, []);
    categoryOrder.push(q.category);
  }
  categoryMap.get(q.category).push(q);
}

// Build categories metadata
const categories = categoryOrder.map((name, i) => {
  const num = String(i + 1).padStart(2, '0');
  return {
    id: `cat-${num}`,
    name,
    questionCount: categoryMap.get(name).length,
  };
});

// Convert questions
const questions = [];
let globalIndex = 0;

for (let catIdx = 0; catIdx < categoryOrder.length; catIdx++) {
  const catName = categoryOrder[catIdx];
  const catId = categories[catIdx].id;
  const catNum = String(catIdx + 1).padStart(2, '0');
  const catQuestions = categoryMap.get(catName);

  for (let qIdx = 0; qIdx < catQuestions.length; qIdx++) {
    const q = catQuestions[qIdx];
    const qNum = String(qIdx + 1).padStart(3, '0');
    const questionId = `si-${catNum}-q${qNum}`;

    // Remove [x2] marker from question text
    let text = q.question.replace(/\s*\[x2\]\s*/g, '').trim();

    const answerLabels = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
    const answers = q.options.map((opt, optIdx) => ({
      id: answerLabels[optIdx] || String(optIdx),
      text: opt,
      correct: q.correct.includes(optIdx),
    }));

    questions.push({
      id: questionId,
      text,
      answers,
      category: catId,
      categoryName: catName,
      originalIndex: globalIndex,
    });

    globalIndex++;
  }
}

const output = {
  deck: {
    id: 'si-egzamin',
    name: 'SI - Sztuczna Inteligencja',
    description: 'Pytania egzaminacyjne z przedmiotu Sztuczna Inteligencja (207 pytań, 10 kategorii).',
    version: 1,
    categories,
  },
  questions,
};

fs.writeFileSync(outputPath, JSON.stringify(output, null, 2), 'utf8');

console.log(`Converted ${questions.length} questions in ${categories.length} categories.`);
console.log(`Output: ${outputPath}`);
categories.forEach(c => {
  console.log(`  ${c.id}: ${c.name} (${c.questionCount})`);
});
