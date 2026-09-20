'use strict';

/**
 * Инварианты партии: как бы игроки ни голосовали, бункер всегда заполняется
 * ровно на число мест и никогда не остаётся пустым.
 *
 * Эти тесты ловят класс ошибок, который не виден в одиночном прогоне:
 * ничья в повторном голосовании могла изгнать сразу двоих и оставить
 * бункер пустым, а вердикт при этом объявлял победу.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { GameState, PHASES } = require('../server/game/GameState');
const { SEATS_MODE } = require('../server/game/rules');
const { CHARACTER_CATEGORIES } = require('../server/game/constants');
const { createRng } = require('../server/game/rng');

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    nickname: `Игрок${i + 1}`,
    isHost: i === 0,
    connected: true,
  }));
}

function playReveal(g) {
  let guard = 0;
  while (g.phase === PHASES.REVEAL && guard < 300) {
    guard += 1;
    const player = g.getPlayer(g.currentTurnPlayerId());
    if (!player) break;
    if (g.revealsLeftFor(player) <= 0) { g.advance(null); continue; }
    const hidden = CHARACTER_CATEGORIES.filter(
      (c) => !player.revealed.includes(c)
        && !(g.round === 1 && !player.revealed.includes('profession') && c !== 'profession'),
    );
    if (!hidden.length) { g.advance(null); continue; }
    g.reveal(player.id, hidden[0]);
  }
  assert.ok(guard < 300, 'фаза раскрытия зависла');
}

/**
 * Доигрывает партию до финала. Голоса раздаёт seed, поэтому сценарии
 * воспроизводимы и включают ничьи.
 */
function playToFinale(g, seed) {
  const rng = createRng(seed);
  let guard = 0;
  while (g.phase !== PHASES.FINALE && g.phase !== PHASES.ENDED && guard < 5000) {
    guard += 1;
    switch (g.phase) {
      case PHASES.REVEAL:
        playReveal(g);
        break;
      case PHASES.VOTING:
      case PHASES.REVOTE: {
        const voters = g.voters();
        const alive = g.activePlayers();
        const pool = g.phase === PHASES.REVOTE && g.voteCandidates.length
          ? alive.filter((p) => g.voteCandidates.includes(p.id))
          : alive;
        for (const v of voters) {
          if (g.phase !== PHASES.VOTING && g.phase !== PHASES.REVOTE) break;
          // Иногда воздерживаемся — это тоже часть правил.
          if (rng.chance(0.12)) { g.castVote(v.id, 'skip'); continue; }
          const choices = pool.filter((p) => p.id !== v.id);
          if (!choices.length) continue;
          g.castVote(v.id, rng.pick(choices).id);
        }
        // Если кто-то не голосовал — закрываем окно таймером.
        if (g.phase === PHASES.VOTING || g.phase === PHASES.REVOTE) g.tick(Date.now() + 120000);
        break;
      }
      default:
        g.advance(null);
        break;
    }
  }
  assert.ok(guard < 5000, 'партия зависла');
  assert.equal(g.phase, PHASES.FINALE, `партия закончилась в фазе ${g.phase}`);
  return g;
}

test('инвариант: в бункере всегда ровно столько людей, сколько мест', () => {
  const counts = [2, 3, 4, 5, 6, 7, 8, 10, 12, 15];
  for (const n of counts) {
    for (let seed = 1; seed <= 4; seed += 1) {
      const g = new GameState({ roomCode: 'INV', seed: 1000 + seed, players: makePlayers(n) });
      g.start();
      playToFinale(g, seed * 7919);
      assert.equal(
        g.activePlayers().length,
        g.seatCount,
        `${n} игроков, seed ${seed}: выживших ${g.activePlayers().length}, мест ${g.seatCount}`,
      );
      assert.ok(g.activePlayers().length >= 1, `${n} игроков: бункер не должен оставаться пустым`);
      assert.equal(g.players.filter((p) => p.exiled).length, n - g.seatCount,
        `${n} игроков: изгнанных должно быть ${n - g.seatCount}`);
      assert.equal(g.finaleReport.survivors.length, g.seatCount);
      assert.ok(g.finaleReport.perPlayer.length >= 1, 'в финале должны быть персонажи выживших');
      assert.ok(g.finaleReport.verdict.title, 'у финала должен быть вердикт');
    }
  }
});

