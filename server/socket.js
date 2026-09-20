'use strict';

const { RoomManager, RoomError, MAX_PLAYERS } = require('./game/RoomManager');
const { GameError } = require('./game/GameState');
const { loadHelp, categoryMeta } = require('./game/decks');
const { SEATS_MODE, bunkerSeats, defaultSettings, applySettingsPatch } = require('./game/rules');

const roomManager = new RoomManager();

/** Снапшот лобби — форма совпадает с игровым, чтобы клиент рендерил одинаково. */
function buildLobbyState(room, member) {
  const seats = bunkerSeats({
    mode: room.settings.seatsMode,
    fixed: room.settings.seatsFixed,
    players: room.members.length,
  });
  return {
    roomCode: room.code,
    phase: 'lobby',
    round: 0,
    maxRounds: room.settings.maxRounds,
    started: false,
    seatCount: seats,
    seatInfo: {
      seats,
      mode: room.settings.seatsMode,
      players: room.members.length,
      hint: room.settings.seatsMode === SEATS_MODE.FIXED
        ? 'задано ведущим'
        : `половина от ${room.members.length} с округлением вниз`,
    },
    exilesNeeded: Math.max(0, room.members.length - seats),
    players: room.members.map((m) => ({
      id: m.id,
      nickname: m.nickname,
      isHost: m.isHost,
      isBot: !!m.isBot,
      connected: m.connected,
      exiled: false,
      revealed: [],
      revealedCards: [],
      hasVoted: false,
      isTurn: false,
      isSpeaking: false,
    })),
    me: {
      id: member.id,
      nickname: member.nickname,
      isHost: member.isHost,
      cards: [],
      notes: '',
      canVote: false,
    },
    peeked: {},
    catastrophe: null,
    bunker: null,
    voting: { open: false, stage: null, candidates: [], canSkip: false, votedCount: 0, voterCount: 0, tally: null },
    turn: { currentId: null, index: 0, total: 0, order: [], speakingId: null },
    timer: { phase: 'lobby', duration: 0, remaining: 0, deadline: null },
    canAdvance: member.isHost,
    settings: room.settings,
    log: [],
    finale: null,
    history: [],
    pendingExile: [],
    maxPlayers: MAX_PLAYERS,
  };
}

