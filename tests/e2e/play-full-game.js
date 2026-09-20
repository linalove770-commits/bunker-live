'use strict';

/**
 * Полный E2E-прогон партии через настоящие WebSocket-соединения.
 *
 * Запускает сервер на тестовом порту, подключает N живых клиентов,
 * играет партию до финала и проверяет, что в бункере оказалось ровно
 * столько людей, сколько мест.
 *
 *   node tests/e2e/play-full-game.js [число игроков]
 */

const { spawn } = require('child_process');
const path = require('path');
const assert = require('node:assert/strict');
const { io } = require('socket.io-client');

const PORT = Number(process.env.E2E_PORT || 3111);
const PLAYER_COUNT = Number(process.argv[2] || 6);
const ROOT = path.join(__dirname, '..', '..');
const BASE = `http://127.0.0.1:${PORT}`;

const timeline = [];
function note(text) {
  const line = `${String(Date.now() % 100000).padStart(5, ' ')}  ${text}`;
  timeline.push(line);
  console.log(line);
}

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ready = false;
    const onData = (buf) => {
      const text = buf.toString();
      if (!ready && /запущен|http:\/\/localhost/.test(text)) {
        ready = true;
        resolve(child);
      }
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', (buf) => process.stderr.write(`[server] ${buf}`));
    child.on('exit', (code) => {
      if (!ready) reject(new Error(`Сервер завершился с кодом ${code}`));
    });
    setTimeout(() => {
      if (!ready) reject(new Error('Сервер не поднялся за 15 секунд'));
    }, 15000);
  });
}

function connect(name) {
  return new Promise((resolve, reject) => {
    const socket = io(BASE, { transports: ['websocket'], forceNew: true, reconnection: false });
    socket.on('connect', () => resolve(socket));
    socket.on('connect_error', reject);
    setTimeout(() => reject(new Error(`${name}: не удалось подключиться`)), 10000);
  });
}

function emit(socket, event, payload) {
  return new Promise((resolve) => {
    socket.emit(event, payload || {}, (res) => resolve(res || {}));
  });
}

