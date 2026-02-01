// app.js — Application entry point, router, study session loop

import { DEFAULT_SETTINGS, processRating, getButtonIntervals } from './sm2.js';
import { RATINGS, isNew as isNewCard, isReview as isReviewCard, isLearning as isLearningCard, isRelearning as isRelearningCard } from './card.js';
import * as deck from './deck.js';
import * as storage from './storage.js';
import { importFromFile, importBuiltIn } from './importer.js';
import {
  renderDeckList,
  renderQuestion,
  renderAnswerFeedback,
  renderSessionComplete,
  renderCategorySelect,
  renderModeSelect,
  renderSettings,
  renderTestConfig,
  renderTestQuestion,
  renderTestResult,
  renderBrowse,
  renderAppSettings,
  renderQuestionEditor,
  formatKeyName,
  updateStudyCounts,
  updateProgress,
  showView,
  showNotification,
  showConfirm,
} from './ui.js';
import { shuffle } from './utils.js';
import { hasRandomizer, randomize } from './randomizers.js';

// --- App State ---

const FONT_SCALES = [0.85, 0.925, 1.0, 1.1, 1.25, 1.4];
const DEFAULT_FONT_LEVEL = 2;

const DEFAULT_APP_SETTINGS = {
  theme: 'auto',
  shuffleAnswers: true,
  questionOrder: 'shuffled', // 'shuffled' or 'ordered'
  randomizeNumbers: false,
  keybindings: {
    showAnswer: [' ', 'Enter'],
    again: ['1'],
    hard: ['2'],
    good: ['3'],
    easy: ['4'],
  }
};

let appSettings = { ...DEFAULT_APP_SETTINGS, keybindings: { ...DEFAULT_APP_SETTINGS.keybindings } };
let settings = { ...DEFAULT_SETTINGS };
let fontLevel = DEFAULT_FONT_LEVEL;
let currentDeckId = null;
let currentCategory = null; // null = all, or category id
let settingsReturnTo = null; // 'mode-select' or 'deck-list'
let studyPhase = null; // 'question' | 'feedback' | null
let queues = null;
let currentCard = null;
let currentSource = null;
let currentQuestion = null;
let currentShuffledAnswers = null;
let selectedAnswerIds = new Set();
let studiedCount = 0;
let sessionTotal = 0;
let waitTimer = null;

// Test mode state
let testQuestions = [];
let testCurrentIndex = 0;
let testAnswers = new Map(); // questionId → Set of selected answer ids
let testShuffledAnswers = null;
let testSelectedIds = new Set();
let testShuffledMap = new Map(); // index → shuffled answers array

// --- Initialization ---

function init() {
  // Load settings
  const saved = storage.getSettings();
  if (saved) {
    settings = { ...DEFAULT_SETTINGS, ...saved };
  }

  // Load app settings
  const savedApp = storage.getAppSettings();
  if (savedApp) {
    appSettings = {
      ...DEFAULT_APP_SETTINGS,
      ...savedApp,
      keybindings: { ...DEFAULT_APP_SETTINGS.keybindings, ...(savedApp.keybindings || {}) },
    };
  }

  // Apply theme
  applyTheme(appSettings.theme);

  // Load font scale
  const savedFont = localStorage.getItem('baza_fontLevel');
  if (savedFont !== null) {
    fontLevel = Math.max(0, Math.min(FONT_SCALES.length - 1, parseInt(savedFont) || DEFAULT_FONT_LEVEL));
  }
  applyFontScale();

  // Bind events
  bindGlobalEvents();

  // Try loading built-in decks
  loadBuiltInDecks();

  // Show deck list
  navigateToDeckList();
}

function applyFontScale() {
  document.documentElement.style.setProperty('--font-scale', FONT_SCALES[fontLevel]);
}

function changeFontSize(delta) {
  fontLevel = Math.max(0, Math.min(FONT_SCALES.length - 1, fontLevel + delta));
  applyFontScale();
  localStorage.setItem('baza_fontLevel', fontLevel);
}

let mediaQueryCleanup = null;

function applyTheme(theme) {
  // Clean up previous media query listener
  if (mediaQueryCleanup) {
    mediaQueryCleanup();
    mediaQueryCleanup = null;
  }

  if (theme === 'auto') {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      document.documentElement.setAttribute('data-theme', mq.matches ? 'dark' : 'light');
    };
    apply();
    mq.addEventListener('change', apply);
    mediaQueryCleanup = () => mq.removeEventListener('change', apply);
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
}

