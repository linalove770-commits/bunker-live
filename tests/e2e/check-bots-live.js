'use strict';

/**
 * Проверка соло-сценария на живом сервере: создать комнату, добавить ботов,
 * убрать одного, стартовать партию и убедиться, что боты реально играют.
 *
 *   node tests/e2e/check-bots-live.js [порт]
 */

const { io } = require('socket.io-client');

const PORT = Number(process.argv[2] || process.env.PORT || 3000);
const BASE = `http://127.0.0.1:${PORT}`;

(async () => {
  const socket = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise((resolve, reject) => {
    socket.on('connect', resolve);
    socket.on('connect_error', reject);
  });

  let state = null;
  socket.on('state', (st) => { state = st; });

  const emit = (event, payload) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${event}: сервер не ответил за 5 секунд`)), 5000);
    socket.emit(event, payload || {}, (res) => { clearTimeout(timer); resolve(res || {}); });
  });

  const created = await emit('room:create', { nickname: 'Натали' });
  if (!created.ok) throw new Error(`комната не создалась: ${created.error}`);
  console.log(`✓ комната ${created.roomCode}`);

  for (let i = 1; i <= 3; i += 1) {
    const res = await emit('room:addBot', {});
    if (!res.ok) throw new Error(`бот ${i} не добавился: ${res.error}`);
  }
  await new Promise((r) => setTimeout(r, 300));
  console.log(`✓ боты добавлены: ${state.players.filter((p) => p.isBot).map((p) => p.nickname).join(', ')}`);
  console.log(`  мест в бункере: ${state.seatCount} на ${state.players.length} участников`);

  const botId = state.players.find((p) => p.isBot).id;
  const removed = await emit('room:removeBot', { botId });
  if (!removed.ok) throw new Error(`бот не убрался: ${removed.error}`);
  await new Promise((r) => setTimeout(r, 300));
  console.log(`✓ бот убран, осталось участников: ${state.players.length}`);

  const started = await emit('game:start', {});
  if (!started.ok) throw new Error(`партия не началась: ${started.error}`);
  console.log('✓ партия началась');

  // Вводную закрывает ведущий, дальше боты ходят сами.
  await emit('phase:advance', {});
  await new Promise((r) => setTimeout(r, 300));

  const seen = new Set();
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    if (state) {
      seen.add(state.phase);
      // Человек делает только свои ходы, остальное — боты и таймеры.
      if (state.phase === 'reveal' && state.turn.currentId === state.me.id) {
        const me = state.me;
        const mustProfession = state.round === 1 && !me.cards.some((c) => c.category === 'profession' && c.revealed);
        const pool = me.cards.filter((c) => !c.revealed && (!mustProfession || c.category === 'profession'));
        if (pool.length) await emit('turn:reveal', { category: pool[0].category });
      }
      if ((state.phase === 'voting' || state.phase === 'revote') && state.me.canVote && !state.me.hasVoted) {
        const alive = state.players.filter((p) => !p.exiled);
        const pool = state.phase === 'revote' && state.voting.candidates.length
          ? alive.filter((p) => state.voting.candidates.includes(p.id))
          : alive;
        const target = pool.find((p) => p.id !== state.me.id);
        if (target) await emit('vote:cast', { targetId: target.id });
      }
      if (['discussion', 'summary'].includes(state.phase)) await emit('phase:advance', {});
      if (state.phase === 'finale' || state.phase === 'ended') break;
    }
    await new Promise((r) => setTimeout(r, 250));
  }

  const botsRevealed = state.players.filter((p) => p.isBot && p.revealed.length > 0).length;
  console.log(`✓ фазы за партию: ${[...seen].join(' → ')}`);
  console.log(`✓ ботов раскрывали карты: ${botsRevealed}`);
  if (botsRevealed === 0) throw new Error('боты не сделали ни одного хода — соло-режим не работает');
  if (state.phase !== 'finale' && state.phase !== 'ended') {
    console.log(`  (партия ещё идёт, фаза ${state.phase} — для проверки ботов этого достаточно)`);
  } else {
    console.log(`✓ финал: выживших ${state.finale.survivors.length} из ${state.players.length}`);
  }

  socket.close();
  console.log('\nBOTS LIVE OK');
})().then(() => process.exit(0)).catch((err) => {
  console.error('\nПРОВАЛ:', err.message);
  process.exit(1);
});