function registerSocketHandlers(io) {
  const emitState = (room) => {
    if (!room) return;
    for (const m of room.members) {
      if (!m.socketId) continue;
      const socket = io.sockets.sockets.get(m.socketId);
      if (!socket) continue;
      const snapshot = room.game ? room.game.snapshotFor(m.id) : buildLobbyState(room, m);
      socket.emit('state', snapshot);
    }
  };

  const drainEvents = (room) => {
    if (!room || !room.game) return;
    const events = room.game.drainEvents();
    for (const ev of events) {
      if (ev.type === 'toast') io.to(room.code).emit('toast', { message: ev.message, kind: ev.kind });
      if (ev.type === 'sound') io.to(room.code).emit('sound', { name: ev.name });
      if (ev.type === 'log') io.to(room.code).emit('log:append', ev.entry);
    }
  };

  /** Общая обёртка: ловим пользовательские ошибки и отдаём их только инициатору. */
  const guard = (socket, fn) => (payload, ack) => {
    try {
      const result = fn(payload || {});
      if (typeof ack === 'function') ack({ ok: true, ...(result || {}) });
    } catch (err) {
      const userFacing = err && (err.userFacing || err.name === 'GameError' || err.name === 'RoomError');
      if (typeof ack === 'function') {
        ack({ ok: false, error: userFacing ? err.message : 'Внутренняя ошибка сервера' });
      }
      if (!userFacing) console.error('[socket]', err);
    }
  };

  io.on('connection', (socket) => {
    socket.data.roomCode = null;
    socket.data.playerId = null;

    const requireRoom = () => {
      const room = roomManager.get(socket.data.roomCode);
      if (!room) throw new RoomError('Комната не найдена');
      return room;
    };

    socket.emit('meta', {
      categories: categoryMeta(),
      help: loadHelp(),
      defaults: defaultSettings(),
      seatsModes: Object.values(SEATS_MODE),
      maxPlayers: MAX_PLAYERS,
    });

    socket.on('room:create', guard(socket, ({ nickname }) => {
      const { room, player } = roomManager.createRoom({ nickname });
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      roomManager.setSocket(room, player.id, socket.id);
      emitState(room);
      return { roomCode: room.code, playerId: player.id, token: player.token };
    }));

    socket.on('room:join', guard(socket, ({ code, nickname, token }) => {
      const { room, player, reconnected } = roomManager.joinRoom({ code, nickname, token });
      socket.join(room.code);
      socket.data.roomCode = room.code;
      socket.data.playerId = player.id;
      roomManager.setSocket(room, player.id, socket.id);
      if (reconnected) socket.emit('toast', { message: 'С возвращением! Подключение восстановлено.', kind: 'ok' });
      emitState(room);
      return { roomCode: room.code, playerId: player.id, token: player.token, reconnected };
    }));

    socket.on('room:leave', guard(socket, () => {
      const room = requireRoom();
      const playerId = socket.data.playerId;
      roomManager.removePlayer(room, playerId);
      socket.leave(room.code);
      socket.data.roomCode = null;
      socket.data.playerId = null;
      emitState(room);
      if (room.members.length === 0) roomManager.rooms.delete(room.code);
      return {};
    }));

    socket.on('settings:update', guard(socket, (patch) => {
      const room = requireRoom();
      const member = room.members.find((m) => m.id === socket.data.playerId);
      if (!member || !member.isHost) throw new RoomError('Настройки меняет только ведущий');
      if (room.game && room.game.phase !== 'lobby') throw new RoomError('Настройки фиксируются до начала партии');

      applySettingsPatch(room.settings, patch, { maxPlayers: MAX_PLAYERS });
      if (room.game) room.game.settings = room.settings;
      emitState(room);
      return { settings: room.settings };
    }));

    socket.on('room:addBot', guard(socket, () => {
      const room = requireRoom();
      const bot = roomManager.addBot(room, socket.data.playerId);
      drainEvents(room);
      emitState(room);
      return { botId: bot.id, nickname: bot.nickname };
    }));

    socket.on('room:removeBot', guard(socket, ({ botId }) => {
      const room = requireRoom();
      const removed = roomManager.removeBot(room, socket.data.playerId, botId);
      drainEvents(room);
      emitState(room);
      return { nickname: removed.nickname };
    }));

    socket.on('game:start', guard(socket, () => {
      const room = requireRoom();
      roomManager.startGame(room, socket.data.playerId);
      drainEvents(room);
      emitState(room);
      return {};
    }));

    socket.on('turn:reveal', guard(socket, ({ category }) => {
      const room = requireRoom();
      if (!room.game) throw new RoomError('Партия ещё не началась');
      room.game.reveal(socket.data.playerId, category);
      drainEvents(room);
      emitState(room);
      return {};
    }));

    socket.on('phase:advance', guard(socket, () => {
      const room = requireRoom();
      if (!room.game) throw new RoomError('Партия ещё не началась');
      room.game.advance(socket.data.playerId);
      drainEvents(room);
      emitState(room);
      return {};
    }));

    socket.on('vote:cast', guard(socket, ({ targetId }) => {
      const room = requireRoom();
      if (!room.game) throw new RoomError('Партия ещё не началась');
      room.game.castVote(socket.data.playerId, targetId);
      drainEvents(room);
      emitState(room);
      return {};
    }));

    socket.on('vote:skip', guard(socket, () => {
      const room = requireRoom();
      if (!room.game) throw new RoomError('Партия ещё не началась');
      room.game.castVote(socket.data.playerId, 'skip');
      drainEvents(room);
      emitState(room);
      return {};
    }));

    socket.on('defense:done', guard(socket, () => {
      const room = requireRoom();
      if (!room.game) throw new RoomError('Партия ещё не началась');
      room.game.advance(socket.data.playerId);
      drainEvents(room);
      emitState(room);
      return {};
    }));

    socket.on('note:set', guard(socket, ({ text }) => {
      const room = requireRoom();
      const member = room.members.find((m) => m.id === socket.data.playerId);
      if (!member) throw new RoomError('Игрок не найден');
      const clean = String(text == null ? '' : text).slice(0, 2000);
      if (room.game) {
        const gp = room.game.getPlayer(member.id);
        if (gp) gp.notes = clean;
      } else {
        member.notes = clean;
      }
      socket.emit('notes:saved', { text: clean });
      return {};
    }));

    socket.on('special:use', guard(socket, ({ targetId }) => {
      const room = requireRoom();
      if (!room.game) throw new RoomError('Партия ещё не началась');
      room.game.useSpecial(socket.data.playerId, targetId || null);
      drainEvents(room);
      emitState(room);
      return {};
    }));

    socket.on('chat:send', guard(socket, ({ text }) => {
      const room = requireRoom();
      const member = room.members.find((m) => m.id === socket.data.playerId);
      if (!member) throw new RoomError('Игрок не найден');
      const clean = String(text == null ? '' : text).trim().slice(0, 300);
      if (!clean) throw new RoomError('Пустое сообщение');
      io.to(room.code).emit('chat:message', { from: member.nickname, fromId: member.id, text: clean, t: Date.now() });
      return {};
    }));

    socket.on('disconnect', () => {
      const room = roomManager.get(socket.data.roomCode);
      if (!room) return;
      roomManager.markDisconnected(room, socket.data.playerId);
      emitState(room);
    });
  });

  // Тик таймеров и уборка брошенных комнат.
  setInterval(() => {
    for (const room of roomManager.tickAll()) {
      drainEvents(room);
      emitState(room);
    }
  }, 1000);

  setInterval(() => {
    const removed = roomManager.cleanup();
    if (removed.length) console.log('[cleanup] удалены комнаты:', removed.join(', '));
  }, 60 * 1000);

  return { roomManager, emitState, drainEvents };
}

module.exports = { registerSocketHandlers, roomManager, buildLobbyState };