function handleKeyDown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const activeView = document.querySelector('.view.active');
  if (!activeView) return;

  // Study mode shortcuts
  if (activeView.id === 'view-study' && studyPhase) {
    const kb = appSettings.keybindings;
    if (studyPhase === 'question') {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        const options = document.querySelectorAll('#answers-list .answer-option');
        if (num <= options.length) options[num - 1].click();
        return;
      }
      if (kb.showAnswer.includes(e.key)) {
        e.preventDefault();
        showFeedback();
        return;
      }
    } else if (studyPhase === 'feedback') {
      if (kb.again.includes(e.key)) { e.preventDefault(); handleRating(1); return; }
      if (kb.hard.includes(e.key)) { e.preventDefault(); handleRating(2); return; }
      if (kb.good.includes(e.key)) { e.preventDefault(); handleRating(3); return; }
      if (kb.easy.includes(e.key)) { e.preventDefault(); handleRating(4); return; }
      if (kb.showAnswer.includes(e.key)) { e.preventDefault(); handleRating(3); return; }
    }
  }

  // Test mode shortcuts
  if (activeView.id === 'view-test') {
    const nextBtn = document.getElementById('btn-test-next');
    if (nextBtn) {
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        e.preventDefault();
        const options = document.querySelectorAll('#test-answers-list .answer-option');
        if (num <= options.length) options[num - 1].click();
        return;
      }
      if ((e.key === ' ' || e.key === 'Enter') && !nextBtn.disabled) {
        e.preventDefault();
        nextBtn.click();
        return;
      }
    }
  }
}

async function loadBuiltInDecks() {
  const decks = storage.getDecks();
  const builtInFiles = ['data/poi-egzamin.json', 'data/sample-exam.json', 'data/si-egzamin.json'];

  for (const file of builtInFiles) {
    try {
      const result = await importBuiltIn(file);
      if (result.valid && !decks.some(d => d.id === result.deck.id)) {
        navigateToDeckList(); // refresh
      }
    } catch {
      // Built-in file not available — that's ok
    }
  }
}

// --- Navigation ---

function navigateToDeckList() {
  clearWaitTimer();
  studyPhase = null;
  currentDeckId = null;
  currentCategory = null;
  queues = null;
  currentCard = null;
  showView('deck-list');

  const decks = storage.getDecks();
  const statsMap = {};
  for (const d of decks) {
    statsMap[d.id] = deck.getDeckStats(d.id);
  }
  renderDeckList(decks, statsMap);
  bindDeckListEvents();
}

// --- Category Select ---

function getFilteredQuestionIds(deckId) {
  if (!currentCategory) return null; // null means all questions
  const questions = storage.getQuestions(deckId);
  return questions.filter(q => q.category === currentCategory).map(q => q.id);
}

function getFilteredQuestions(deckId) {
  const questions = storage.getQuestions(deckId);
  if (!currentCategory) return questions;
  return questions.filter(q => q.category === currentCategory);
}

function navigateToCategorySelect(deckId) {
  currentDeckId = deckId;
  currentCategory = null;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const deckName = deckMeta ? deckMeta.name : deckId;

  if (!deckMeta || !deckMeta.categories) {
    navigateToModeSelect(deckId);
    return;
  }

  showView('category-select');
  const statsMap = deck.getDeckCategoryStats(deckId, deckMeta.categories);
  renderCategorySelect(deckName, deckMeta.categories, statsMap);
  bindCategorySelectEvents(deckId, deckMeta.categories);
}

function bindCategorySelectEvents(deckId, categories) {
  document.querySelectorAll('.category-card').forEach(card => {
    card.addEventListener('click', () => {
      const catId = card.dataset.category;
      currentCategory = catId === 'all' ? null : catId;
      navigateToModeSelect(deckId);
    });
  });
}

function navigateToStudy(deckId) {
  currentDeckId = deckId;
  studiedCount = 0;

  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  document.getElementById('study-deck-name').textContent = deckMeta ? deckMeta.name : deckId;

  showView('study');
  startStudySession();
}

function navigateToComplete(deckId) {
  clearWaitTimer();
  studyPhase = null;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const todayStats = deck.getTodayStats(deckId);
  showView('complete');
  renderSessionComplete(todayStats, deckMeta ? deckMeta.name : deckId);
  bindCompleteEvents();
}

// --- Mode Select ---

function navigateToModeSelect(deckId) {
  currentDeckId = deckId;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const deckName = deckMeta ? deckMeta.name : deckId;

  // Build stats for filtered questions if category is selected
  let stats;
  if (currentCategory) {
    const filteredIds = getFilteredQuestionIds(deckId);
    const filteredSet = new Set(filteredIds);
    const cards = storage.getCards(deckId).filter(c => filteredSet.has(c.questionId));
    const now = Date.now();
    const dueReview = cards.filter(c => isReviewCard(c) && c.dueDate <= now).length;
    const dueLearning = cards.filter(c => (isLearningCard(c) || isRelearningCard(c)) && c.dueDate <= now).length;
    const learningTotal = cards.filter(c => isLearningCard(c) || isRelearningCard(c)).length;
    const totalNew = cards.filter(c => isNewCard(c)).length;
    stats = {
      dueToday: dueReview + dueLearning,
      learningTotal,
      newAvailable: totalNew,
      totalCards: cards.length,
    };
  } else {
    stats = deck.getDeckStats(deckId);
  }

  showView('mode-select');
  renderModeSelect(deckName, stats);
  bindModeSelectEvents(deckId, stats);
}

