import { SCORE } from './constants.js';

/** Arcade high-score table persisted in localStorage. */

export function loadHighScores() {
  try {
    const raw = localStorage.getItem(SCORE.highScoreKey);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch (_e) {
    return [];
  }
}

export function qualifiesForHighScore(score) {
  if (score <= 0) return false;
  const hs = loadHighScores();
  if (hs.length < SCORE.highScoreCount) return true;
  return score > hs[hs.length - 1].score;
}

export function addHighScore(initials, score) {
  const hs = loadHighScores();
  hs.push({ initials: (initials || '???').toUpperCase().slice(0, 3), score });
  hs.sort((a, b) => b.score - a.score);
  const top = hs.slice(0, SCORE.highScoreCount);
  try {
    localStorage.setItem(SCORE.highScoreKey, JSON.stringify(top));
  } catch (_e) { /* storage unavailable — table is session-only */ }
  return top;
}
