// deck.js — Deck management, queue building, session orchestration

import { CARD_STATES, isNew, isDue, isLearning, isRelearning, isReview, isFlagged, createCard } from './card.js';
import { startOfDay, formatDate, DAY_MS, MINUTE_MS, shuffle } from './utils.js';
import { DEFAULT_SETTINGS } from './sm2.js';
import * as storage from './storage.js';

function ensureDeckIdOnCards(deckId, cards) {
  let changed = false;
  const normalized = cards.map((card) => {
    if (card.deckId === deckId) return card;
    changed = true;
    return { ...card, deckId };
  });
  return { normalized, changed };
}

function toSafeCount(value) {
  const num = Number(value);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return Math.floor(num);
}

function toScope(value) {
  return value === 'public' || value === 'private' || value === 'subscribed'
    ? value
    : 'private';
}

function toPercent(numerator, denominator) {
  if (denominator <= 0) return 0;
  return Math.round((numerator / denominator) * 1000) / 10;
}

function dateKeyToStartOfDay(dateKey) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dateKey || ''))) return NaN;
  const dt = new Date(`${dateKey}T00:00:00`);
  return Number.isNaN(dt.getTime()) ? NaN : startOfDay(dt.getTime());
}

/**
 * Build study queues for a deck. Returns { learning, review, newCards, counts }.
 */
export function buildQueues(
  deckId,
  settings = DEFAULT_SETTINGS,
  questionIdFilter = null,
  includeFlagged = false,
  options = {}
) {
  const questionOrder = options?.questionOrder === 'ordered' ? 'ordered' : 'shuffled';
  const now = Date.now();
  const today = startOfDay(now);
  const { normalized, changed } = ensureDeckIdOnCards(deckId, storage.getCards(deckId));
  let cards = normalized;

  // Repair legacy cards without deckId to keep progress persistence reliable.
  if (changed) {
    storage.saveCards(deckId, cards);
  }

  if (questionIdFilter) {
    const filterSet = new Set(questionIdFilter);
    cards = cards.filter(c => filterSet.has(c.questionId));
  }

  // Exclude flagged cards from study queues (unless explicitly studying flagged)
  if (!includeFlagged) {
    cards = cards.filter(c => !isFlagged(c));
  }

  // Learning/Relearning cards (all — including not-yet-due so sessions resume properly)
  const learningCandidates = cards.filter(c => isLearning(c) || isRelearning(c));
  const learningBase = questionOrder === 'ordered' ? learningCandidates : shuffle(learningCandidates);
  const learning = learningBase.sort((a, b) => a.dueDate - b.dueDate);

  // Review cards due today or earlier
  const reviewCandidates = cards.filter(c => isReview(c) && c.dueDate <= now);
  const reviewBase = questionOrder === 'ordered' ? reviewCandidates : shuffle(reviewCandidates);
  const review = reviewBase.sort((a, b) => a.dueDate - b.dueDate);

  // Count new cards already introduced today
  const newCardsToday = cards.filter(c =>
    c.firstStudiedDate != null && startOfDay(c.firstStudiedDate) === today
  ).length;

  const newCardsRemaining = Math.max(0, settings.newCardsPerDay - newCardsToday);

  // New cards (not yet studied)
  const newCandidates = cards.filter(c => isNew(c));
  const orderedNewCards = questionOrder === 'ordered' ? newCandidates : shuffle(newCandidates);
  const newCards = orderedNewCards.slice(0, newCardsRemaining);

  // Count reviews done today
  const reviewsToday = cards.filter(c =>
    c.lastReviewDate != null &&
    startOfDay(c.lastReviewDate) === today &&
    isReview(c)
  ).length;

  return {
    learning,
    review,
    newCards,
    counts: {
      learningDue: learning.filter(c => c.dueDate <= now).length,
      learningTotal: learning.length,
      reviewDue: review.length,
      newAvailable: newCards.length,
      newCardsToday,
      reviewsToday,
      totalCards: cards.length,
      totalNew: cards.filter(c => isNew(c)).length,
    },
  };
}