function bindModeSelectEvents(deckId, stats) {
  document.querySelectorAll('.mode-card:not(.disabled)').forEach(card => {
    card.addEventListener('click', () => {
      const mode = card.dataset.mode;
      if (mode === 'anki') {
        navigateToStudy(deckId);
      } else if (mode === 'test') {
        navigateToTestConfig(deckId);
      } else if (mode === 'browse') {
        navigateToBrowse(deckId);
      }
    });
  });

}

// --- Test Mode ---

function navigateToTestConfig(deckId) {
  currentDeckId = deckId;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const deckName = deckMeta ? deckMeta.name : deckId;
  const questions = getFilteredQuestions(deckId);

  document.getElementById('test-deck-name').textContent = deckName;
  document.getElementById('test-counter').textContent = '';
  document.getElementById('test-progress').style.width = '0%';

  showView('test');
  renderTestConfig(questions.length);
  bindTestConfigEvents(deckId, questions.length);
}

function bindTestConfigEvents(deckId, totalQuestions) {
  const slider = document.getElementById('test-count-slider');
  const display = document.getElementById('test-count-display');
  const startBtn = document.getElementById('btn-start-test');

  slider.addEventListener('input', () => {
    display.textContent = slider.value;
  });

  startBtn.addEventListener('click', () => {
    const count = parseInt(slider.value);
    startTest(deckId, count);
  });
}

function startTest(deckId, questionCount) {
  currentDeckId = deckId;
  const allQuestions = getFilteredQuestions(deckId);
  if (appSettings.questionOrder === 'ordered') {
    // Sort by originalIndex (if present) for ordered mode
    const sorted = [...allQuestions].sort((a, b) => (a.originalIndex ?? 0) - (b.originalIndex ?? 0));
    testQuestions = sorted.slice(0, questionCount);
  } else {
    testQuestions = shuffle(allQuestions).slice(0, questionCount);
  }
  testCurrentIndex = 0;
  testAnswers = new Map();
  testShuffledMap = new Map();

  showTestQuestion();
}

function showTestQuestion() {
  let question = testQuestions[testCurrentIndex];

  // Apply randomization if enabled (only on first visit, not when going back)
  if (appSettings.randomizeNumbers && hasRandomizer(question.id) && !testShuffledMap.has(testCurrentIndex)) {
    const variant = randomize(question.id);
    if (variant) {
      question = { ...question, text: variant.text, answers: variant.answers };
      testQuestions[testCurrentIndex] = question;
    }
  }

  const isMulti = true;

  // Reuse previously stored shuffle order if going back
  const storedShuffle = testShuffledMap.get(testCurrentIndex) || null;
  // Restore previous selection if any
  const previousSelection = testAnswers.get(question.id) || null;

  testShuffledAnswers = renderTestQuestion(
    question,
    testCurrentIndex + 1,
    testQuestions.length,
    isMulti,
    appSettings.shuffleAnswers,
    storedShuffle,
    previousSelection
  );

  // Store shuffle order for this index
  if (!storedShuffle) {
    testShuffledMap.set(testCurrentIndex, testShuffledAnswers);
  }

  testSelectedIds = previousSelection ? new Set(previousSelection) : new Set();

  bindTestQuestionEvents(isMulti);
}

function bindTestQuestionEvents(isMulti) {
  const answersList = document.getElementById('test-answers-list');
  const nextBtn = document.getElementById('btn-test-next');

  answersList.addEventListener('click', (e) => {
    const option = e.target.closest('.answer-option');
    if (!option) return;

    const answerId = option.dataset.answerId;

    if (isMulti) {
      if (testSelectedIds.has(answerId)) {
        testSelectedIds.delete(answerId);
        option.classList.remove('selected');
      } else {
        testSelectedIds.add(answerId);
        option.classList.add('selected');
      }
    } else {
      testSelectedIds.clear();
      answersList.querySelectorAll('.answer-option').forEach(o => o.classList.remove('selected'));
      testSelectedIds.add(answerId);
      option.classList.add('selected');
    }

    nextBtn.disabled = testSelectedIds.size === 0;
  });

  nextBtn.addEventListener('click', () => {
    // Save answer
    const question = testQuestions[testCurrentIndex];
    testAnswers.set(question.id, new Set(testSelectedIds));

    testCurrentIndex++;
    if (testCurrentIndex < testQuestions.length) {
      showTestQuestion();
    } else {
      finishTest();
    }
  });

  const prevBtn = document.getElementById('btn-test-prev');
  if (prevBtn) {
    prevBtn.addEventListener('click', () => {
      // Save current answer before going back
      const question = testQuestions[testCurrentIndex];
      if (testSelectedIds.size > 0) {
        testAnswers.set(question.id, new Set(testSelectedIds));
      }

      testCurrentIndex--;
      showTestQuestion();
    });
  }
}

