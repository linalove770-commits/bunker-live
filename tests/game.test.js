'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const { GameState, PHASES, parseDurationMonths } = require('../server/game/GameState');
const { SEATS_MODE } = require('../server/game/rules');
const { CHARACTER_CATEGORIES } = require('../server/game/constants');

function makePlayers(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i + 1}`,
    nickname: `Игрок${i + 1}`,
    isHost: i === 0,
    connected: true,
  }));
}

function newGame(n, settings = {}) {
  const g = new GameState({
    roomCode: 'TEST1',
    seed: 12345,
    players: makePlayers(n),
    settings,
  });
  return g;
}

/** Автоматически проходит фазу раскрытия: каждый игрок открывает положенное. */
function playRevealPhase(g) {
  let guard = 0;
  while (g.phase === PHASES.REVEAL && guard < 200) {
    guard += 1;
    const id = g.currentTurnPlayerId();
    const player = g.getPlayer(id);
    const left = g.revealsLeftFor(player);
    if (left <= 0) {
      g.advance(null);
      continue;
    }
    const hidden = CHARACTER_CATEGORIES.filter(
      (c) => !player.revealed.includes(c)
        && !(g.round === 1 && !player.revealed.includes('profession') && c !== 'profession'),
    );
    g.reveal(id, hidden[0]);
  }
  assert.ok(guard < 200, 'фаза раскрытия не зависла');
}

/**
 * Голосуют все, кто может. Цель тоже голосует — против первого попавшегося
 * соперника: по правилам не проголосовавший получает голос против себя,
 * а мы хотим проверять осознанные голоса, а не таймаут.
 * В повторном голосовании круг целей ограничен кандидатами.
 */
function everyoneVotesAgainst(g, targetId) {
  const voterIds = g.voters().map((p) => p.id);
  for (const voterId of voterIds) {
    if (g.phase !== PHASES.VOTING && g.phase !== PHASES.REVOTE) break;
    const pool = g.phase === PHASES.REVOTE && g.voteCandidates.length ? g.voteCandidates : voterIds;
    const target = voterId === targetId ? pool.find((id) => id !== voterId) : (pool.includes(targetId) ? targetId : null);
    if (!target) continue; // единственный кандидат голосовать не может — решит таймер
    g.castVote(voterId, target);
  }
}

/** Закрывает окно голосования таймером — так же, как это делает сервер. */
function closeVoting(g) {
  if (g.phase === PHASES.VOTING || g.phase === PHASES.REVOTE) g.tick(Date.now() + 120000);
}

test('старт партии: катастрофа, бункер и персонажи выданы', () => {
  const g = newGame(6);
  g.start();
  assert.equal(g.phase, PHASES.INTRO);
  assert.ok(g.catastrophe && g.catastrophe.title);
  assert.ok(g.bunker && g.bunker.cards.length === 5, 'бункер = 3 преимущества + 2 проблемы');
  assert.equal(g.bunker.advantages.length, 3);
  assert.equal(g.bunker.hazards.length, 2);
  assert.equal(g.seatCount, 3, '6 игроков → 3 места');
  for (const p of g.players) {
    assert.equal(Object.keys(p.cards).length, 11, 'у каждого 11 характеристик');
  }
});

test('катастрофа и бункер не повторяются между игроками одной категории', () => {
  const g = newGame(8);
  g.start();
  const professions = g.players.map((p) => p.cards.profession);
  assert.equal(new Set(professions).size, 8, 'профессии не должны дублироваться');
  const ids = g.bunker.cards.map((c) => c.id);
  assert.equal(new Set(ids).size, 5, 'карты бункера уникальны');
});

test('первый раунд начинается с профессии', () => {
  const g = newGame(6);
  g.start();
  g.advance(); // intro -> round 1
  assert.equal(g.phase, PHASES.REVEAL);
  const id = g.currentTurnPlayerId();
  assert.throws(() => g.reveal(id, 'hobby'), /профессия/i);
  g.reveal(id, 'profession');
  assert.ok(g.getPlayer(id).revealed.includes('profession'));
});

test('нельзя раскрывать карты вне своего хода', () => {
  const g = newGame(6);
  g.start();
  g.advance();
  const notCurrent = g.players.find((p) => p.id !== g.currentTurnPlayerId());
  assert.throws(() => g.reveal(notCurrent.id, 'profession'), /не ваш ход/i);
});

test('нельзя раскрыть одну характеристику дважды', () => {
  const g = newGame(6);
  g.start();
  g.advance();
  const id = g.currentTurnPlayerId();
  g.reveal(id, 'profession');
  assert.throws(() => g.reveal(id, 'profession'), /уже раскрыта/i);
});

test('за раунд игрок раскрывает не больше положенного и ход переходит дальше', () => {
  const g = newGame(6);
  g.start();
  g.advance();
  const first = g.currentTurnPlayerId();
  // 6 игроков → в первом раунде 3 карты
  g.reveal(first, 'profession');
  const p = g.getPlayer(first);
  const second = CHARACTER_CATEGORIES.find((c) => !p.revealed.includes(c));
  g.reveal(first, second);
  const third = CHARACTER_CATEGORIES.find((c) => !p.revealed.includes(c));
  g.reveal(first, third);
  assert.equal(p.revealed.length, 3);
  assert.notEqual(g.currentTurnPlayerId(), first, 'после нормы ход переходит следующему');
});

test('полный раунд: раскрытие → обсуждение → обвинения → голосование → изгнание', () => {
  const g = newGame(6);
  g.start();
  g.advance(); // раунд 1
  playRevealPhase(g);
  assert.equal(g.phase, PHASES.DISCUSSION);
  g.advance();
  assert.equal(g.phase, PHASES.ACCUSATION);
  // обвинения по всем игрокам
  for (let i = 0; i < 6; i += 1) g.advance();
  assert.equal(g.phase, PHASES.VOTING);

  const victim = g.players[5].id;
  everyoneVotesAgainst(g, victim);
  closeVoting(g);
  // 5 из 6 голосов = 83% ≥ 70% → исключение без оправдания
  assert.equal(g.phase, PHASES.FAREWELL);
  assert.deepEqual(g.pendingExile, [victim]);
  g.advance(); // прощание → изгнание
  assert.equal(g.getPlayer(victim).exiled, true);
  assert.equal(g.phase, PHASES.SUMMARY);
  assert.equal(g.activePlayers().length, 5);
});

test('голосование 60% уводит кандидата на оправдательную речь и повторное голосование', () => {
  const g = newGame(6);
  g.start();
  g.advance();
  playRevealPhase(g);
  g.advance(); // обсуждение
  for (let i = 0; i < 6; i += 1) g.advance(); // обвинения
  assert.equal(g.phase, PHASES.VOTING);

  const victim = g.players[5].id;
  // 3 из 6 = 50% < 70%
  g.castVote(g.players[0].id, victim);
  g.castVote(g.players[1].id, victim);
  g.castVote(g.players[2].id, victim);
  g.castVote(g.players[3].id, g.players[0].id);
  g.castVote(g.players[4].id, g.players[1].id);
  // шестой игрок = сам victim, он тоже голосует против другого
  g.castVote(victim, g.players[0].id);

  assert.equal(g.phase, PHASES.DEFENSE, 'должна начаться оправдательная речь');
  assert.deepEqual(g.voteCandidates, [victim]);
  g.advance(); // оправдание завершено
  assert.equal(g.phase, PHASES.REVOTE);
  assert.deepEqual(g.voteCandidates, [victim], 'в повторном голосовании только кандидат');

  // в повторном голосовании нельзя голосовать против не-кандидата
  assert.throws(() => g.castVote(g.players[0].id, g.players[1].id), /только кандидаты/i);
});

test('нельзя голосовать против себя', () => {
  const g = newGame(6);
  g.start();
  g.advance();
  playRevealPhase(g);
  g.advance();
  for (let i = 0; i < 6; i += 1) g.advance();
  assert.equal(g.phase, PHASES.VOTING);
  const id = g.players[0].id;
  assert.throws(() => g.castVote(id, id), /против себя/i);
});

test('пропуск голосования в первом раунде не исключает никого', () => {
  const g = newGame(6);
  g.start();
  g.advance();
  playRevealPhase(g);
  g.advance();
  for (let i = 0; i < 6; i += 1) g.advance();
  assert.equal(g.phase, PHASES.VOTING);
  for (const v of g.voters()) g.castVote(v.id, 'skip');
  assert.equal(g.phase, PHASES.SUMMARY);
  assert.equal(g.activePlayers().length, 6, 'все остались в лагере');
  assert.equal(g.lastOutcome.action, 'skip');
});

test('партия доигрывается до финала и заполняет все места', () => {
  const g = newGame(6);
  g.start();
  let guard = 0;
  while (g.phase !== PHASES.FINALE && g.phase !== PHASES.ENDED && guard < 2000) {
    guard += 1;
    if (g.phase === PHASES.REVEAL) {
      playRevealPhase(g);
      continue;
    }
    if (g.phase === PHASES.VOTING || g.phase === PHASES.REVOTE) {
      const others = g.activePlayers().filter((p) => p.id !== g.voters()[0].id);
      const victim = (others[others.length - 1] || g.activePlayers()[0]).id;
      everyoneVotesAgainst(g, victim);
      closeVoting(g);
      continue;
    }
    g.advance();
  }
  assert.ok(guard < 2000, 'партия не зависла');
  assert.equal(g.phase, PHASES.FINALE);
  assert.equal(g.activePlayers().length, g.seatCount, 'в бункере ровно столько людей, сколько мест');
  assert.ok(g.finaleReport);
  assert.ok(g.finaleReport.verdict && g.finaleReport.verdict.title);
  assert.equal(g.finaleReport.survivors.length, g.seatCount);
});

test('фиксированные 2 места: в бункер попадают ровно двое', () => {
  const g = newGame(6, { seatsMode: SEATS_MODE.FIXED, seatsFixed: 2 });
  g.start();
  assert.equal(g.seatCount, 2);
  let guard = 0;
  while (g.phase !== PHASES.FINALE && guard < 2000) {
    guard += 1;
    if (g.phase === PHASES.REVEAL) { playRevealPhase(g); continue; }
    if (g.phase === PHASES.VOTING || g.phase === PHASES.REVOTE) {
      const victim = g.activePlayers()[0].id;
      everyoneVotesAgainst(g, victim);
      closeVoting(g);
      continue;
    }
    g.advance();
  }
  assert.equal(g.phase, PHASES.FINALE);
  assert.equal(g.activePlayers().length, 2);
});

test('персональный снапшот не выдаёт чужие закрытые карты', () => {
  const g = newGame(6);
  g.start();
  g.advance();
  const me = g.players[0].id;
  const other = g.players[1].id;
  const snap = g.snapshotFor(me);

  // свои карты видны целиком, включая закрытые
  assert.equal(snap.me.cards.length, 11);
  assert.ok(snap.me.cards.some((c) => c.title && c.revealed === false));

  // у чужого игрока — только раскрытые карты, никаких ссылок на скрытые
  const otherPublic = snap.players.find((p) => p.id === other);
  assert.deepEqual(otherPublic.revealedCards, []);
  assert.equal(otherPublic.cards, undefined, 'закрытые карты другого игрока не отправляются');
  const serialized = JSON.stringify(snap);
  const hiddenTitle = require('../server/game/decks').findCardById(g.getPlayer(other).cards.hobby).title;
  assert.equal(serialized.includes(hiddenTitle), false, 'название скрытой карты не должно попасть в снапшот');
});

test('раскрытые карты видны всем игрокам', () => {
  const g = newGame(6);
  g.start();
  g.advance();
  const speaker = g.currentTurnPlayerId();
  g.reveal(speaker, 'profession');
  const snap = g.snapshotFor(g.players.find((p) => p.id !== speaker).id);
  const publicSpeaker = snap.players.find((p) => p.id === speaker);
  assert.equal(publicSpeaker.revealedCards.length, 1);
  assert.equal(publicSpeaker.revealedCards[0].category, 'profession');
});

test('спец. возможность «иммунитет» снимает голоса против игрока', () => {
  const g = newGame(6);
  g.start();
  g.advance();
  const player = g.players[0];
  // принудительно открываем спец. карту и подменяем её на immune_vote
  const decks = require('../server/game/decks');
  player.revealed.push('special');
  const immuneCard = decks.loadDeck('specials').cards.find((c) => c.effect === 'immune_vote');
  player.cards.special = immuneCard.id;
  g.useSpecial(player.id, null);
  assert.equal(player.immune, true);

  playRevealPhase(g);
  g.advance();
  for (let i = 0; i < 6; i += 1) g.advance();
  assert.equal(g.phase, PHASES.VOTING);
  everyoneVotesAgainst(g, player.id);
  assert.equal(player.exiled, false, 'иммунитет должен защитить от изгнания');
});

test('спец. возможность «двойной голос» усиливает голос', () => {
  const g = newGame(6);
  g.start();
  g.advance();
  const player = g.players[0];
  const decks = require('../server/game/decks');
  const card = decks.loadDeck('specials').cards.find((c) => c.effect === 'double_vote');
  player.revealed.push('special');
  player.cards.special = card.id;
  g.useSpecial(player.id, null);
  assert.equal(player.voteWeight, 2);
});

test('изгнанный игрок не может раскрывать карты и использовать возможности', () => {
  const g = newGame(6);
  g.start();
  g.advance();
  const p = g.players[5];
  p.exiled = true;
  assert.throws(() => g.useSpecial(p.id, null), /изгнанный/i);
  assert.throws(() => g.reveal(p.id, 'profession'), /не ваш ход|изгнанный/i);
});

test('разбор длительности катастрофы', () => {
  assert.equal(parseDurationMonths('5 лет'), 60);
  assert.equal(parseDurationMonths('18 месяцев'), 18);
  assert.equal(parseDurationMonths('3 года'), 36);
  assert.equal(parseDurationMonths('2 недели'), 1);
  assert.equal(parseDurationMonths(''), 12);
});

test('автотаймер переводит партию из фазы в фазу', () => {
  const g = newGame(6, { timers: { speak: 5, discussion: 5, accusation: 5, voting: 5, defense: 5, farewell: 5 } });
  g.start();
  g.advance();
  assert.equal(g.phase, PHASES.REVEAL);
  const before = g.currentTurnPlayerId();
  const changed = g.tick(Date.now() + 6000);
  assert.equal(changed, true);
  assert.notEqual(g.currentTurnPlayerId(), before, 'после таймера ход переходит дальше');
});
