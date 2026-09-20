'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  bunkerSeats,
  exilesNeeded,
  revealCountForRound,
  tallyVotes,
  passesThreshold,
  resolvePrimaryVote,
  resolveRevote,
  SEATS_MODE,
  EXILE_THRESHOLD,
} = require('../server/game/rules');

test('места в бункере: авто = половина с округлением вниз (официальное правило)', () => {
  const auto = (players) => bunkerSeats({ mode: SEATS_MODE.AUTO, players });
  // Таблица из правил: 4→2, 5→2, 6→3, 7→3, 8→4, 9→4, 10→5, 12→6, 16→8
  assert.equal(auto(4), 2);
  assert.equal(auto(5), 2);
  assert.equal(auto(6), 3);
  assert.equal(auto(7), 3);
  assert.equal(auto(8), 4);
  assert.equal(auto(9), 4);
  assert.equal(auto(10), 5);
  assert.equal(auto(11), 5);
  assert.equal(auto(12), 6);
  assert.equal(auto(13), 6);
  assert.equal(auto(14), 7);
  assert.equal(auto(15), 7);
  assert.equal(auto(16), 8);
});

test('места в бункере: таблица цифровой версии 6-7→3, 8-9→4, 10-11→5, 12-13→6, 14-15→7', () => {
  const auto = (n) => bunkerSeats({ mode: SEATS_MODE.AUTO, players: n });
  const ranges = [[6, 7, 3], [8, 9, 4], [10, 11, 5], [12, 13, 6], [14, 15, 7]];
  for (const [from, to, expected] of ranges) {
    for (let n = from; n <= to; n += 1) assert.equal(auto(n), expected, `игроков ${n}`);
  }
});

test('места в бункере: фиксированный режим уважает число хоста, но оставляет хотя бы одного изгнанного', () => {
  assert.equal(bunkerSeats({ mode: SEATS_MODE.FIXED, fixed: 2, players: 6 }), 2);
  assert.equal(bunkerSeats({ mode: SEATS_MODE.FIXED, fixed: 4, players: 12 }), 4);
  // 2 игрока и просят 5 мест — не выше players - 1
  assert.equal(bunkerSeats({ mode: SEATS_MODE.FIXED, fixed: 5, players: 2 }), 1);
  // мусор на входе не ломает расчёт
  assert.equal(bunkerSeats({ mode: SEATS_MODE.FIXED, fixed: 'abc', players: 8 }), 1);
});

test('число изгнанных = игроки − места', () => {
  assert.equal(exilesNeeded(6, 3), 3);
  assert.equal(exilesNeeded(8, 4), 4);
  assert.equal(exilesNeeded(8, 2), 6);
  assert.equal(exilesNeeded(4, 2), 2);
});

test('таблица раскрытий характеристик по раундам совпадает с правилами', () => {
  // 6 игроков → 3/3/2/—/—
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => revealCountForRound(6, r)), [3, 3, 2, 0, 0]);
  // 7-8 → 3/2/2/по 1
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => revealCountForRound(8, r)), [3, 2, 2, 1, 1]);
  // 9-10 → 3/2/1/по 1
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => revealCountForRound(10, r)), [3, 2, 1, 1, 1]);
  // 11-12 → 2/2/1/по 1
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => revealCountForRound(12, r)), [2, 2, 1, 1, 1]);
  // 13-15 → 2/1/1/по 1
  assert.deepEqual([0, 1, 2, 3, 4].map((r) => revealCountForRound(15, r)), [2, 1, 1, 1, 1]);
});

test('подсчёт голосов: не проголосовавший голосует против себя', () => {
  const tally = tallyVotes({ a: 'b', b: 'c' }, ['a', 'b', 'c']);
  assert.equal(tally.counts.b, 1); // голос a
  assert.equal(tally.counts.c, 2); // голос b + автогол c против себя
  assert.equal(tally.totalVotes, 3);
  assert.deepEqual(tally.top, ['c']);
});

test('подсчёт голосов: воздержание считается отдельно и не идёт в счётчики игроков', () => {
  const tally = tallyVotes({ a: 'skip', b: 'c', c: 'b' }, ['a', 'b', 'c']);
  assert.equal(tally.skipVotes, 1);
  assert.equal(tally.counts.b, 1);
  assert.equal(tally.counts.c, 1);
  assert.equal(tally.totalVotes, 3);
  assert.deepEqual(tally.top.sort(), ['b', 'c']);
});