function finishTest() {
  let score = 0;
  const answers = testQuestions.map(q => {
    const selectedIds = testAnswers.get(q.id) || new Set();
    const correctIds = new Set(q.answers.filter(a => a.correct).map(a => a.id));

    // Correct if selected exactly matches correct
    const isCorrect =
      selectedIds.size === correctIds.size &&
      [...selectedIds].every(id => correctIds.has(id));

    if (isCorrect) score++;

    return {
      question: q,
      selectedIds,
      correctIds,
      correct: isCorrect,
    };
  });

  const deckMeta = storage.getDecks().find(d => d.id === currentDeckId);
  const deckName = deckMeta ? deckMeta.name : currentDeckId;

  showView('test-result');
  renderTestResult(deckName, { score, total: testQuestions.length, answers });
  bindTestResultEvents();
}

function bindTestResultEvents() {
  // Toggle expand for review items
  document.querySelectorAll('.test-review-header').forEach(header => {
    header.addEventListener('click', () => {
      header.closest('.test-review-item').classList.toggle('expanded');
    });
  });

  const retryBtn = document.getElementById('btn-test-retry');
  if (retryBtn) {
    retryBtn.addEventListener('click', () => {
      navigateToTestConfig(currentDeckId);
    });
  }

  const backBtn = document.getElementById('btn-test-back-to-decks');
  if (backBtn) {
    backBtn.addEventListener('click', () => {
      navigateToDeckList();
    });
  }
}

// --- Browse Mode ---

function navigateToBrowse(deckId) {
  currentDeckId = deckId;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  const deckName = deckMeta ? deckMeta.name : deckId;
  const questions = getFilteredQuestions(deckId);

  showView('browse');
  renderBrowse(deckName, questions);
  bindBrowseEvents();
}

function bindBrowseEvents() {
  const searchInput = document.getElementById('browse-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      const query = searchInput.value.toLowerCase().trim();
      document.querySelectorAll('.browse-item').forEach(item => {
        const text = item.dataset.searchText || '';
        item.style.display = text.includes(query) ? '' : 'none';
      });

      // Show "no results" message
      const visibleCount = document.querySelectorAll('.browse-item[style=""]').length +
        document.querySelectorAll('.browse-item:not([style])').length;
      const browseList = document.getElementById('browse-list');
      const existingEmpty = browseList.querySelector('.browse-empty');
      if (existingEmpty) existingEmpty.remove();

      const allHidden = [...document.querySelectorAll('.browse-item')].every(
        item => item.style.display === 'none'
      );
      if (allHidden && query) {
        const emptyEl = document.createElement('div');
        emptyEl.className = 'browse-empty';
        emptyEl.textContent = 'Brak wyników dla podanego zapytania.';
        browseList.appendChild(emptyEl);
      }
    });
  }
}

// --- Settings ---

function navigateToSettings(deckId, returnTo = 'mode-select') {
  currentDeckId = deckId;
  settingsReturnTo = returnTo;
  const deckMeta = storage.getDecks().find(d => d.id === deckId);
  document.getElementById('settings-deck-name').textContent = deckMeta ? deckMeta.name : deckId;

  showView('settings');
  renderSettings(settings, DEFAULT_SETTINGS);
  bindSettingsEvents(deckId);
}

function returnFromSettings() {
  if (settingsReturnTo === 'deck-list') {
    navigateToDeckList();
  } else {
    navigateToModeSelect(currentDeckId);
  }
}

// --- App Settings ---

function navigateToAppSettings() {
  showView('app-settings');
  renderAppSettings(appSettings, DEFAULT_APP_SETTINGS);
  bindAppSettingsEvents();
}