test('ничья не может опустошить бункер (2 игрока, 1 место)', () => {
  // Ровно тот случай, который ломал игру: оба голосуют друг против друга.
  for (let seed = 1; seed <= 20; seed += 1) {
    const g = new GameState({ roomCode: 'TIE', seed, players: makePlayers(2) });
    g.start();
    assert.equal(g.seatCount, 1);
    let guard = 0;
    while (g.phase !== PHASES.FINALE && guard < 3000) {
      guard += 1;
      if (g.phase === PHASES.REVEAL) { playReveal(g); continue; }
      if (g.phase === PHASES.VOTING || g.phase === PHASES.REVOTE) {
        // Каждый голосует против другого → гарантированная ничья.
        for (const v of g.voters()) {
          const other = g.players.find((p) => p.id !== v.id && !p.exiled);
          if (!other) continue;
          const pool = g.phase === PHASES.REVOTE && g.voteCandidates.length
            ? g.voteCandidates
            : g.activePlayers().map((p) => p.id);
          if (!pool.includes(other.id)) continue;
          g.castVote(v.id, other.id);
        }
        if (g.phase === PHASES.VOTING || g.phase === PHASES.REVOTE) g.tick(Date.now() + 120000);
        continue;
      }
      g.advance(null);
    }
    assert.equal(g.phase, PHASES.FINALE, `seed ${seed}: партия не дошла до финала`);
    assert.equal(g.activePlayers().length, 1, `seed ${seed}: в бункере должен остаться ровно один`);
    assert.equal(g.finaleReport.survivors.length, 1, `seed ${seed}: финал без выживших`);
    assert.notEqual(g.finaleReport.verdict.key, undefined);
  }
});

test('фиксированные 2 места при 6 игроках дают ровно 2 выживших', () => {
  for (let seed = 1; seed <= 3; seed += 1) {
    const g = new GameState({
      roomCode: 'FIX',
      seed,
      players: makePlayers(6),
      settings: { seatsMode: SEATS_MODE.FIXED, seatsFixed: 2 },
    });
    g.start();
    assert.equal(g.seatCount, 2);
    playToFinale(g, seed * 104729);
    assert.equal(g.activePlayers().length, 2);
  }
});

test('лимит раундов исчерпывается — партия всё равно доходит до нужного состава', () => {
  // Жёсткий лимит в 1 раунд при 8 игроках и 4 местах: должно сработать
  // добивание по жребию, а не бесконечный цикл.
  const g = new GameState({
    roomCode: 'CAP',
    seed: 5,
    players: makePlayers(8),
    settings: { maxRounds: 1 },
  });
  g.start();
  playToFinale(g, 999);
  assert.equal(g.activePlayers().length, 4, 'после лимита раундов должно остаться ровно 4 игрока');
  assert.equal(g.finaleReport.survivors.length, 4);
});

test('расклад финальных вердиктов не вырождается в один исход', () => {
  // Калибровка оценки: если все партии заканчиваются одинаково, финал
  // перестаёт быть интересным. Проверяем, что встречаются разные исходы.
  const seen = new Set();
  for (let seed = 1; seed <= 24; seed += 1) {
    const n = [6, 8, 10, 12][seed % 4];
    const g = new GameState({ roomCode: 'VERD', seed: seed * 7717, players: makePlayers(n) });
    g.start();
    playToFinale(g, seed * 6151);
    const score = g.finaleReport.score;
    assert.ok(score >= 0 && score <= 100, `оценка вне диапазона: ${score}`);
    assert.ok(g.finaleReport.food.have >= 0, 'запас еды не может быть отрицательным');
    assert.ok(g.finaleReport.food.need > 0, 'срок в бункере должен быть положительным');
    seen.add(g.finaleReport.verdict.key);
  }
  assert.ok(seen.size >= 2, `встретился только один исход партии: ${[...seen].join(', ')}`);
});

test('воздержание всех в первом раунде не ломает партию', () => {
  const g = new GameState({ roomCode: 'SKIP', seed: 11, players: makePlayers(6) });
  g.start();
  let guard = 0;
  let firstVoteHandled = false;
  while (g.phase !== PHASES.FINALE && guard < 4000) {
    guard += 1;
    if (g.phase === PHASES.REVEAL) { playReveal(g); continue; }
    if (g.phase === PHASES.VOTING && !firstVoteHandled && g.round === 1) {
      for (const v of g.voters()) g.castVote(v.id, 'skip');
      firstVoteHandled = true;
      assert.equal(g.phase, PHASES.SUMMARY, 'воздержание в первом раунде должно закрыть раунд');
      continue;
    }
    if (g.phase === PHASES.VOTING || g.phase === PHASES.REVOTE) {
      const victim = g.activePlayers()[0];
      for (const v of g.voters()) {
        if (g.phase !== PHASES.VOTING && g.phase !== PHASES.REVOTE) break;
        const pool = g.phase === PHASES.REVOTE && g.voteCandidates.length ? g.voteCandidates : null;
        const target = v.id === victim.id
          ? g.activePlayers().find((p) => p.id !== v.id)
          : (pool && !pool.includes(victim.id) ? null : victim);
        if (target) g.castVote(v.id, target.id);
      }
      if (g.phase === PHASES.VOTING || g.phase === PHASES.REVOTE) g.tick(Date.now() + 120000);
      continue;
    }
    g.advance(null);
  }
  assert.equal(g.phase, PHASES.FINALE);
  assert.equal(g.activePlayers().length, g.seatCount);
});