/**
 * Get the next card to study from the queues.
 * Priority: learning > review > new.
 * Returns { card, source } or null if session complete.
 */
export function getNextCard(queues, settings = DEFAULT_SETTINGS) {
  const now = Date.now();

  // 1. Learning/Relearning cards take priority
  if (queues.learning.length > 0 && queues.learning[0].dueDate <= now) {
    return { card: queues.learning.shift(), source: 'learning' };
  }

  // 2. Review cards
  if (queues.review.length > 0 && queues.counts.reviewsToday < settings.maxReviewsPerDay) {
    return { card: queues.review.shift(), source: 'review' };
  }

  // 3. New cards
  if (queues.newCards.length > 0) {
    const card = queues.newCards.shift();
    card.state = CARD_STATES.LEARNING;
    card.stepIndex = 0;
    card.firstStudiedDate = card.firstStudiedDate || now;
    card.dueDate = now; // due immediately
    // Save immediately so NEW→LEARNING transition persists if user exits before rating
    saveCardState(card);
    return { card, source: 'new' };
  }

  // 4. Check if there are learning cards due soon (within session)
  if (queues.learning.length > 0) {
    const timeUntilDue = queues.learning[0].dueDate - now;
    const learnAheadMs = (settings.learnAheadLimit || 20) * MINUTE_MS;

    // Learn ahead: show the card early if within the limit (like Anki)
    if (timeUntilDue <= learnAheadMs) {
      return { card: queues.learning.shift(), source: 'learning' };
    }

    // Beyond learn-ahead limit — wait
    return { card: queues.learning[0], source: 'learning_wait', waitUntil: queues.learning[0].dueDate };
  }

  return null;
}

/**
 * After processing a rating, put the card back into the appropriate queue if still due.
 */
export function requeueCard(card, queues) {
  if (isFlagged(card)) return;
  const now = Date.now();

  if (card.state === CARD_STATES.LEARNING || card.state === CARD_STATES.RELEARNING) {
    // Insert into learning queue sorted by dueDate
    const idx = queues.learning.findIndex(c => c.dueDate > card.dueDate);
    if (idx === -1) {
      queues.learning.push(card);
    } else {
      queues.learning.splice(idx, 0, card);
    }
  }
  // Review and graduated cards don't go back into session queues
}

/**
 * Save card state back to storage after rating.
 */
export function saveCardState(card, fallbackDeckId = null) {
  const targetDeckId = card.deckId || fallbackDeckId;
  if (!targetDeckId) {
    return;
  }

  const nextCard = card.deckId === targetDeckId ? card : { ...card, deckId: targetDeckId };
  const cards = storage.getCards(targetDeckId);
  const idx = cards.findIndex(c => c.questionId === card.questionId);
  if (idx >= 0) {
    cards[idx] = nextCard;
  }
  storage.saveCards(targetDeckId, cards);
}

/**
 * Record a rating in daily stats.
 */
export function recordStat(deckId, rating, cardSource) {
  const stats = storage.getStats(deckId);
  const today = formatDate(Date.now());

  if (!stats[today]) {
    stats[today] = {
      newStudied: 0,
      reviewsDone: 0,
      learningSteps: 0,
      againCount: 0,
      hardCount: 0,
      goodCount: 0,
      easyCount: 0,
    };
  }

  const s = stats[today];
  if (cardSource === 'new') s.newStudied++;
  if (cardSource === 'review') s.reviewsDone++;
  if (cardSource === 'learning' || cardSource === 'learning_wait') s.learningSteps++;

  if (rating === 1) s.againCount++;
  if (rating === 2) s.hardCount++;
  if (rating === 3) s.goodCount++;
  if (rating === 4) s.easyCount++;

  storage.saveStats(deckId, stats);
}