function bindAppSettingsEvents() {
  // Theme options
  document.querySelectorAll('.theme-option').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.theme-option').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      appSettings.theme = btn.dataset.theme;
      applyTheme(appSettings.theme);
      storage.saveAppSettings(appSettings);
    });
  });

  // Shuffle toggle
  const shuffleToggle = document.getElementById('toggle-shuffle');
  if (shuffleToggle) {
    shuffleToggle.addEventListener('change', () => {
      appSettings.shuffleAnswers = shuffleToggle.checked;
      storage.saveAppSettings(appSettings);
    });
  }

  // Question order toggle
  const orderToggle = document.getElementById('toggle-question-order');
  if (orderToggle) {
    orderToggle.addEventListener('change', () => {
      appSettings.questionOrder = orderToggle.checked ? 'ordered' : 'shuffled';
      storage.saveAppSettings(appSettings);
    });
  }

  // Randomize numbers toggle
  const randomizeToggle = document.getElementById('toggle-randomize');
  if (randomizeToggle) {
    randomizeToggle.addEventListener('change', () => {
      appSettings.randomizeNumbers = randomizeToggle.checked;
      storage.saveAppSettings(appSettings);
    });
  }

  // Keybinding record buttons
  document.querySelectorAll('.keybinding-record').forEach(btn => {
    btn.addEventListener('click', () => {
      startKeyRecording(btn.dataset.binding, btn);
    });
  });

  // Restore default keybindings
  const restoreBtn = document.getElementById('btn-restore-keybindings');
  if (restoreBtn) {
    restoreBtn.addEventListener('click', () => {
      appSettings.keybindings = { ...DEFAULT_APP_SETTINGS.keybindings };
      storage.saveAppSettings(appSettings);
      renderAppSettings(appSettings, DEFAULT_APP_SETTINGS);
      bindAppSettingsEvents();
      showNotification('Przywrócono domyślne skróty klawiszowe.', 'info');
    });
  }
}

let activeRecordingCleanup = null;

function startKeyRecording(bindingKey, buttonEl) {
  // Cancel any previous recording
  if (activeRecordingCleanup) activeRecordingCleanup();

  buttonEl.textContent = 'Naciśnij klawisz...';
  buttonEl.classList.add('recording');

  function onKey(e) {
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') {
      // Cancel
      cleanup();
      return;
    }

    // Set new keybinding (single key)
    appSettings.keybindings[bindingKey] = [e.key];
    storage.saveAppSettings(appSettings);

    cleanup();
    // Re-render
    renderAppSettings(appSettings, DEFAULT_APP_SETTINGS);
    bindAppSettingsEvents();
  }

  function cleanup() {
    document.removeEventListener('keydown', onKey, true);
    activeRecordingCleanup = null;
    buttonEl.textContent = 'Zmień';
    buttonEl.classList.remove('recording');
  }

  activeRecordingCleanup = cleanup;
  document.addEventListener('keydown', onKey, true);
}

// --- Deck Settings ---

function bindSettingsEvents(deckId) {
  document.getElementById('btn-save-settings').addEventListener('click', () => {
    saveSettings();
  });

  document.getElementById('btn-restore-defaults').addEventListener('click', () => {
    settings = { ...DEFAULT_SETTINGS };
    storage.saveSettings(settings);
    renderSettings(settings, DEFAULT_SETTINGS);
    bindSettingsEvents(deckId);
    showNotification('Przywrócono ustawienia domyślne.', 'info');
  });

  document.getElementById('btn-reset-progress').addEventListener('click', async () => {
    const confirmed = await showConfirm(
      'Resetuj postęp',
      'Czy na pewno chcesz zresetować postęp nauki? Wszystkie karty wrócą do stanu "nowe", a statystyki zostaną usunięte.'
    );
    if (confirmed) {
      deck.resetProgress(deckId);
      showNotification('Postęp talii został zresetowany.', 'info');
      returnFromSettings();
    }
  });
}

function parseSteps(value) {
  return value.split(',')
    .map(s => parseFloat(s.trim()))
    .filter(n => !isNaN(n) && n > 0);
}

function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

function saveSettings() {
  const newCardsPerDay = clamp(parseInt(document.getElementById('set-newCardsPerDay').value) || 20, 1, 100);
  const maxReviewsPerDay = clamp(parseInt(document.getElementById('set-maxReviewsPerDay').value) || 200, 1, 9999);
  const learningSteps = parseSteps(document.getElementById('set-learningSteps').value);
  const relearningSteps = parseSteps(document.getElementById('set-relearningSteps').value);
  const graduatingInterval = clamp(parseInt(document.getElementById('set-graduatingInterval').value) || 1, 1, 30);
  const easyInterval = clamp(parseInt(document.getElementById('set-easyInterval').value) || 4, 1, 60);
  const maximumInterval = clamp(parseInt(document.getElementById('set-maximumInterval').value) || 365, 1, 36500);

  if (learningSteps.length === 0) {
    showNotification('Kroki nauki muszą zawierać co najmniej jedną wartość.', 'error');
    return;
  }
  if (relearningSteps.length === 0) {
    showNotification('Kroki ponownej nauki muszą zawierać co najmniej jedną wartość.', 'error');
    return;
  }

  settings = {
    ...settings,
    newCardsPerDay,
    maxReviewsPerDay,
    learningSteps,
    relearningSteps,
    graduatingInterval,
    easyInterval,
    maximumInterval,
  };

  storage.saveSettings(settings);
  showNotification('Ustawienia zostały zapisane.', 'success');
  returnFromSettings();
}

// --- Study Session ---

