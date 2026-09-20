'use strict';

/**
 * Соло-режим: один живой игрок плюс боты.
 * Партия должна доигрываться до финала, даже если человек только жмёт
 * свои ходы — боты раскрывают карты, голосуют и оправдываются сами.
 */

const test = require('node:test');
const assert = require('node:assert/strict');

const { GameState, PHASES } = require('../server/game/GameState');
const { RoomManager, RoomError } = require('../server/game/RoomManager');
const { CHARACTER_CATEGORIES } = require('../server/game/constants');

/** Один живой игрок и N ботов. */
function soloGame(bots = 5, settings = {}) {
  const players = [{ id: 'human', nickname: 'Натали', isHost: true, connected: true }];
  for (let i = 1; i <= bots; i += 1) {
    players.push({ id: `bot${i}`, nickname: `Бот-${i}`, isHost: false, connected: true, isBot: true });
  }
  return new GameState({ roomCode: 'SOLO', seed: 4242, players, settings });
}

/**
 * Крутит серверный цикл: каждую секунду дёргает tick и подсказывает
 * «человеку» его ход. Ровно то, что делает setInterval в socket.js.
 */
function runSolo(game, { maxSeconds = 400 } = {}) {
  let now = Date.now();
  for (let i = 0; i < maxSeconds; i += 1) {
    now += 1000;
    // Ходы человека.
    if (game.phase === PHASES.REVEAL && game.currentTurnPlayerId() === 'human') {
      const me = game.getPlayer('human');
      while (game.revealsLeftFor(me) > 0 && game.currentTurnPlayerId() === 'human') {
        const mustProfession = game.round === 1 && !me.revealed.includes('profession');
        const pool = CHARACTER_CATEGORIES.filter(
          (c) => !me.revealed.includes(c) && (!mustProfession || c === 'profession'),
        );
        if (!pool.length) break;
        game.reveal('human', pool[0]);
      }
      if (game.phase === PHASES.REVEAL && game.currentTurnPlayerId() === 'human') game.advance(null);
    }
    if ((game.phase === PHASES.VOTING || game.phase === PHASES.REVOTE) && game.getPlayer('human').canVote !== false) {
      const me = game.getPlayer('human');
      if (!me.hasVoted && game.voters().some((p) => p.id === 'human')) {
        const pool = game.phase === PHASES.REVOTE && game.voteCandidates.length
          ? game.voteCandidates
          : game.activePlayers().map((p) => p.id);
        const target = pool.find((id) => id !== 'human');
        if (target) game.castVote('human', target);
      }
    }
    // Ходы ведущего на фазах без ботов.
    if (['intro', 'discussion', 'summary'].includes(game.phase)) {
      const speakerIsBot = game.phase === PHASES.DISCUSSION
        || (game.phase === PHASES.SUMMARY);
      if (speakerIsBot) game.advance('human');
    }
    game.tick(now);
    if (game.phase === PHASES.FINALE || game.phase === PHASES.ENDED) return game;
  }
  return game;
}

test('соло-партия с ботами доходит до финала', () => {
  const game = soloGame(5);
  game.start();
  game.advance('human'); // закрываем вводную
  runSolo(game);

  assert.equal(game.phase, PHASES.FINALE, `партия застряла в фазе ${game.phase}, раунд ${game.round}`);
  assert.equal(game.activePlayers().length, game.seatCount, 'мест должно хватить ровно выжившим');
  assert.ok(game.finaleReport.perPlayer.length >= 1, 'в финале должны быть персонажи');
});

test('боты сами раскрывают карты и голосуют', () => {
  const game = soloGame(5);
  game.start();
  game.advance('human');
  runSolo(game);

  const bots = game.players.filter((p) => p.isBot);
  assert.ok(bots.every((b) => b.revealed.length > 0), 'боты должны раскрывать характеристики');
  // Хотя бы часть ботов должна была проголосовать в первом раунде.
  assert.ok(
    game.log.some((l) => l.text.includes('Голоса:')),
    'в хронике должны быть подсчёты голосов',
  );
});

test('боты не становятся ведущими', () => {
  const rm = new RoomManager();
  const { room, player } = rm.createRoom({ nickname: 'Натали' });
  rm.addBot(room, player.id);
  rm.addBot(room, player.id);
  assert.equal(room.members.filter((m) => m.isBot).length, 2);

  // Ведущий уходит — роль не должна уехать боту.
  rm.removePlayer(room, player.id);
  const host = room.members.find((m) => m.isHost);
  assert.equal(host, undefined, 'боты не могут быть ведущими');
});

test('боты добавляются только ведущим и только до старта партии', () => {
  const rm = new RoomManager();
  const { room, player } = rm.createRoom({ nickname: 'Натали' });
  const guest = rm.joinRoom({ code: room.code, nickname: 'Артём', token: '' }).player;

  assert.throws(() => rm.addBot(room, guest.id), RoomError, 'гость не должен добавлять ботов');

  rm.addBot(room, player.id);
  assert.throws(() => rm.removeBot(room, player.id, 'нет-такого'), /нет в комнате/i);
  rm.startGame(room, player.id);
  assert.throws(() => rm.addBot(room, player.id), /началась/i, 'после старта ботов не добавляют');
});

test('одному человеку без ботов партию не начать', () => {
  const rm = new RoomManager();
  const { room, player } = rm.createRoom({ nickname: 'Натали' });
  assert.equal(room.members.length, 1);
  assert.throws(() => rm.startGame(room, player.id), /минимум 2 игрока/i);
});

test('один человек с ботами может начать партию', () => {
  const rm = new RoomManager();
  const { room, player } = rm.createRoom({ nickname: 'Натали' });
  rm.addBot(room, player.id);
  rm.addBot(room, player.id);
  const game = rm.startGame(room, player.id);
  assert.equal(game.players.length, 3);
  assert.equal(game.players.filter((p) => p.isBot).length, 2);
  assert.equal(game.getPlayer(player.id).isHost, true);
});

test('имена ботов не повторяются', () => {
  const rm = new RoomManager();
  const { room, player } = rm.createRoom({ nickname: 'Натали' });
  const names = new Set();
  for (let i = 0; i < 6; i += 1) names.add(rm.addBot(room, player.id).nickname);
  assert.equal(names.size, 6, `имена ботов: ${[...names].join(', ')}`);
});

test('бота можно убрать из лобби', () => {
  const rm = new RoomManager();
  const { room, player } = rm.createRoom({ nickname: 'Натали' });
  const bot = rm.addBot(room, player.id);
  assert.equal(room.members.length, 2);
  rm.removeBot(room, player.id, bot.id);
  assert.equal(room.members.length, 1);
  assert.throws(() => rm.removeBot(room, player.id, bot.id), RoomError, 'повторно убрать нельзя');
});

test('в партии с ботами снапшот не выдаёт их закрытые карты', () => {
  const game = soloGame(3);
  game.start();
  const snap = game.snapshotFor('human');
  for (const p of snap.players) {
    if (p.id === 'human') continue;
    assert.equal(p.cards, undefined, 'закрытые карты ботов не должны уходить человеку');
    assert.deepEqual(p.revealedCards, [], 'на старте у ботов ничего не раскрыто');
  }
});