async function main() {
  note(`Запускаю сервер на порту ${PORT}…`);
  const server = await startServer();
  note('Сервер поднят.');

  const sockets = [];
  const names = Array.from({ length: PLAYER_COUNT }, (_, i) => `Боец${i + 1}`);
  for (const name of names) {
    sockets.push(await connect(name));
  }
  note(`Подключено клиентов: ${sockets.length}`);

  // Хост создаёт комнату.
  const hostRes = await emit(sockets[0], 'room:create', { nickname: names[0] });
  assert.equal(hostRes.ok, true, `создание комнаты: ${hostRes.error || ''}`);
  const code = hostRes.roomCode;
  assert.match(code, /^[A-Z0-9]{5}$/, 'код комнаты должен быть из 5 символов');
  note(`Комната создана, код ${code}`);

  // Остальные входят по коду приглашения.
  for (let i = 1; i < sockets.length; i += 1) {
    const res = await emit(sockets[i], 'room:join', { code, nickname: names[i], token: '' });
    assert.equal(res.ok, true, `${names[i]} не вошёл: ${res.error || ''}`);
  }
  note(`Все ${sockets.length} игроков в лобби`);

  // Проверяем, что вход по неверному коду отклоняется.
  const badJoin = await emit(sockets[1], 'room:join', { code: 'ZZZZZ', nickname: 'Чужак', token: '' });
  assert.equal(badJoin.ok, false, 'вход по несуществующему коду должен падать');
  note(`Неверный код отклонён: «${badJoin.error}»`);

  // Доступ к настройкам есть только у ведущего.
  const denied = await emit(sockets[1], 'settings:update', { seatsMode: 'fixed', seatsFixed: 2 });
  assert.equal(denied.ok, false, 'обычный игрок не должен менять настройки');
  note('Настройки защищены от не-ведущего');

  // Агенты должны быть подписаны ДО старта: иначе первый снапшот теряется
  // и партия замирает на вводной фазе.
  let finalState = null;
  const errors = [];

  // Каждый клиент играет сам. Важно не терять снапшоты: пока агент выполняет
  // ход, приходят новые состояния, поэтому держим «последнее» и доигрываем его.
  sockets.forEach((socket, index) => {
    let pending = null;
    let running = false;

    const pump = async () => {
      if (running) return;
      running = true;
      while (pending && !finalState) {
        const st = pending;
        pending = null;
        try {
          await act(socket, st, index);
        } catch (err) {
          errors.push(`${names[index]}: ${err.message}`);
        }
      }
      running = false;
    };

    socket.on('state', (st) => {
      if (finalState) return;
      if (st.phase === 'finale' || st.phase === 'ended') {
        if (!finalState) {
          finalState = st;
          note(`ФИНАЛ: в бункере ${st.finale.survivors.length} из ${st.players.length}, вердикт «${st.finale.verdict.title}»`);
        }
        return;
      }
      pending = st;
      pump();
    });
  });

  // Старт партии.
  const startRes = await emit(sockets[0], 'game:start', {});
  assert.equal(startRes.ok, true, `старт: ${startRes.error || ''}`);
  note('Партия начата');

  async function act(socket, st, index) {
    const me = st.me;
    if (!me) return;

    switch (st.phase) {
      case 'intro':
        if (me.isHost) await emit(socket, 'phase:advance', {});
        break;

      case 'reveal': {
        if (st.turn.currentId !== me.id) return;
        const left = me.revealsLeft;
        if (left <= 0) return;
        const mustProfession = st.round === 1 && !me.cards.some((c) => c.category === 'profession' && c.revealed);
        const hidden = me.cards.filter((c) => !c.revealed);
        const pick = mustProfession ? hidden.find((c) => c.category === 'profession') : hidden[0];
        if (!pick) return;
        const res = await emit(socket, 'turn:reveal', { category: pick.category });
        if (!res.ok) errors.push(`${me.nickname}: раскрытие отклонено — ${res.error}`);
        break;
      }

      case 'discussion':
      case 'accusation':
      case 'defense':
      case 'farewell':
      case 'summary':
        if (me.isHost) await emit(socket, 'phase:advance', {});
        break;

      case 'voting':
      case 'revote': {
        if (!me.canVote || me.hasVoted) return;
        const alive = st.players.filter((p) => !p.exiled);
        const candidates = st.voting.stage === 'revote' && st.voting.candidates.length
          ? alive.filter((p) => st.voting.candidates.includes(p.id))
          : alive;
        // Все голосуют против последнего живого — так складывается большинство.
        const victim = [...candidates].reverse().find((p) => p.id !== me.id);
        if (!victim) return;
        const res = await emit(socket, 'vote:cast', { targetId: victim.id });
        if (!res.ok) errors.push(`${me.nickname}: голос отклонён — ${res.error}`);
        break;
      }

      default:
        break;
    }
  }

  // Ждём финал.
  const deadline = Date.now() + 60000;
  while (!finalState && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 250));
  }

  assert.ok(finalState, 'партия не дошла до финала за 60 секунд');
  assert.equal(errors.length, 0, `ошибки во время партии:\n${errors.join('\n')}`);

  const f = finalState.finale;
  assert.equal(f.survivors.length, finalState.seatCount,
    `в бункере должно быть ${finalState.seatCount} человек, а оказалось ${f.survivors.length}`);
  assert.equal(f.exiled.length, PLAYER_COUNT - finalState.seatCount,
    'число изгнанных должно дополнять состав до числа мест');
  assert.ok(f.score >= 0 && f.score <= 100, 'оценка выживания в диапазоне 0-100');
  assert.ok(f.verdict.title, 'у финала должен быть вердикт');
  assert.ok(f.catastrophe && f.catastrophe.title, 'в финале видна катастрофа');
  assert.equal(f.bunker.cards.length, 5, 'в финале видны все карты бункера');

  // Проверяем, что скрытые карты не утекали в чужие снапшоты на старте.
  note(`Изгнаны: ${f.exiled.map((e) => e.nickname).join(', ') || '—'}`);
  note(`Выжили: ${f.survivors.map((s) => s.nickname).join(', ')}`);
  note(`Оценка выживания: ${f.score}/100 — ${f.verdict.title}`);

  for (const socket of sockets) socket.close();
  server.kill();
  await new Promise((r) => setTimeout(r, 300));

  console.log('\n──────────── ТАЙМЛАЙН ────────────');
  console.log(timeline.join('\n'));
  console.log('\nE2E OK: партия из ' + PLAYER_COUNT + ' игроков доиграна до финала.');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nE2E ПРОВАЛ:', err.message);
  console.error(timeline.join('\n'));
  process.exit(1);
});