function startStudySession() {
  const filterIds = getFilteredQuestionIds(currentDeckId);
  queues = deck.buildQueues(currentDeckId, settings, filterIds);
  sessionTotal = queues.counts.learningDue + queues.counts.reviewDue + queues.counts.newAvailable;
  studiedCount = 0;
  updateProgress(0, sessionTotal);
  showNextCard();
}

function showNextCard() {
  clearWaitTimer();
  studyPhase = null;
  const result = deck.getNextCard(queues, settings);

  if (!result) {
    navigateToComplete(currentDeckId);
    return;
  }

  if (result.source === 'learning_wait') {
    // Card is due soon but not yet — wait for it
    const delay = result.waitUntil - Date.now();
    if (delay <= 0) {
      // Actually due now
      currentCard = queues.learning.shift();
      currentSource = 'learning';
      showQuestionForCard(currentCard);
    } else {
      // Check if there are other cards we can show in the meantime
      // If not, either wait or end session
      if (queues.review.length > 0 || queues.newCards.length > 0) {
        // Skip the waiting card for now, try other queues
        const otherResult = tryOtherQueues();
        if (otherResult) {
          currentCard = otherResult.card;
          currentSource = otherResult.source;
          showQuestionForCard(currentCard);
          return;
        }
      }

      // Nothing else to do — wait for the learning card (like Anki)
      showLearningWaitScreen(delay);
      waitTimer = setTimeout(() => showNextCard(), delay + 100);
    }
    return;
  }

  currentCard = result.card;
  currentSource = result.source;
  showQuestionForCard(currentCard);
}

function tryOtherQueues() {
  // Try review
  if (queues.review.length > 0 && queues.counts.reviewsToday < settings.maxReviewsPerDay) {
    return { card: queues.review.shift(), source: 'review' };
  }
  // Try new
  if (queues.newCards.length > 0) {
    const card = queues.newCards.shift();
    card.state = 'learning';
    card.stepIndex = 0;
    card.firstStudiedDate = card.firstStudiedDate || Date.now();
    card.dueDate = Date.now();
    // Save immediately so NEW→LEARNING transition persists if user exits before rating
    deck.saveCardState(card);
    return { card, source: 'new' };
  }
  return null;
}

function showQuestionForCard(card) {
  const questions = storage.getQuestions(currentDeckId);
  currentQuestion = questions.find(q => q.id === card.questionId);

  if (!currentQuestion) {
    // Question missing from data — skip this card
    showNextCard();
    return;
  }

  // Apply randomization if enabled
  if (appSettings.randomizeNumbers && hasRandomizer(currentQuestion.id)) {
    const variant = randomize(currentQuestion.id);
    if (variant) {
      currentQuestion = { ...currentQuestion, text: variant.text, answers: variant.answers };
    }
  }

  const isMultiSelect = true;
  const cardNum = studiedCount + 1;

  currentShuffledAnswers = renderQuestion(currentQuestion, cardNum, sessionTotal, isMultiSelect, appSettings.shuffleAnswers);
  selectedAnswerIds = new Set();

  const now = Date.now();
  const learningDueCount = queues.learning.filter(c => c.dueDate <= now).length
    + (currentSource === 'learning' ? 1 : 0);
  updateStudyCounts(
    learningDueCount,
    queues.review.length + (currentSource === 'review' ? 1 : 0),
    queues.newCards.length + (currentSource === 'new' ? 1 : 0),
    currentSource
  );

  studyPhase = 'question';
  bindQuestionEvents(isMultiSelect);
}

// --- Event Binding ---

function bindGlobalEvents() {
  // Keyboard shortcuts
  document.addEventListener('keydown', handleKeyDown);

  // Font size controls
  document.getElementById('btn-font-decrease').addEventListener('click', () => changeFontSize(-1));
  document.getElementById('btn-font-increase').addEventListener('click', () => changeFontSize(1));

  // App settings button
  document.getElementById('btn-app-settings').addEventListener('click', () => {
    navigateToAppSettings();
  });

  // Import button
  document.getElementById('btn-import').addEventListener('click', () => {
    document.getElementById('file-input').click();
  });

  // File input
  document.getElementById('file-input').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = ''; // reset

    const result = await importFromFile(file);
    if (result.valid) {
      showNotification(
        `Zaimportowano "${result.deck.name}": ${result.added} nowych, ${result.updated} istniejących, ${result.total} łącznie.`,
        'success'
      );
      navigateToDeckList();
    } else {
      showNotification(`Błąd importu: ${result.errors[0]}`, 'error');
    }
  });

  // Back buttons
  document.getElementById('btn-back-to-decks').addEventListener('click', () => {
    navigateToDeckList();
  });
  document.getElementById('btn-back-from-complete').addEventListener('click', () => {
    navigateToDeckList();
  });
  document.getElementById('btn-back-from-categories').addEventListener('click', () => {
    navigateToDeckList();
  });
  document.getElementById('btn-back-from-mode-select').addEventListener('click', () => {
    const deckMeta = currentDeckId ? storage.getDecks().find(d => d.id === currentDeckId) : null;
    if (deckMeta && deckMeta.categories) {
      navigateToCategorySelect(currentDeckId);
    } else {
      navigateToDeckList();
    }
  });
  document.getElementById('btn-back-from-test').addEventListener('click', () => {
    navigateToModeSelect(currentDeckId);
  });
  document.getElementById('btn-back-from-test-result').addEventListener('click', () => {
    navigateToModeSelect(currentDeckId);
  });
  document.getElementById('btn-back-from-browse').addEventListener('click', () => {
    navigateToModeSelect(currentDeckId);
  });
  document.getElementById('btn-back-from-app-settings').addEventListener('click', () => {
    navigateToDeckList();
  });
  document.getElementById('btn-back-from-settings').addEventListener('click', () => {
    returnFromSettings();
  });
}

