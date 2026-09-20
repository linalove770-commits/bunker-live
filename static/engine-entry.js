'use strict';

// Точка входа статической сборки: весь движок игры работает в браузере.
// Данные колод подставляет decks.data.js через globalThis.__BUNKER_DECKS__.
const { GameState, GameError, PHASES, parseDurationMonths } = require('../server/game/GameState');
const { loadHelp, categoryMeta, findCardById, loadDeck } = require('../server/game/decks');
const rules = require('../server/game/rules');

window.BunkerEngine = {
  GameState,
  GameError,
  PHASES,
  parseDurationMonths,
  loadHelp,
  categoryMeta,
  findCardById,
  loadDeck,
  ...rules,
};
