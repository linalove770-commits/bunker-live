'use strict';

/**
 * Правила игры «Бункер».
 *
 * Источники, по которым выверены константы этого файла:
 *  - издатель «Экономикус» (economicusgame.com): «попасть в бункер смогут не все –
 *    а лишь половина из вас!»;
 *  - цифровая версия bunker-online.com: места = половина выживших с округлением
 *    вниз, таблица 6-7 → 3, 8-9 → 4, 10-11 → 5, 12-13 → 6, 14-15 → 7;
 *  - таблица открытий характеристик по раундам: 6 → 3/3/2/—, 7-8 → 3/2/2/по 1,
 *    9-10 → 3/2/1/по 1, 11-12 → 2/2/1/по 1, 13-15 → 2/1/1/по 1.
 */

const { CATEGORY_TOTAL } = require('./constants');

/** Режим расчёта мест в бункере. */
const SEATS_MODE = {
  AUTO: 'auto', // половина игроков с округлением вниз — официальное правило
  FIXED: 'fixed', // фиксированное число, заданное хостом
};

/** Порог голосов для немедленного исключения без оправдания. */
const EXILE_THRESHOLD = 0.7;

/** Сколько характеристик открывается в раунде (roundIndex с нуля). */
function revealCountForRound(playerCount, roundIndex) {
  if (roundIndex < 0) return 0;
  if (playerCount <= 6) {
    // 6 игроков → 3/3/2, дальше в таблице стоит «—»
    const plan = [3, 3, 2];
    return roundIndex < plan.length ? plan[roundIndex] : 0;
  }
  if (playerCount <= 8) return [3, 2, 2][roundIndex] ?? 1; // 7-8 → 3/2/2/по 1
  if (playerCount <= 10) return [3, 2, 1][roundIndex] ?? 1; // 9-10 → 3/2/1/по 1
  if (playerCount <= 12) return [2, 2, 1][roundIndex] ?? 1; // 11-12 → 2/2/1/по 1
  return [2, 1, 1][roundIndex] ?? 1; // 13-15 → 2/1/1/по 1
}

/**
 * Число мест в бункере.
 * auto  → floor(players / 2), но не меньше 1 и не больше players - 1;
 * fixed → заданное число, зажатое в те же границы.
 */
function bunkerSeats({ mode = SEATS_MODE.AUTO, fixed = null, players }) {
  const n = Math.max(2, Math.floor(Number(players) || 0));
  const upper = Math.max(1, n - 1);
  let seats;
  if (mode === SEATS_MODE.FIXED) {
    seats = Math.floor(Number(fixed) || 0);
  } else {
    seats = Math.floor(n / 2);
  }
  return Math.min(upper, Math.max(1, seats));
}

/** Сколько игроков должно быть изгнано, чтобы партия дошла до конца. */
function exilesNeeded(players, seats) {
  return Math.max(0, players - seats);
}

/** Человекочитаемая подпись режима мест. */
function seatsLabel({ mode, fixed, players }) {
  const seats = bunkerSeats({ mode, fixed, players });
  const hint =
    mode === SEATS_MODE.FIXED
      ? 'задано хостом'
      : `половина от ${players} с округлением вниз`;
  return { seats, hint };
}

/**
 * Подсчёт голосов.
 *
 * @param ballots  { [voterId]: targetId | 'skip' }
 * @param activeIds массив id игроков, имеющих право голоса
 * @param weights  необязательно: { [voterId]: number } — вес голоса (спец. карты)
 * @returns { counts, totalVotes, skipVotes, max, top }
 * Не проголосовавший игрок автоматически голосует против себя —
 * так требует правило «если игрок не участвует в голосовании, его голос
 * автоматически идёт против него самого».
 */
function tallyVotes(ballots, activeIds, weights = null) {
  const counts = {};
  let skipVotes = 0;
  let totalVotes = 0;

  for (const voterId of activeIds) {
    const weight = Math.max(1, Math.floor(Number(weights && weights[voterId]) || 1));
    const raw = ballots[voterId];
    if (raw === 'skip') {
      skipVotes += weight;
      totalVotes += weight;
      continue;
    }
    const target = raw && activeIds.includes(raw) ? raw : voterId;
    counts[target] = (counts[target] || 0) + weight;
    totalVotes += weight;
  }

  let max = 0;
  for (const id of Object.keys(counts)) max = Math.max(max, counts[id]);
  const top = Object.keys(counts).filter((id) => counts[id] === max && max > 0);

  return { counts, totalVotes, skipVotes, max, top };
}