function bindDeckListEvents() {
  // Study buttons → go to category select (if categories) or mode select
  document.querySelectorAll('.btn-study').forEach(btn => {
    btn.addEventListener('click', () => {
      const deckId = btn.dataset.deckId;
      const deckMeta = storage.getDecks().find(d => d.id === deckId);
      if (deckMeta && deckMeta.categories) {
        navigateToCategorySelect(deckId);
      } else {
        navigateToModeSelect(deckId);
      }
    });
  });

  // Settings buttons on deck cards
  document.querySelectorAll('.btn-deck-settings').forEach(btn => {
    btn.addEventListener('click', () => {
      navigateToSettings(btn.dataset.deckId, 'deck-list');
    });
  });

  // Delete buttons
  document.querySelectorAll('.btn-delete-deck').forEach(btn => {
    btn.addEventListener('click', async () => {
      const confirmed = await showConfirm(
        'Usuń talię',
        `Czy na pewno chcesz usunąć "${btn.dataset.deckName}"? Cały postęp nauki zostanie utracony.`
      );
      if (confirmed) {
        deck.removeDeck(btn.dataset.deckId);
        showNotification('Talia została usunięta.', 'info');
        navigateToDeckList();
      }
    });
  });

  // Empty state import button
  const emptyImportBtn = document.getElementById('btn-import-empty');
  if (emptyImportBtn) {
    emptyImportBtn.addEventListener('click', () => {
      document.getElementById('file-input').click();
    });
  }
}

function bindQuestionEvents(isMultiSelect) {
  const answersList = document.getElementById('answers-list');
  const checkBtn = document.getElementById('btn-check-answer');

  answersList.addEventListener('click', (e) => {
    const option = e.target.closest('.answer-option');
    if (!option) return;

    const answerId = option.dataset.answerId;

    if (isMultiSelect) {
      if (selectedAnswerIds.has(answerId)) {
        selectedAnswerIds.delete(answerId);
        option.classList.remove('selected');
      } else {
        selectedAnswerIds.add(answerId);
        option.classList.add('selected');
      }
    } else {
      selectedAnswerIds.clear();
      answersList.querySelectorAll('.answer-option').forEach(o => o.classList.remove('selected'));
      selectedAnswerIds.add(answerId);
      option.classList.add('selected');
    }

    checkBtn.textContent = selectedAnswerIds.size > 0 ? 'Sprawdź odpowiedź' : 'Pokaż odpowiedź';
  });

  checkBtn.addEventListener('click', () => {
    showFeedback();
  });

  bindEditButton();
}

function showFeedback() {
  studyPhase = 'feedback';
  const intervals = getButtonIntervals(currentCard, settings);

  renderAnswerFeedback(
    currentQuestion,
    currentShuffledAnswers,
    selectedAnswerIds,
    currentQuestion.explanation || null,
    intervals,
    appSettings.keybindings
  );

  // Bind rating buttons
  document.querySelectorAll('.rating-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const rating = parseInt(btn.dataset.rating);
      handleRating(rating);
    });
  });

  bindEditButton();
}

// --- Question Editor ---

let editReturnPhase = null; // 'question' | 'feedback'

function bindEditButton() {
  const editBtn = document.getElementById('btn-edit-question');
  if (editBtn) {
    editBtn.addEventListener('click', () => {
      enterEditMode();
    });
  }
}

function enterEditMode() {
  editReturnPhase = studyPhase;
  studyPhase = null; // disable keyboard shortcuts while editing

  renderQuestionEditor(currentQuestion);

  // Cancel
  document.getElementById('btn-editor-cancel').addEventListener('click', () => {
    exitEditMode();
  });

  // Save
  document.getElementById('btn-editor-save').addEventListener('click', () => {
    saveQuestionEdit();
  });
}

