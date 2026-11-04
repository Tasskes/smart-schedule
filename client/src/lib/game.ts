import type { Kind, LedgerRec } from '../types';
import { addDays, todayStr, toDateStr } from './dates';

/** Награда по умолчанию, если ИИ не назначил: примерно 1 монета за 5 минут сосредоточенной работы */
export function defaultReward(kind: Kind, minutes: number) {
  const m = Math.max(0, minutes);
  switch (kind) {
    case 'class':
      return 5;
    case 'tutor':
      return 8;
    case 'study':
    case 'task':
    case 'work':
      return clampReward(Math.round(m / 5));
    case 'sport':
      return clampReward(Math.round(m / 4));
    case 'meal':
    case 'commute':
      return 1;
    case 'routine':
    case 'sleep':
      return 2;
    default:
      return clampReward(Math.round(m / 10));
  }
}

export function clampReward(n: number) {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(150, Math.round(n)));
}

export function balance(ledger: LedgerRec[]) {
  return ledger.reduce((s, l) => s + (Number(l.amount) || 0), 0);
}

export function earnedTotal(ledger: LedgerRec[]) {
  return ledger.filter((l) => l.kind === 'earn' || l.kind === 'bonus').reduce((s, l) => s + Math.max(0, l.amount), 0);
}

/** Уровни: 1 → 0, 2 → 50, 3 → 150, 4 → 300 монет заработано… */
export function levelInfo(earned: number) {
  const level = Math.floor((Math.sqrt(1 + (8 * earned) / 50) - 1) / 2) + 1;
  const need = (n: number) => (50 * (n - 1) * n) / 2;
  const cur = need(level);
  const next = need(level + 1);
  return { level, progress: (earned - cur) / (next - cur), toNext: Math.ceil(next - earned) };
}

/**
 * Серия: дни подряд, когда было заработано хоть что-то.
 * Мягкий режим: один пропущенный день в неделю серию не обрывает.
 */
export function streak(ledger: LedgerRec[], today = todayStr()) {
  const days = new Set(ledger.filter((l) => l.kind === 'earn' && l.amount > 0).map((l) => toDateStr(new Date(l.ts))));
  let count = 0;
  let freezesLeft = 1;
  let gapStreak = 0;
  let d = days.has(today) ? today : addDays(today, -1);
  for (let i = 0; i < 400; i += 1) {
    if (days.has(d)) {
      count += 1;
      gapStreak = 0;
      if (count % 7 === 0) freezesLeft = Math.min(2, freezesLeft + 1);
    } else if (freezesLeft > 0 && gapStreak === 0 && count > 0) {
      freezesLeft -= 1;
      gapStreak = 1;
    } else break;
    d = addDays(d, -1);
  }
  return count;
}

/** Бонус за серию: +3% за каждый день, максимум +30% */
export function streakMultiplier(s: number) {
  return 1 + Math.min(s, 10) * 0.03;
}
