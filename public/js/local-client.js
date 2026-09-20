'use strict';

/**
 * Локальный режим для статической сборки (GitHub Pages).
 *
 * Сервера нет, поэтому движок крутится прямо в браузере, а соперники — боты.
 * Наружу отдаётся ровно тот же интерфейс, что и `BunkerSocket`, поэтому
 * app.js и render.js работают без изменений: меняется только транспорт.
 */
(function () {
  const E = window.BunkerEngine;
  if (!E) {
    console.error('BunkerEngine не загружен — статическая сборка собрана неверно');
    return;
  }

  const HUMAN = 'human';
  const DEFAULT_BOTS = 3;

  const handlers = {
    state: [], toast: [], sound: [], log: [], meta: [], notesSaved: [],
  };

  let game = null;
  let timer = null;

  const fire = (event, payload) => (handlers[event] || []).forEach((fn) => fn(payload));

  function publish() {
    if (game) fire('state', game.snapshotFor(HUMAN));
  }

  function drain() {
    if (!game) return;
    for (const ev of game.drainEvents()) {
      if (ev.type === 'toast') fire('toast', { message: ev.message, kind: ev.kind });
      if (ev.type === 'sound') fire('sound', { name: ev.name });
    }
  }

  /** Выполняет действие над игрой, доносит ошибки до игрока и публикует состояние. */
  function act(fn) {
    let result = { ok: true };
    try {
      fn();
    } catch (err) {
      result = { ok: false, error: err.message };
    }
    drain();
    publish();
    return result;
  }

  function newGame(nickname) {
    game = new E.GameState({
      roomCode: 'ЛОКАЛ',
      settings: E.defaultSettings(),
      seed: Math.floor(Math.random() * 0xffffffff) >>> 0,
      players: [{ id: HUMAN, nickname, isHost: true, connected: true }],
    });
    for (let i = 0; i < DEFAULT_BOTS; i += 1) {
      game.addPlayer({ id: `bot${i + 1}`, nickname: `Бот-${i + 1}`, isBot: true });
    }
    return game;
  }

  /** Раз в секунду двигаем партию — так же, как это делает сервер. */
  function startLoop() {
    if (timer) return;
    timer = setInterval(() => {
      if (!game) return;
      if (game.tick(Date.now())) {
        drain();
        publish();
      }
    }, 1000);
  }

  const api = {
    isLocal: true,

    connect() {
      startLoop();
      fire('meta', {
        categories: E.categoryMeta(),
        help: E.loadHelp(),
        defaults: E.defaultSettings(),
        seatsModes: Object.values(E.SEATS_MODE),
        maxPlayers: 12,
      });
      return api;
    },

    on(event, fn) {
      if (handlers[event]) handlers[event].push(fn);
    },

    createRoom(nickname) {
      const name = String(nickname || '').trim().slice(0, 20) || 'Игрок';
      return Promise.resolve(act(() => {
        newGame(name);
        api.setNickname(name);
      }).ok ? { ok: true, roomCode: 'ЛОКАЛ', playerId: HUMAN, token: '' } : { ok: false, error: 'Не удалось создать партию' });
    },

    // В локальном режиме присоединяться некуда: партия всегда одна.
    joinRoom() {
      return Promise.resolve({ ok: false, error: 'В этой сборке нет комнат — играйте с ботами на одном устройстве.' });
    },

    leaveRoom() {
      game = null;
      return Promise.resolve({ ok: true });
    },

    updateSettings(patch) {
      return Promise.resolve(act(() => {
        E.applySettingsPatch(game.settings, patch, { maxPlayers: 12 });
        game.seatCount = game.seatInfo().seats;
      }));
    },

    startGame() {
      return Promise.resolve(act(() => {
        if (game.players.length < 2) throw new Error('Добавьте хотя бы одного бота');
        game.start();
      }));
    },

    reveal(category) {
      return Promise.resolve(act(() => game.reveal(HUMAN, category)));
    },

    advance() {
      return Promise.resolve(act(() => game.advance(HUMAN)));
    },

    vote(targetId) {
      return Promise.resolve(act(() => game.castVote(HUMAN, targetId)));
    },

    skipVote() {
      return Promise.resolve(act(() => game.castVote(HUMAN, 'skip')));
    },

    defenseDone() {
      return Promise.resolve(act(() => game.advance(HUMAN)));
    },

    addBot() {
      return Promise.resolve(act(() => {
        const n = game.players.filter((p) => p.isBot).length + 1;
        game.addPlayer({ id: `bot${n}-${Date.now()}`, nickname: `Бот-${n}`, isBot: true });
      }));
    },

    removeBot(botId) {
      return Promise.resolve(act(() => game.removeBotById(botId)));
    },

    setNotes(text) {
      return Promise.resolve(act(() => {
        const me = game.getPlayer(HUMAN);
        if (me) me.notes = String(text == null ? '' : text).slice(0, 2000);
      }));
    },

    useSpecial(targetId) {
      return Promise.resolve(act(() => game.useSpecial(HUMAN, targetId || null)));
    },

    sendChat() {
      return Promise.resolve({ ok: false, error: 'Чата в локальном режиме нет.' });
    },

    // ── локальное хранилище: та же поверхность, что у сокет-клиента ──
    setToken() {},
    getToken() { return ''; },
    setCode() {},
    getCode() { return ''; },
    clearSession() {},
    setNickname(nick) {
      try { localStorage.setItem('bunker.nickname', nick); } catch (e) { /* приватный режим */ }
    },
    getNickname() {
      try { return localStorage.getItem('bunker.nickname') || ''; } catch (e) { return ''; }
    },
    setMuted(v) {
      try { localStorage.setItem('bunker.muted', v ? '1' : '0'); } catch (e) { /* ignore */ }
    },
    getMuted() {
      try { return localStorage.getItem('bunker.muted') === '1'; } catch (e) { return false; }
    },
  };

  window.BunkerSocket = api;
  window.__BUNKER_LOCAL__ = true;
})();