function exitEditMode() {
  if (editReturnPhase === 'feedback') {
    showFeedback();
  } else {
    // Re-render question phase
    const isMultiSelect = true;
    const cardNum = studiedCount + 1;
    currentShuffledAnswers = renderQuestion(currentQuestion, cardNum, sessionTotal, isMultiSelect, appSettings.shuffleAnswers);
    selectedAnswerIds = new Set();
    studyPhase = 'question';
    bindQuestionEvents(isMultiSelect);
  }
  editReturnPhase = null;
}

function saveQuestionEdit() {
  const newText = document.getElementById('editor-question-text').value.trim();
  if (!newText) {
    showNotification('Treść pytania nie może być pusta.', 'error');
    return;
  }

  const newExplanation = document.getElementById('editor-explanation').value.trim();

  // Read answers
  const answerRows = document.querySelectorAll('.editor-answer-row');
  const updatedAnswers = [];
  let hasCorrect = false;

  for (const row of answerRows) {
    const id = row.dataset.answerId;
    const text = row.querySelector('.editor-answer-text').value.trim();
    const correct = row.querySelector('.editor-answer-correct').checked;

    if (!text) {
      showNotification('Odpowiedź nie może być pusta.', 'error');
      return;
    }

    if (correct) hasCorrect = true;
    updatedAnswers.push({ id, text, correct });
  }

  if (!hasCorrect) {
    showNotification('Co najmniej jedna odpowiedź musi być poprawna.', 'error');
    return;
  }

  // Update question in storage
  const questions = storage.getQuestions(currentDeckId);
  const qIndex = questions.findIndex(q => q.id === currentQuestion.id);
  if (qIndex !== -1) {
    questions[qIndex].text = newText;
    questions[qIndex].answers = updatedAnswers;
    questions[qIndex].explanation = newExplanation || undefined;
    storage.saveQuestions(currentDeckId, questions);

    // Update in-memory reference
    currentQuestion = questions[qIndex];
    // Update shuffled answers to reflect any text/correct changes
    currentShuffledAnswers = currentShuffledAnswers.map(sa => {
      const updated = updatedAnswers.find(a => a.id === sa.id);
      return updated || sa;
    });
  }

  showNotification('Pytanie zostało zaktualizowane.', 'success');
  exitEditMode();
}

function handleRating(rating) {
  // Process the SM-2 algorithm
  const updatedCard = processRating(currentCard, rating, settings);

  // Save card state
  deck.saveCardState(updatedCard);

  // Record stats
  deck.recordStat(currentDeckId, rating, currentSource);

  // Re-queue if still in learning
  deck.requeueCard(updatedCard, queues);

  // Update counts
  if (currentSource === 'review') {
    queues.counts.reviewsToday++;
  }

  studiedCount++;
  updateProgress(studiedCount, sessionTotal);

  // Next card
  showNextCard();
}

function bindCompleteEvents() {
  const btn = document.getElementById('btn-back-to-decks-complete');
  if (btn) {
    btn.addEventListener('click', () => {
      navigateToDeckList();
    });
  }
}

let waitCountdownTimer = null;

function showLearningWaitScreen(delayMs) {
  const endTime = Date.now() + delayMs;

  function updateCountdown() {
    const remaining = Math.max(0, endTime - Date.now());
    if (remaining <= 0) return;

    const totalSec = Math.ceil(remaining / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const timeStr = min > 0
      ? `${min}:${String(sec).padStart(2, '0')}`
      : `${sec}s`;

    const countdownEl = document.getElementById('wait-countdown');
    if (countdownEl) countdownEl.textContent = timeStr;
  }

  document.getElementById('study-content').innerHTML = `
    <div class="question-card" style="text-align: center; padding: 40px;">
      <div style="font-size: 1.1rem; color: var(--color-text-secondary); margin-bottom: 12px;">
        Następna karta za chwilę...
      </div>
      <div id="wait-countdown" style="font-size: 2rem; font-weight: 600; color: var(--color-text-primary); margin-bottom: 16px;">
      </div>
      <button id="btn-end-session-early" class="btn btn-secondary" style="margin-top: 8px;">
        Zakończ sesję
      </button>
    </div>
  `;

  updateCountdown();
  clearInterval(waitCountdownTimer);
  waitCountdownTimer = setInterval(updateCountdown, 1000);

  document.getElementById('btn-end-session-early').addEventListener('click', () => {
    clearWaitTimer();
    navigateToComplete(currentDeckId);
  });
}

function clearWaitTimer() {
  if (waitTimer) {
    clearTimeout(waitTimer);
    waitTimer = null;
  }
  if (waitCountdownTimer) {
    clearInterval(waitCountdownTimer);
    waitCountdownTimer = null;
  }
}

// --- Start ---

document.addEventListener('DOMContentLoaded', init);