/**
 * Get summary stats for a deck (for the deck list screen).
 */
export function getDeckStats(deckId, settings = DEFAULT_SETTINGS, includeFlagged = false) {
  const now = Date.now();
  const today = startOfDay(now);
  const allCards = storage.peekCards(deckId);
  if (allCards.length === 0) {
    const deckMeta = storage.getDecks().find((d) => d.id === deckId) || null;
    const fallbackQuestionCount = Number.isFinite(deckMeta?.questionCount)
      ? Math.max(0, Math.floor(deckMeta.questionCount))
      : 0;
    const fallbackNewAvailable = Math.min(
      fallbackQuestionCount,
      Math.max(0, Number(settings?.newCardsPerDay) || 0)
    );
    return {
      dueToday: 0,
      dueReview: 0,
      dueLearning: 0,
      learningTotal: 0,
      newAvailable: fallbackNewAvailable,
      totalNew: fallbackQuestionCount,
      totalCards: fallbackQuestionCount,
      learned: 0,
      flagged: 0,
    };
  }

  let flaggedCount = 0;
  let dueReview = 0;
  let dueLearning = 0;
  let totalNew = 0;
  let learningTotal = 0;
  let newCardsToday = 0;
  let totalCards = 0;
  let learned = 0;

  for (const card of allCards) {
    const flagged = isFlagged(card);
    if (flagged) {
      flaggedCount++;
      if (!includeFlagged) continue;
    }
    totalCards++;

    if (isNew(card)) {
      totalNew++;
      if (card.firstStudiedDate != null && startOfDay(card.firstStudiedDate) === today) {
        newCardsToday++;
      }
      continue;
    }

    if (isLearning(card) || isRelearning(card)) {
      learningTotal++;
      if (card.dueDate <= now) {
        dueLearning++;
      }
      continue;
    }

    if (isReview(card)) {
      learned++;
      if (card.dueDate <= now) {
        dueReview++;
      }
    }
  }

  const newAvailable = Math.min(totalNew, Math.max(0, settings.newCardsPerDay - newCardsToday));

  return {
    dueToday: dueReview + dueLearning,
    dueReview,
    dueLearning,
    learningTotal,
    newAvailable,
    totalNew,
    totalCards,
    learned,
    flagged: flaggedCount,
  };
}

/**
 * Get today's session stats for end-of-session screen.
 */
export function getTodayStats(deckId) {
  const stats = storage.getStats(deckId);
  const today = formatDate(Date.now());
  return stats[today] || {
    newStudied: 0,
    reviewsDone: 0,
    learningSteps: 0,
    againCount: 0,
    hardCount: 0,
    goodCount: 0,
    easyCount: 0,
  };
}

/**
 * Build aggregated model for global statistics dashboard.
 */
