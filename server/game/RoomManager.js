'use strict';

const crypto = require('crypto');
const { GameState } = require('./GameState');
const { defaultSettings } = require('./rules');

/** Алфавит без похожих символов: нет O/0, I/1, чтобы код не путали. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 5;
const MAX_PLAYERS = 16;
const ROOM_TTL_MS = 6 * 60 * 60 * 1000; // 6 часов

function randomCode() {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    out += CODE_ALPHABET[crypto.randomInt(0, CODE_ALPHABET.length)];
  }
  return out;
}

function randomId(bytes = 8) {
  return crypto.randomBytes(bytes).toString('hex');
}

function sanitizeNickname(raw) {
  const s = String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return s.slice(0, 20);
}

class RoomError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RoomError';
    this.userFacing = true;
  }
}

class RoomManager {
  constructor() {
    /** @type {Map<string, object>} */
    this.rooms = new Map();
  }

  get size() {
    return this.rooms.size;
  }

  get(code) {
    return this.rooms.get(String(code || '').toUpperCase()) || null;
  }

  _newRoomCode() {
    for (let attempt = 0; attempt < 50; attempt += 1) {
      const code = randomCode();
      if (!this.rooms.has(code)) return code;
    }
    throw new RoomError('Не удалось сгенерировать код комнаты, попробуйте ещё раз');
  }

  createRoom({ nickname }) {
    const name = sanitizeNickname(nickname);
    if (name.length < 2) throw new RoomError('Никнейм должен быть не короче 2 символов');

    const code = this._newRoomCode();
    const player = {
      id: randomId(6),
      token: randomId(16),
      nickname: name,
      isHost: true,
      connected: true,
      socketId: null,
    };
    const room = {
      code,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      members: [player],
      settings: defaultSettings(),
      game: null,
      lastActivity: Date.now(),
    };
    this.rooms.set(code, room);
    return { room, player };
  }

  joinRoom({ code, nickname, token }) {
    const room = this.get(code);
    if (!room) throw new RoomError('Комната не найдена. Проверьте код приглашения.');

    // Возврат в ту же комнату по сохранённому токену (перезагрузка страницы).
    if (token) {
      const existing = room.members.find((m) => m.token === token);
      if (existing) {
        existing.connected = true;
        room.lastActivity = Date.now();
        if (room.game) {
          const gp = room.game.getPlayer(existing.id);
          if (gp) gp.connected = true;
        }
        return { room, player: existing, reconnected: true };
      }
    }

    if (room.game && room.game.phase !== 'lobby') {
      throw new RoomError('Партия уже началась. Дождитесь следующей.');
    }
    if (room.members.length >= MAX_PLAYERS) {
      throw new RoomError(`В комнате уже максимум игроков (${MAX_PLAYERS})`);
    }

    const name = sanitizeNickname(nickname);
    if (name.length < 2) throw new RoomError('Никнейм должен быть не короче 2 символов');
    const clash = room.members.some((m) => m.nickname.toLowerCase() === name.toLowerCase());
    if (clash) throw new RoomError('Такой никнейм уже занят в этой комнате');

    const player = {
      id: randomId(6),
      token: randomId(16),
      nickname: name,
      isHost: room.members.length === 0,
      connected: true,
      socketId: null,
    };
    room.members.push(player);
    room.lastActivity = Date.now();
    return { room, player, reconnected: false };
  }

  setSocket(room, playerId, socketId) {
    const member = room.members.find((m) => m.id === playerId);
    if (member) member.socketId = socketId;
  }

  markDisconnected(room, playerId) {
    const member = room.members.find((m) => m.id === playerId);
    if (!member) return;
    member.connected = false;
    member.socketId = null;
    room.lastActivity = Date.now();
    if (room.game) {
      const gp = room.game.getPlayer(playerId);
      if (gp) gp.connected = false;
    }
  }

  /** Передаёт роль ведущего первому подключённому игроку. */
  reassignHost(room) {
    if (room.game && room.game.phase !== 'lobby') return null;
    const alive = room.members.filter((m) => m.connected);
    const pool = alive.length ? alive : room.members;
    if (!pool.length) return null;
    room.members.forEach((m) => { m.isHost = false; });
    pool[0].isHost = true;
    if (room.game) room.game.players.forEach((p) => { p.isHost = p.id === pool[0].id; });
    return pool[0];
  }

  /** Полное удаление игрока из комнаты (выход, а не разрыв связи). */
  removePlayer(room, playerId) {
    const idx = room.members.findIndex((m) => m.id === playerId);
    if (idx === -1) return;
    const wasHost = room.members[idx].isHost;
    room.members.splice(idx, 1);
    if (room.game) {
      const gp = room.game.getPlayer(playerId);
      if (gp) {
        gp.connected = false;
        gp.left = true;
      }
    }
    if (wasHost) this.reassignHost(room);
    room.lastActivity = Date.now();
  }

  startGame(room, actorId) {
    if (room.game && room.game.phase !== 'lobby') throw new RoomError('Партия уже идёт');
    const actor = room.members.find((m) => m.id === actorId);
    if (!actor || !actor.isHost) throw new RoomError('Начать партию может только ведущий');
    if (room.members.length < 2) throw new RoomError('Нужно минимум 2 игрока');

    const seed = crypto.randomInt(0, 0xffffffff);
    room.game = new GameState({
      roomCode: room.code,
      settings: room.settings,
      seed,
      players: room.members.map((m) => ({
        id: m.id,
        nickname: m.nickname,
        isHost: m.isHost,
        connected: m.connected,
        joinedAt: room.createdAt,
      })),
    });
    room.game.start();
    return room.game;
  }

  /** Раз в секунду: двигает таймеры всех активных партий. */
  tickAll(now = Date.now()) {
    const changed = [];
    for (const room of this.rooms.values()) {
      if (!room.game) continue;
      if (room.game.tick(now)) changed.push(room);
    }
    return changed;
  }

  /** Чистка брошенных комнат. */
  cleanup(now = Date.now()) {
    const removed = [];
    for (const [code, room] of this.rooms.entries()) {
      const idle = now - room.lastActivity;
      const anyConnected = room.members.some((m) => m.connected);
      const empty = room.members.length === 0;
      if (empty || (!anyConnected && idle > 30 * 60 * 1000) || idle > ROOM_TTL_MS) {
        this.rooms.delete(code);
        removed.push(code);
      }
    }
    return removed;
  }

  /** Публичная сводка комнаты для лобби. */
  summary(room) {
    return {
      code: room.code,
      players: room.members.length,
      maxPlayers: MAX_PLAYERS,
      phase: room.game ? room.game.phase : 'lobby',
      started: !!(room.game && room.game.phase !== 'lobby'),
    };
  }
}

module.exports = {
  RoomManager,
  RoomError,
  sanitizeNickname,
  randomCode,
  CODE_ALPHABET,
  CODE_LENGTH,
  MAX_PLAYERS,
};
