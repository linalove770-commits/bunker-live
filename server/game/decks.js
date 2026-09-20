'use strict';

const { CHARACTER_CATEGORIES, DECK_FILES } = require('./constants');

const cache = new Map();

/**
 * fs и path нужны только в Node. В статической сборке (GitHub Pages) движок
 * работает прямо в браузере, где файловой системы нет, а данные приходят
 * одним объектом `__BUNKER_DECKS__`. Поэтому require ленивый: при загрузке
 * модуля в браузере до него дело не доходит.
 */
let nodeFs = null;
function fileSystem() {
  if (!nodeFs) {
    // eslint-disable-next-line global-require
    nodeFs = { fs: require('fs'), path: require('path') };
  }
  return nodeFs;
}

function readJson(fileName) {
  const bundled = globalThis.__BUNKER_DECKS__;
  if (bundled) {
    if (!bundled[fileName]) {
      throw new Error(`Колода ${fileName} не попала в статическую сборку`);
    }
    return bundled[fileName];
  }
  const { fs, path } = fileSystem();
  const full = path.join(__dirname, 'data', `${fileName}.json`);
  const raw = fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, '');
  return JSON.parse(raw);
}

/** Загружает колоду один раз и кеширует. */
function loadDeck(fileName) {
  if (cache.has(fileName)) return cache.get(fileName);
  const deck = readJson(fileName);
  if (!deck || !Array.isArray(deck.cards)) {
    throw new Error(`Колода ${fileName}.json: отсутствует массив "cards"`);
  }
  cache.set(fileName, deck);
  return deck;
}

/** Все колоды одним объектом: { professions: {...}, ... } */
function loadAllDecks() {
  const out = {};
  for (const f of DECK_FILES) out[f] = loadDeck(f);
  return out;
}

/** Справка для интерфейса (фазы, FAQ, глоссарий). */
function loadHelp() {
  if (cache.has('__help')) return cache.get('__help');
  const help = readJson('help');
  cache.set('__help', help);
  return help;
}

/** Метаданные категорий персонажа в порядке раскрытия: label/icon/размер колоды. */
function categoryMeta() {
  const decks = loadAllDecks();
  const meta = {};
  for (const f of DECK_FILES) {
    const d = decks[f];
    // Катастрофы и бункер — не характеристики персонажа, у них своя подача.
    if (!d.category || !CHARACTER_CATEGORIES.includes(d.category)) continue;
    meta[d.category] = {
      category: d.category,
      label: d.label,
      icon: d.icon,
      size: d.cards.length,
      deckFile: f,
    };
  }
  return meta;
}

/** Карточка по id (поиск по всем колодам персонажа + бункер/катастрофа). */
function findCardById(id) {
  const decks = loadAllDecks();
  for (const f of DECK_FILES) {
    const found = decks[f].cards.find((c) => c.id === id);
    if (found) return { ...found, _deck: f };
  }
  return null;
}

/** Проверка целостности данных. Бросает Error с перечнем проблем. */
function validateDecks() {
  const problems = [];
  const seenTitles = new Map();
  const decks = loadAllDecks();

  for (const f of DECK_FILES) {
    const deck = decks[f];
    if (!deck.label || !deck.icon || !deck.category) {
      problems.push(`${f}.json: не заполнены category/label/icon`);
    }
    const seenIds = new Set();
    for (const card of deck.cards) {
      if (!card.id) problems.push(`${f}.json: карточка без id`);
      if (seenIds.has(card.id)) problems.push(`${f}.json: дубликат id ${card.id}`);
      seenIds.add(card.id);
      if (!card.title) problems.push(`${f}.json/${card.id}: нет title`);
      if (!card.text) problems.push(`${f}.json/${card.id}: нет text`);
      if (!card.tip) problems.push(`${f}.json/${card.id}: нет tip`);
      if (!Array.isArray(card.tags) || card.tags.length === 0) {
        problems.push(`${f}.json/${card.id}: нет tags`);
      }
      if (seenTitles.has(card.title)) {
        problems.push(`дубликат title "${card.title}" (${seenTitles.get(card.title)} и ${card.id})`);
      } else {
        seenTitles.set(card.title, card.id);
      }
    }
  }

  for (const cat of CHARACTER_CATEGORIES) {
    const meta = Object.values(decks).find((d) => d.category === cat);
    if (!meta) problems.push(`нет колоды для категории ${cat}`);
  }

  if (problems.length) {
    throw new Error(`Данные колод не прошли проверку:\n - ${problems.join('\n - ')}`);
  }
  return true;
}

module.exports = {
  CHARACTER_CATEGORIES,
  DECK_FILES,
  loadDeck,
  loadAllDecks,
  loadHelp,
  categoryMeta,
  findCardById,
  validateDecks,
};