/** Прошли ли выборы по большинству голосов. */
function passesThreshold(tally) {
  if (!tally.totalVotes) return false;
  return tally.max / tally.totalVotes >= EXILE_THRESHOLD;
}

/**
 * Итог первого голосования раунда.
 * @returns { action: 'skip'|'exile'|'defense', targets: string[] }
 */
function resolvePrimaryVote(tally, { roundNumber, activeCount }) {
  const majoritySkip = tally.skipVotes * 2 > activeCount;
  // Пропускать голосование можно только в первом раунде.
  if (majoritySkip && roundNumber === 1) {
    return { action: 'skip', targets: [] };
  }
  if (tally.top.length === 1 && passesThreshold(tally)) {
    return { action: 'exile', targets: tally.top };
  }
  return { action: 'defense', targets: tally.top };
}

/**
 * Итог повторного голосования (после оправдательных речей).
 * - единоличный лидер — исключается (даже без 70%);
 * - ничья — в первом раунде раунд закрывается без исключения,
 *   в остальных исключаются все, кто делит первое место.
 * @returns { action: 'exile'|'no_exile', targets: string[] }
 */
function resolveRevote(tally, { roundNumber }) {
  if (tally.top.length === 0) return { action: 'no_exile', targets: [] };
  if (tally.top.length === 1) return { action: 'exile', targets: tally.top };
  if (roundNumber === 1) return { action: 'no_exile', targets: [] };
  return { action: 'exile', targets: tally.top };
}

/** Длительности фаз по умолчанию (секунды). */
const DEFAULT_TIMERS = {
  speak: 60, // представление персонажа
  discussion: 60, // коллективное обсуждение
  accusation: 30, // обвинение/оправдание перед голосованием
  voting: 15, // окно голосования
  defense: 30, // оправдательная речь после голосования
  farewell: 15, // прощальная речь изгнанного
};

/** Настройки комнаты по умолчанию. */
function defaultSettings() {
  return {
    seatsMode: SEATS_MODE.AUTO,
    seatsFixed: 3,
    maxRounds: 7,
    timers: { ...DEFAULT_TIMERS },
    autoAdvance: true, // автоматически переходить по таймеру
    exilesKeepVoting: false, // изгнанные сохраняют право голоса
    enableSpecials: true,
  };
}

/** Зажимает число в границы, переживая мусор на входе. */
function clampInt(value, min, max, fallback) {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

/**
 * Приводит патч настроек к допустимым значениям.
 * Общий для сервера и локального режима в браузере — правила одни и те же.
 */
function applySettingsPatch(settings, patch, { maxPlayers = 16 } = {}) {
  const s = settings;
  if (patch.seatsMode && Object.values(SEATS_MODE).includes(patch.seatsMode)) s.seatsMode = patch.seatsMode;
  if (patch.seatsFixed != null) s.seatsFixed = clampInt(patch.seatsFixed, 1, maxPlayers - 1, s.seatsFixed);
  if (patch.maxRounds != null) s.maxRounds = clampInt(patch.maxRounds, 1, 12, s.maxRounds);
  if (patch.autoAdvance != null) s.autoAdvance = !!patch.autoAdvance;
  if (patch.exilesKeepVoting != null) s.exilesKeepVoting = !!patch.exilesKeepVoting;
  if (patch.enableSpecials != null) s.enableSpecials = !!patch.enableSpecials;
  if (patch.timers && typeof patch.timers === 'object') {
    for (const key of Object.keys(s.timers)) {
      const v = Number(patch.timers[key]);
      if (Number.isFinite(v)) s.timers[key] = clampInt(v, 5, 300, s.timers[key]);
    }
  }
  return s;
}

module.exports = {
  CATEGORY_TOTAL,
  SEATS_MODE,
  EXILE_THRESHOLD,
  DEFAULT_TIMERS,
  revealCountForRound,
  bunkerSeats,
  exilesNeeded,
  seatsLabel,
  tallyVotes,
  passesThreshold,
  resolvePrimaryVote,
  resolveRevote,
  defaultSettings,
  applySettingsPatch,
  clampInt,
};
