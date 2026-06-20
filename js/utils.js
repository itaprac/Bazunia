// utils.js — Shared utility functions

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUTE_MS = 60 * 1000;
const SELECTION_MODES = Object.freeze({
  SINGLE: 'single',
  MULTIPLE: 'multiple',
});

/**
 * Fisher-Yates shuffle. Returns a NEW array (does not mutate input).
 */
export function shuffle(array) {
  const result = [...array];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

/**
 * Returns the start of the day (midnight local time) for a given timestamp.
 */
export function startOfDay(timestamp = Date.now()) {
  const d = new Date(timestamp);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Returns the number of whole days between two timestamps.
 */
export function daysBetween(ts1, ts2) {
  return Math.floor(Math.abs(ts2 - ts1) / DAY_MS);
}

/**
 * Formats a timestamp as YYYY-MM-DD.
 */
export function formatDate(timestamp) {
  const d = new Date(timestamp);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * Formats an interval (in minutes) to a human-readable string.
 * Examples: "1m", "10m", "1d", "3d", "1.5mo", "1y"
 */
export function formatInterval(totalMinutes) {
  if (totalMinutes < 1) return '<1m';
  if (totalMinutes < 60) return `${Math.round(totalMinutes)}m`;
  if (totalMinutes < 60 * 24) {
    const hours = totalMinutes / 60;
    return hours === Math.floor(hours) ? `${hours}h` : `${hours.toFixed(1)}h`;
  }
  const days = totalMinutes / (60 * 24);
  if (days < 31) {
    return days === Math.floor(days) ? `${days}d` : `${days.toFixed(1)}d`;
  }
  const months = days / 30;
  if (months < 12) {
    return months === Math.floor(months) ? `${months}mo` : `${months.toFixed(1)}mo`;
  }
  const years = days / 365;
  return years === Math.floor(years) ? `${years}y` : `${years.toFixed(1)}y`;
}

/**
 * Generate a unique ID.
 */
export function generateId() {
  if (crypto && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}

/**
 * Random integer in [min, max] inclusive.
 */
export function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

const HTML_ENTITY_REPLACEMENTS = Object.freeze({
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
});

function unescapeHtmlEntities(text) {
  return String(text || '').replace(/&(amp|lt|gt|quot|#39);/g, entity => (
    HTML_ENTITY_REPLACEMENTS[entity] || entity
  ));
}

function normalizeMathShorthand(tex) {
  return String(tex || '')
    .replace(/\.\.\./g, '\\ldots')
    .replace(/\b([A-Za-z])([0-9]+)dot\b/g, '\\dot{$1}_{$2}')
    .replace(/\b([A-Za-z])dot\b/g, '\\dot{$1}')
    .replace(/([A-Za-z])˙([0-9]+)/g, '\\dot{$1}_{$2}')
    .replace(/([A-Za-z])˙/g, '\\dot{$1}')
    .replace(/([A-Za-z])¨/g, '\\ddot{$1}')
    .replace(/\bint_/g, '\\int_')
    .replace(/\binfty\b/g, '\\infty')
    .replace(/\b(sin|cos|tan|log|ln|exp)\s*\(/g, '\\$1(')
    .replace(/\^\(([^()]+)\)/g, '^{$1}')
    .replace(/<=/g, '\\le ')
    .replace(/>=/g, '\\ge ')
    .replace(/\*/g, '\\cdot ');
}

function looksLikeInlineMath(text) {
  const raw = unescapeHtmlEntities(text).trim();
  if (!raw) return false;
  if (/^-?\d+(?:,\s*-?\d+)+$/.test(raw)) return false;
  return /[=+\-*/^_()[\]{}]|(?:dot|˙|¨|int_|infty|sqrt|sin|cos|tan|log|ln|exp)\b|[A-Za-z][0-9]/.test(raw);
}

function renderMath(tex, displayMode = false, normalizeShorthand = false) {
  const unescaped = unescapeHtmlEntities(tex).trim();
  const normalized = normalizeShorthand ? normalizeMathShorthand(unescaped) : unescaped;
  return katex.renderToString(normalized, { throwOnError: false, displayMode });
}

/**
 * Replace LaTeX fragments in already-escaped HTML with rendered KaTeX.
 * Supports $$...$$, \(...\), \[...\] and math-looking `backtick` snippets.
 * Falls back to raw text if KaTeX is not loaded.
 */
export function renderLatex(html) {
  if (typeof katex === 'undefined') return html;

  let rendered = html.replace(/\$\$([\s\S]*?)\$\$/g, (match, tex) => {
    try {
      return renderMath(tex, false);
    } catch {
      return match;
    }
  });

  rendered = rendered.replace(/\\\(([\s\S]*?)\\\)/g, (match, tex) => {
    try {
      return renderMath(tex, false);
    } catch {
      return match;
    }
  });

  rendered = rendered.replace(/\\\[([\s\S]*?)\\\]/g, (match, tex) => {
    try {
      return renderMath(tex, true);
    } catch {
      return match;
    }
  });

  return rendered.replace(/`([^`]+)`/g, (match, tex) => {
    if (!looksLikeInlineMath(tex)) return match;
    try {
      return renderMath(tex, false, true);
    } catch {
      return match;
    }
  });
}

/**
 * Returns true if the question is a flashcard (no ABCD answers).
 */
export function isFlashcard(question) {
  return !question.answers || question.answers.length === 0;
}

export function normalizeSelectionMode(value, fallback = SELECTION_MODES.MULTIPLE) {
  if (value === SELECTION_MODES.SINGLE || value === SELECTION_MODES.MULTIPLE) {
    return value;
  }
  return fallback;
}

export function getDeckDefaultSelectionMode(deckMeta = null, fallback = SELECTION_MODES.MULTIPLE) {
  return normalizeSelectionMode(deckMeta?.defaultSelectionMode, fallback);
}

export function getQuestionSelectionMode(question, deckDefaultSelectionMode = SELECTION_MODES.MULTIPLE) {
  return normalizeSelectionMode(question?.selectionMode, normalizeSelectionMode(deckDefaultSelectionMode));
}

export function getCorrectAnswerCount(question) {
  if (!Array.isArray(question?.answers)) return 0;
  return question.answers.reduce((count, answer) => {
    return answer?.correct === true ? count + 1 : count;
  }, 0);
}

export function getEffectiveQuestionSelectionMode(question, deckDefaultSelectionMode = SELECTION_MODES.MULTIPLE) {
  const mode = getQuestionSelectionMode(question, deckDefaultSelectionMode);
  if (mode !== SELECTION_MODES.SINGLE) return mode;

  // If a single-choice question resolves to multiple correct answers at runtime
  // (e.g. via correctWhen), temporarily treat it as multiple-choice.
  const correctCount = getCorrectAnswerCount(question);
  return correctCount > 1 ? SELECTION_MODES.MULTIPLE : SELECTION_MODES.SINGLE;
}

export { DAY_MS, MINUTE_MS, SELECTION_MODES };