test('подсчёт голосов: вес голоса учитывается (спец. карта «двойной голос»)', () => {
  const tally = tallyVotes({ a: 'b', b: 'c', c: 'c' }, ['a', 'b', 'c'], { a: 2, b: 1, c: 1 });
  assert.equal(tally.counts.b, 2); // голос a с весом 2
  assert.equal(tally.counts.c, 2); // голоса b и c
  assert.equal(tally.totalVotes, 4);
  assert.deepEqual(tally.top.sort(), ['b', 'c']);
});

test('порог 70% определяет немедленное исключение', () => {
  assert.equal(EXILE_THRESHOLD, 0.7);
  assert.equal(passesThreshold({ max: 7, totalVotes: 10 }), true);
  assert.equal(passesThreshold({ max: 6, totalVotes: 10 }), false);
  assert.equal(passesThreshold({ max: 0, totalVotes: 0 }), false);
});

test('первое голосование: 70%+ → исключение без оправдания', () => {
  const tally = tallyVotes({ a: 'd', b: 'd', c: 'd', d: 'a' }, ['a', 'b', 'c', 'd']);
  const out = resolvePrimaryVote(tally, { roundNumber: 2, activeCount: 4 });
  assert.equal(out.action, 'exile');
  assert.deepEqual(out.targets, ['d']);
});

test('первое голосование: большинство без 70% → оправдательная речь', () => {
  const tally = tallyVotes({ a: 'd', b: 'd', c: 'd', d: 'a', e: 'a' }, ['a', 'b', 'c', 'd', 'e']);
  // d — 3 из 5 = 60% < 70%
  const out = resolvePrimaryVote(tally, { roundNumber: 2, activeCount: 5 });
  assert.equal(out.action, 'defense');
  assert.deepEqual(out.targets, ['d']);
});

test('первое голосование: ничья → оправдываются оба кандидата', () => {
  const tally = tallyVotes({ a: 'c', b: 'c', c: 'a', d: 'a' }, ['a', 'b', 'c', 'd']);
  const out = resolvePrimaryVote(tally, { roundNumber: 2, activeCount: 4 });
  assert.equal(out.action, 'defense');
  assert.deepEqual(out.targets.sort(), ['a', 'c']);
});

test('пропуск голосования возможен только в первом раунде', () => {
  const ballots = { a: 'skip', b: 'skip', c: 'skip' };
  const tally = tallyVotes(ballots, ['a', 'b', 'c']);
  assert.equal(resolvePrimaryVote(tally, { roundNumber: 1, activeCount: 3 }).action, 'skip');
  // во втором раунде большинство «воздержались» не отменяет голосование
  const second = resolvePrimaryVote(tally, { roundNumber: 2, activeCount: 3 });
  assert.notEqual(second.action, 'skip');
});

test('повторное голосование: единоличный лидер исключается без порога', () => {
  const tally = tallyVotes({ a: 'c', b: 'c', c: 'a', d: 'a', e: 'b' }, ['a', 'b', 'c', 'd', 'e']);
  const out = resolveRevote(tally, { roundNumber: 3 });
  assert.equal(out.action, 'exile');
  assert.deepEqual(out.targets.sort(), ['a', 'c']);
});

test('повторное голосование: ничья в первом раунде закрывает раунд без исключения', () => {
  const tally = tallyVotes({ a: 'b', b: 'a', c: 'b', d: 'a' }, ['a', 'b', 'c', 'd']);
  assert.equal(resolveRevote(tally, { roundNumber: 1 }).action, 'no_exile');
});

test('повторное голосование: ничья вне первого раунда исключает обоих', () => {
  const tally = tallyVotes({ a: 'b', b: 'a', c: 'b', d: 'a' }, ['a', 'b', 'c', 'd']);
  const out = resolveRevote(tally, { roundNumber: 4 });
  assert.equal(out.action, 'exile');
  assert.deepEqual(out.targets.sort(), ['a', 'b']);
});

test('повторное голосование: единоличный лидер с наибольшим числом голосов', () => {
  const tally = tallyVotes({ a: 'c', b: 'c', c: 'a', d: 'a', e: 'c' }, ['a', 'b', 'c', 'd', 'e']);
  const out = resolveRevote(tally, { roundNumber: 2 });
  assert.equal(out.action, 'exile');
  assert.deepEqual(out.targets, ['c']);
});