export function getStatsDashboardData(options = {}) {
  const decks = Array.isArray(options.decks) ? options.decks : [];
  const includeFlagged = options.includeFlagged === true;
  const getDeckSettings = typeof options.getDeckSettings === 'function'
    ? options.getDeckSettings
    : (() => DEFAULT_SETTINGS);

  const totals = {
    totalAnswers: 0,
    againCount: 0,
    hardCount: 0,
    goodCount: 0,
    easyCount: 0,
    successRatePct: 0,
    newStudied: 0,
    reviewsDone: 0,
    learningSteps: 0,
    activeDays: 0,
    currentStreakDays: 0,
    firstActivityDate: null,
    lastActivityDate: null,
  };

  const activityByDay = new Map();
  const deckRows = [];
  const todayStart = startOfDay(Date.now());
  const chartDays = [];
  let chartMax = 0;

  for (const deckMeta of decks) {
    if (!deckMeta || typeof deckMeta !== 'object') continue;
    const deckId = String(deckMeta.id || '').trim();
    if (!deckId) continue;

    const stats = storage.getStats(deckId);
    const perDay = stats && typeof stats === 'object' ? stats : {};
    const row = {
      deckId,
      deckName: String(deckMeta.name || deckId),
      scope: toScope(deckMeta.scope),
      totalAnswers: 0,
      successRatePct: 0,
      newStudied: 0,
      reviewsDone: 0,
      learningSteps: 0,
      lastActivityDate: null,
      dueToday: 0,
    };

    for (const [dateKey, statRaw] of Object.entries(perDay)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) continue;
      const stat = statRaw && typeof statRaw === 'object' ? statRaw : {};

      const againCount = toSafeCount(stat.againCount);
      const hardCount = toSafeCount(stat.hardCount);
      const goodCount = toSafeCount(stat.goodCount);
      const easyCount = toSafeCount(stat.easyCount);
      const totalAnswers = againCount + hardCount + goodCount + easyCount;

      const newStudied = toSafeCount(stat.newStudied);
      const reviewsDone = toSafeCount(stat.reviewsDone);
      const learningSteps = toSafeCount(stat.learningSteps);

      row.againCount = (row.againCount || 0) + againCount;
      row.hardCount = (row.hardCount || 0) + hardCount;
      row.goodCount = (row.goodCount || 0) + goodCount;
      row.easyCount = (row.easyCount || 0) + easyCount;
      row.totalAnswers += totalAnswers;
      row.newStudied += newStudied;
      row.reviewsDone += reviewsDone;
      row.learningSteps += learningSteps;

      totals.againCount += againCount;
      totals.hardCount += hardCount;
      totals.goodCount += goodCount;
      totals.easyCount += easyCount;
      totals.newStudied += newStudied;
      totals.reviewsDone += reviewsDone;
      totals.learningSteps += learningSteps;

      if (totalAnswers > 0) {
        const prev = activityByDay.get(dateKey) || 0;
        activityByDay.set(dateKey, prev + totalAnswers);
        if (!row.lastActivityDate || dateKey > row.lastActivityDate) {
          row.lastActivityDate = dateKey;
        }
      }
    }

    row.successRatePct = toPercent(
      (row.goodCount || 0) + (row.easyCount || 0),
      row.totalAnswers
    );
    delete row.againCount;
    delete row.hardCount;
    delete row.goodCount;
    delete row.easyCount;

    const deckStats = getDeckStats(deckId, getDeckSettings(deckId), includeFlagged);
    row.dueToday = toSafeCount(deckStats?.dueToday);
    deckRows.push(row);
  }

  totals.totalAnswers = totals.againCount + totals.hardCount + totals.goodCount + totals.easyCount;
  totals.successRatePct = toPercent(totals.goodCount + totals.easyCount, totals.totalAnswers);

  const activeDates = Array.from(activityByDay.entries())
    .filter(([, count]) => count > 0)
    .map(([date]) => date)
    .sort((a, b) => (a < b ? -1 : 1));

  totals.activeDays = activeDates.length;
  totals.firstActivityDate = activeDates.length > 0 ? activeDates[0] : null;
  totals.lastActivityDate = activeDates.length > 0 ? activeDates[activeDates.length - 1] : null;

  const firstActivityStart = dateKeyToStartOfDay(totals.firstActivityDate);
  const historyDaysAvailable = Number.isFinite(firstActivityStart)
    ? Math.max(1, Math.floor((todayStart - firstActivityStart) / DAY_MS) + 1)
    : 0;

  let streak = 0;
  for (let offset = 0; ; offset++) {
    const dateKey = formatDate(todayStart - offset * DAY_MS);
    if ((activityByDay.get(dateKey) || 0) <= 0) break;
    streak++;
  }
  totals.currentStreakDays = streak;

  for (let offset = 59; offset >= 0; offset--) {
    const dateKey = formatDate(todayStart - offset * DAY_MS);
    const answers = activityByDay.get(dateKey) || 0;
    chartDays.push({ date: dateKey, answers });
    if (answers > chartMax) chartMax = answers;
  }

  deckRows.sort((a, b) => {
    if (b.totalAnswers !== a.totalAnswers) return b.totalAnswers - a.totalAnswers;
    const aDate = a.lastActivityDate || '';
    const bDate = b.lastActivityDate || '';
    return bDate.localeCompare(aDate);
  });

  const activityByDate = {};
  for (const [dateKey, count] of activityByDay.entries()) {
    if (count > 0) {
      activityByDate[dateKey] = count;
    }
  }

  return {
    totals,
    chart: {
      days: chartDays,
      maxAnswers: chartMax,
      activityByDate,
      today: formatDate(todayStart),
      defaultRangeDays: 60,
      historyDaysAvailable,
    },
    decks: deckRows,
    generatedAt: Date.now(),
  };
}

