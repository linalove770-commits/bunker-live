'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  loadAllDecks,
  loadHelp,
  categoryMeta,
  validateDecks,
  findCardById,
  DECK_FILES,
} = require('../server/game/decks');
const { CHARACTER_CATEGORIES } = require('../server/game/constants');

/** Минимальные требования к объёму колод. */
const MIN_CARDS = {
  professions: 30,
  biology: 24,
  body: 20,
  traits: 24,
  health: 28,
  hobbies: 28,
  phobias: 24,
  luggage: 28,
  backpack: 28,
  facts: 30,
  specials: 22,
  catastrophes: 18,
  bunker: 24,
};

test('все колоды проходят проверку целостности', () => {
  assert.equal(validateDecks(), true);
});

test('в каждой колоде достаточно карт и заполнены обязательные поля', () => {
  const decks = loadAllDecks();
  for (const file of DECK_FILES) {
    const deck = decks[file];
    assert.ok(deck.label, `${file}: нет label`);
    assert.ok(deck.icon, `${file}: нет icon`);
    assert.ok(deck.cards.length >= (MIN_CARDS[file] || 1),
      `${file}: карт ${deck.cards.length}, ожидалось минимум ${MIN_CARDS[file]}`);
    for (const card of deck.cards) {
      assert.ok(card.id, `${file}: карта без id`);
      assert.ok(card.title, `${file}/${card.id}: нет title`);
      assert.ok(card.text && card.text.length >= 40, `${file}/${card.id}: слишком короткий text`);
      assert.ok(card.tip && card.tip.length >= 30, `${file}/${card.id}: нет полезной подсказки tip`);
      assert.ok(Array.isArray(card.tags) && card.tags.length >= 1, `${file}/${card.id}: нет tags`);
    }
  }
});

test('id уникальны во всём наборе данных', () => {
  const decks = loadAllDecks();
  const seen = new Map();
  for (const file of DECK_FILES) {
    for (const card of decks[file].cards) {
      assert.equal(seen.has(card.id), false, `id ${card.id} повторяется (${seen.get(card.id)} и ${file})`);
      seen.set(card.id, file);
    }
  }
});

test('все 11 категорий персонажа присутствуют в метаданных', () => {
  const meta = categoryMeta();
  for (const cat of CHARACTER_CATEGORIES) {
    assert.ok(meta[cat], `нет метаданных для категории ${cat}`);
    assert.ok(meta[cat].label, `категория ${cat}: нет label`);
    assert.ok(meta[cat].icon, `категория ${cat}: нет icon`);
    assert.ok(meta[cat].size > 0, `категория ${cat}: пустая колода`);
  }
  assert.equal(Object.keys(meta).length, 11, 'должно быть ровно 11 категорий персонажа');
});

test('карточка ищется по id из любой колоды', () => {
  const decks = loadAllDecks();
  const sample = decks.professions.cards[0];
  const found = findCardById(sample.id);
  assert.ok(found, 'карта не найдена по id');
  assert.equal(found.title, sample.title);
  assert.equal(findCardById('нет-такой-карты'), null);
});

test('катастрофы: severity 1-5, есть длительность и угрозы', () => {
  const cats = loadAllDecks().catastrophes.cards;
  const severities = new Set();
  for (const c of cats) {
    assert.ok(Number.isInteger(c.severity) && c.severity >= 1 && c.severity <= 5, `${c.id}: severity=${c.severity}`);
    assert.ok(typeof c.duration === 'string' && c.duration.length > 0, `${c.id}: нет duration`);
    assert.ok(Array.isArray(c.threats) && c.threats.length >= 2, `${c.id}: мало угроз`);
    severities.add(c.severity);
  }
  assert.ok(severities.size >= 3, 'жёсткость катастроф должна быть разнообразной');
});

test('бункер: есть и преимущества, и проблемы, числовые поля в границах', () => {
  const bunker = loadAllDecks().bunker.cards;
  const advantages = bunker.filter((c) => c.kind === 'advantage');
  const hazards = bunker.filter((c) => c.kind === 'hazard');
  assert.ok(advantages.length >= 3, 'нужно минимум 3 карты преимуществ для раздачи');
  assert.ok(hazards.length >= 2, 'нужно минимум 2 карты проблем для раздачи');
  for (const c of bunker) {
    assert.ok(['advantage', 'hazard'].includes(c.kind), `${c.id}: kind=${c.kind}`);
    assert.ok(c.area_sqm > 0, `${c.id}: area_sqm`);
    assert.ok(c.food_units >= 0, `${c.id}: food_units`);
    assert.ok(c.sleeping_rooms >= 1, `${c.id}: sleeping_rooms`);
    assert.ok(Array.isArray(c.items) && c.items.length >= 1, `${c.id}: нет items`);
  }
});

test('спец. возможности: эффекты и цели из разрешённого набора', () => {
  const cards = loadAllDecks().specials.cards;
  const allowedEffects = new Set([
    'reveal_other', 'swap_card', 'immune_vote', 'double_vote', 'cancel_vote', 'peek_other',
    'heal_self', 'boost_self', 'extra_time', 'return_player', 'reroll_card', 'silence_player',
  ]);
  const allowedTargets = new Set(['self', 'one_player', 'all', 'none']);
  const seen = new Set();
  for (const c of cards) {
    assert.ok(allowedEffects.has(c.effect), `${c.id}: неизвестный effect=${c.effect}`);
    assert.ok(allowedTargets.has(c.targeting), `${c.id}: неизвестный targeting=${c.targeting}`);
    seen.add(c.effect);
  }
  assert.equal(seen.size, allowedEffects.size, 'должны быть представлены все 12 эффектов');
});

test('справка: 6 фаз, FAQ и словарь заполнены', () => {
  const help = loadHelp();
  assert.equal(help.phases.length, 6, 'должно быть 6 фаз');
  const ids = help.phases.map((p) => p.id).sort().join(',');
  assert.equal(ids, 'defense,discussion,finale,lobby,reveal,voting');
  for (const p of help.phases) {
    assert.ok(p.title && p.short && p.text, `фаза ${p.id}: пустые поля`);
    assert.ok(Array.isArray(p.tips) && p.tips.length >= 1, `фаза ${p.id}: нет советов`);
  }
  assert.ok(help.faq.length >= 10, `FAQ: ${help.faq.length} вопросов, нужно минимум 10`);
  for (const item of help.faq) assert.ok(item.q && item.a, 'в FAQ пустой вопрос или ответ');
  assert.ok(help.glossary.length >= 8, `словарь: ${help.glossary.length} терминов, нужно минимум 8`);
});
