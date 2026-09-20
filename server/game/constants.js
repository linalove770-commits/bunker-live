'use strict';

/** Порядок категорий персонажа = порядок, в котором их логично раскрывать. */
const CHARACTER_CATEGORIES = [
  'profession',
  'biology',
  'body',
  'trait',
  'health',
  'hobby',
  'phobia',
  'luggage',
  'backpack',
  'fact',
  'special',
];

/** Всего характеристик у персонажа. */
const CATEGORY_TOTAL = CHARACTER_CATEGORIES.length;

/** Файлы колод в server/game/data/. */
const DECK_FILES = [
  'professions',
  'biology',
  'body',
  'traits',
  'health',
  'hobbies',
  'phobias',
  'luggage',
  'backpack',
  'facts',
  'specials',
  'catastrophes',
  'bunker',
];

/** Порядок фаз для справки в интерфейсе. */
const PHASES_LIST = [
  'lobby',
  'reveal',
  'discussion',
  'voting',
  'defense',
  'finale',
];

module.exports = {
  CHARACTER_CATEGORIES,
  CATEGORY_TOTAL,
  DECK_FILES,
  PHASES_LIST,
};
