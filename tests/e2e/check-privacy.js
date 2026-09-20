'use strict';

/**
 * E2E-проверка приватности: закрытые характеристики игрока не должны
 * попадать в снапшоты, которые сервер отправляет другим игрокам.
 *
 * Метод: каждый клиент играет партию и записывает ВСЕ полученные снапшоты.
 * У каждого игрока есть свой полный набор карт (он видит его сам).
 * Для каждого снапшота, полученного клиентом i, проверяем: названия карт
 * игрока j, ещё не раскрытых на этот момент, не встречаются в этом снапшоте.
 *
 *   node tests/e2e/check-privacy.js [число игроков]
 */

const { spawn } = require('child_process');
const path = require('path');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');

const PORT = Number(process.env.E2E_PRIVACY_PORT || 3113);
const PLAYER_COUNT = Number(process.argv[2] || 6);
const ROOT = path.join(__dirname, '..', '..');
const BASE = `http://127.0.0.1:${PORT}`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ready = false;
    child.stdout.on('data', (b) => {
      if (!ready && /запущен/.test(b.toString())) { ready = true; resolve(child); }
    });
    child.stderr.on('data', (b) => process.stderr.write(`[server] ${b}`));
    child.on('exit', (c) => { if (!ready) reject(new Error(`сервер упал: ${c}`)); });
    setTimeout(() => { if (!ready) reject(new Error('сервер не поднялся')); }, 15000);
  });
}

function connect() {
  return new Promise((resolve, reject) => {
    const s = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
    s.on('connect', () => resolve(s));
    s.on('connect_error', reject);
    setTimeout(() => reject(new Error('нет подключения')), 10000);
  });
}

const emit = (s, e, p) => new Promise((r) => s.emit(e, p || {}, (res) => r(res || {})));

async function main() {
  const server = await startServer();
  const names = Array.from({ length: PLAYER_COUNT }, (_, i) => `Житель${i + 1}`);
  const sockets = [];
  for (let i = 0; i < PLAYER_COUNT; i += 1) sockets.push(await connect());

  /** Полный набор карт каждого игрока (узнаём от него самого). */
  const ownCards = {};
  /** Все снапшоты, полученные каждым клиентом. */
  const received = sockets.map(() => []);
  /** Максимально раскрытые категории по игрокам на текущий момент. */
  const revealedTitles = {};

  const created = await emit(sockets[0], 'room:create', { nickname: names[0] });
  assert.equal(created.ok, true, created.error);
  for (let i = 1; i < sockets.length; i += 1) {
    const res = await emit(sockets[i], 'room:join', { code: created.roomCode, nickname: names[i], token: '' });
    assert.equal(res.ok, true, `${names[i]}: ${res.error}`);
  }

  let finalState = null;
  const errors = [];

  sockets.forEach((socket, index) => {
    let pending = null;
    let running = false;

    const pump = async () => {
      if (running) return;
      running = true;
      while (pending && !finalState) {
        const st = pending;
        pending = null;
        try { await act(socket, st); } catch (e) { errors.push(`${names[index]}: ${e.message}`); }
      }
      running = false;
    };

    socket.on('state', (st) => {
      received[index].push(st);
      if (st.me && st.me.cards && st.me.cards.length) {
        ownCards[st.me.id] = st.me.cards.map((c) => c.title);
      }
      for (const p of st.players || []) {
        const set = revealedTitles[p.id] || new Set();
        for (const c of p.revealedCards || []) set.add(c.title);
        revealedTitles[p.id] = set;
      }
      if (finalState) return;
      if (st.phase === 'finale' || st.phase === 'ended') { finalState = st; return; }
      pending = st;
      pump();
    });

    async function act(s, st) {
      const me = st.me;
      if (!me) return;
      switch (st.phase) {
        case 'intro':
          if (me.isHost) await emit(s, 'phase:advance', {});
          break;
        case 'reveal': {
          if (st.turn.currentId !== me.id) return;
          const mustProf = st.round === 1 && !me.cards.some((c) => c.category === 'profession' && c.revealed);
          const hidden = me.cards.filter((c) => !c.revealed);
          const pick = mustProf ? hidden.find((c) => c.category === 'profession') : hidden[0];
          if (pick) await emit(s, 'turn:reveal', { category: pick.category });
          break;
        }
        case 'discussion': case 'accusation': case 'defense': case 'farewell': case 'summary':
          if (me.isHost) await emit(s, 'phase:advance', {});
          break;
        case 'voting': case 'revote': {
          if (!me.canVote || me.hasVoted) return;
          const alive = st.players.filter((p) => !p.exiled);
          const pool = st.voting.stage === 'revote' && st.voting.candidates.length
            ? alive.filter((p) => st.voting.candidates.includes(p.id)) : alive;
          const victim = [...pool].reverse().find((p) => p.id !== me.id);
          if (victim) await emit(s, 'vote:cast', { targetId: victim.id });
          break;
        }
        default: break;
      }
    }
  });

  const started = await emit(sockets[0], 'game:start', {});
  assert.equal(started.ok, true, started.error);

  const deadline = Date.now() + 60000;
  while (!finalState && Date.now() < deadline) await sleep(200);
  assert.ok(finalState, 'партия не дошла до финала');
  assert.equal(errors.length, 0, errors.join('\n'));

  // ── Собственно проверка утечек ──
  let snapshotsChecked = 0;
  let leaks = 0;
  const leakSamples = [];

  for (let i = 0; i < sockets.length; i += 1) {
    const meId = received[i].find((s) => s.me)?.me.id;
    if (!meId) continue;

    for (const snap of received[i]) {
      snapshotsChecked += 1;
      const json = JSON.stringify(snap);
      // Что уже раскрыто у каждого игрока на момент этого снапшота.
      const revealedNow = {};
      for (const p of snap.players || []) {
        revealedNow[p.id] = new Set((p.revealedCards || []).map((c) => c.title));
      }
      // Легальное исключение: игрок мог тайно подсмотреть чужие карты.
      const peekedTitles = new Set();
      for (const targetId of Object.keys(snap.peeked || {})) {
        for (const c of snap.peeked[targetId] || []) peekedTitles.add(c.title);
      }

      for (const [otherId, titles] of Object.entries(ownCards)) {
        if (otherId === meId) continue; // свои карты видеть можно
        const shown = revealedNow[otherId] || new Set();
        for (const title of titles) {
          if (shown.has(title)) continue; // уже раскрыта — законно
          if (peekedTitles.has(title)) continue; // законно подсмотрена
          if (json.includes(JSON.stringify(title).slice(1, -1))) {
            leaks += 1;
            if (leakSamples.length < 5) {
              leakSamples.push(`снапшот для ${names[i]}: утёк закрытый «${title}» игрока ${otherId} (фаза ${snap.phase})`);
            }
          }
        }
      }
    }
  }

  console.log(`Игроков: ${PLAYER_COUNT}`);
  console.log(`Проверено снапшотов: ${snapshotsChecked}`);
  console.log(`Наборов карт под наблюдением: ${Object.keys(ownCards).length}`);

  for (const s of sockets) s.close();
  server.kill();
  await sleep(300);

  if (leaks) {
    console.error(`\n❌ УТЕЧЕК: ${leaks}`);
    leakSamples.forEach((l) => console.error(`   ${l}`));
    process.exit(1);
  }
  console.log('\n✅ Утечек закрытых карт не обнаружено');
  console.log('PRIVACY OK');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('ПРОВАЛ ПРОВЕРКИ ПРИВАТНОСТИ:', err.message);
  process.exit(1);
});