/**
 * Get per-category stats for decks with categories.
 */
export function getDeckCategoryStats(deckId, categories, includeFlagged = false) {
  const now = Date.now();
  const cards = storage.peekCards(deckId);
  const questions = storage.peekQuestions(deckId);

  // Build questionId → category map
  const qCatMap = new Map();
  for (const q of questions) {
    if (q.category) qCatMap.set(q.id, q.category);
  }

  const statsMap = {};
  for (const cat of categories) {
    statsMap[cat.id] = { due: 0, newCount: 0, learning: 0 };
  }

  for (const card of cards) {
    if (!includeFlagged && isFlagged(card)) continue;
    const catId = qCatMap.get(card.questionId);
    if (!catId || !statsMap[catId]) continue;

    if (isNew(card)) {
      statsMap[catId].newCount++;
    } else if (isLearning(card) || isRelearning(card)) {
      if (card.dueDate <= now) {
        statsMap[catId].due++;
      } else {
        statsMap[catId].learning++;
      }
    } else if (isReview(card) && card.dueDate <= now) {
      statsMap[catId].due++;
    }
  }

  return statsMap;
}

/**
 * Remove a deck and all its data.
 */
export function removeDeck(deckId) {
  const decks = storage.getDecks().filter(d => d.id !== deckId);
  storage.saveDecks(decks);
  storage.clearDeckData(deckId);
}

/**
 * Reset all cards in a deck to "new" state, clearing SRS progress and stats.
 */
export function resetProgress(deckId) {
  const cards = storage.getCards(deckId);
  const resetCards = cards.map(c => {
    const fresh = createCard(c.questionId, c.deckId);
    fresh.flagged = !!c.flagged; // preserve flagged status
    return fresh;
  });
  storage.saveCards(deckId, resetCards);
  storage.saveStats(deckId, {});
}

/**
 * Set or clear the flagged status on a card.
 */
export function setCardFlagged(deckId, questionId, flagged) {
  const cards = storage.getCards(deckId);
  const idx = cards.findIndex(c => c.questionId === questionId);
  if (idx >= 0) {
    cards[idx].flagged = flagged;
    storage.saveCards(deckId, cards);
    return cards[idx];
  }
  return null;
}

/**
 * Get count of flagged cards in a deck (optionally filtered by question IDs).
 */
export function getFlaggedCount(deckId, questionIdFilter = null) {
  let cards = storage.getCards(deckId);
  if (questionIdFilter) {
    const filterSet = new Set(questionIdFilter);
    cards = cards.filter(c => filterSet.has(c.questionId));
  }
  return cards.filter(c => isFlagged(c)).length;
}

/**
 * Get question IDs of all flagged cards in a deck.
 */
export function getFlaggedQuestionIds(deckId, questionIdFilter = null) {
  let cards = storage.getCards(deckId);
  if (questionIdFilter) {
    const filterSet = new Set(questionIdFilter);
    cards = cards.filter(c => filterSet.has(c.questionId));
  }
  return cards.filter(c => isFlagged(c)).map(c => c.questionId);
}
