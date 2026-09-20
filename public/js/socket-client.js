'use strict';

/**
 * Обёртка над Socket.IO: промисы вместо колбэков + хранение токена игрока,
 * чтобы перезагрузка страницы возвращала в ту же комнату.
 */
(function () {
  const TOKEN_KEY = 'bunker.token';
  const NICK_KEY = 'bunker.nickname';
  const MUTE_KEY = 'bunker.muted';

  const handlers = {
    state: [],
    toast: [],
    sound: [],
    log: [],
    chat: [],
    meta: [],
    notesSaved: [],
  };

  let socket = null;

  function emit(event, payload) {
    return new Promise((resolve) => {
      if (!socket) return resolve({ ok: false, error: 'Нет соединения с сервером' });
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) { settled = true; resolve({ ok: false, error: 'Сервер не ответил, попробуйте ещё раз' }); }
      }, 8000);
      socket.emit(event, payload || {}, (res) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(res || { ok: false, error: 'Пустой ответ сервера' });
      });
    });
  }

  const api = {
    connect() {
      if (socket) return socket;
      socket = window.io({
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 800,
      });

      socket.on('state', (s) => handlers.state.forEach((h) => h(s)));
      socket.on('toast', (t) => handlers.toast.forEach((h) => h(t)));
      socket.on('sound', (s) => handlers.sound.forEach((h) => h(s)));
      socket.on('log:append', (l) => handlers.log.forEach((h) => h(l)));
      socket.on('chat:message', (m) => handlers.chat.forEach((h) => h(m)));
      socket.on('meta', (m) => handlers.meta.forEach((h) => h(m)));
      socket.on('notes:saved', (n) => handlers.notesSaved.forEach((h) => h(n)));
      socket.on('connect', () => {
        // Переподключились — пробуем вернуться в комнату по токену.
        // Но если в ссылке указана ДРУГАЯ комната, возвращаться в старую нельзя:
        // иначе переход по чужому приглашению уводит в прежнюю партию.
        const token = api.getToken();
        const stored = api.getCode();
        const fromUrl = (new URLSearchParams(window.location.search).get('room') || '').toUpperCase();
        if (!token || !stored) return;
        if (fromUrl && fromUrl !== stored) return;
        api.joinRoom({ code: stored, token }).then(() => {});
      });
      return socket;
    },

    on(event, fn) {
      if (handlers[event]) handlers[event].push(fn);
    },

    createRoom(nickname) {
      return emit('room:create', { nickname });
    },
    joinRoom({ code, nickname, token }) {
      return emit('room:join', { code, nickname, token });
    },
    leaveRoom() {
      return emit('room:leave', {});
    },
    updateSettings(patch) {
      return emit('settings:update', patch);
    },
    startGame() {
      return emit('game:start', {});
    },
    reveal(category) {
      return emit('turn:reveal', { category });
    },
    advance() {
      return emit('phase:advance', {});
    },
    vote(targetId) {
      return emit('vote:cast', { targetId });
    },
    skipVote() {
      return emit('vote:skip', {});
    },
    defenseDone() {
      return emit('defense:done', {});
    },
    addBot() {
      return emit('room:addBot', {});
    },
    removeBot(botId) {
      return emit('room:removeBot', { botId });
    },
    setNotes(text) {
      return emit('note:set', { text });
    },
    useSpecial(targetId) {
      return emit('special:use', { targetId: targetId || null });
    },
    sendChat(text) {
      return emit('chat:send', { text });
    },

    // ── локальное хранилище ──
    setToken(token) { try { localStorage.setItem(TOKEN_KEY, token); } catch (e) { /* приватный режим */ } },
    getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; } },
    setCode(code) { try { localStorage.setItem('bunker.code', code); } catch (e) { /* ignore */ } },
    getCode() { try { return localStorage.getItem('bunker.code') || ''; } catch (e) { return ''; } },
    clearSession() {
      try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem('bunker.code'); } catch (e) { /* ignore */ }
    },
    setNickname(nick) { try { localStorage.setItem(NICK_KEY, nick); } catch (e) { /* ignore */ } },
    getNickname() { try { return localStorage.getItem(NICK_KEY) || ''; } catch (e) { return ''; } },
    setMuted(v) { try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch (e) { /* ignore */ } },
    getMuted() { try { return localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { return false; } },
  };

  window.BunkerSocket = api;
})();
