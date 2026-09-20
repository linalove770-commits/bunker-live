'use strict';

const { createRng } = require('./rng');
const { loadAllDecks, CHARACTER_CATEGORIES } = require('./decks');

/**
 * Раздача карт: катастрофа, бункер, персонаж.
 * Одна колода на игру — карты внутри категории не повторяются между игроками,
 * пока в колоде хватает карт.
 */
class DeckGenerator {
  constructor(seed) {
    this.seed = seed >>> 0;
    this.rng = createRng(this.seed);
    const decks = loadAllDecks();
    this.decks = decks;
    this.pools = {};
    // Рабочие копии колод, из которых вытягиваем без возврата.
    for (const cat of CHARACTER_CATEGORIES) {
      const deck = Object.values(decks).find((d) => d.category === cat);
      if (!deck) throw new Error(`Нет колоды для категории ${cat}`);
      this.pools[cat] = this.rng.shuffle(deck.cards);
    }
    this.meta = {};
    for (const cat of CHARACTER_CATEGORIES) {
      const deck = Object.values(decks).find((d) => d.category === cat);
      this.meta[cat] = { label: deck.label, icon: deck.icon };
    }
  }

  /** Достаёт карту категории; если колода исчерпана — начинает заново. */
  draw(category) {
    const pool = this.pools[category];
    if (!pool || pool.length === 0) {
      const deck = Object.values(this.decks).find((d) => d.category === category);
      this.pools[category] = this.rng.shuffle(deck.cards);
    }
    return this.pools[category].pop();
  }

  /** Случайная карта конкретной категории (для замены/переброса). */
  drawSpecific(category) {
    return this.draw(category);
  }

  /** Катастрофа партии. */
  generateCatastrophe() {
    const card = this.rng.pick(this.decks.catastrophes.cards);
    return { ...card };
  }

  /**
   * Бункер: 3 карты преимуществ + 2 карты проблем.
   * Итоговые площадь/еда/спальни — сумма всех карт.
   */
  generateBunker() {
    const cards = this.decks.bunker.cards;
    const advantages = this.rng.sample(cards.filter((c) => c.kind === 'advantage'), 3);
    const hazards = this.rng.sample(cards.filter((c) => c.kind === 'hazard'), 2);
    const all = [...advantages, ...hazards];
    const sum = (key) => all.reduce((acc, c) => acc + (Number(c[key]) || 0), 0);
    return {
      cards: all.map((c) => ({ ...c })),
      advantages: advantages.map((c) => c.id),
      hazards: hazards.map((c) => c.id),
      area_sqm: sum('area_sqm'),
      food_units: sum('food_units'),
      sleeping_rooms: sum('sleeping_rooms'),
      items: all.flatMap((c) => c.items || []),
    };
  }

  /** Персонаж: по одной карте в каждой из 11 категорий. */
  generateCharacter() {
    const cards = {};
    for (const cat of CHARACTER_CATEGORIES) cards[cat] = this.draw(cat).id;
    return cards;
  }

  /** Полная раздача для N игроков. */
  generateGame(playerCount) {
    return {
      catastrophe: this.generateCatastrophe(),
      bunker: this.generateBunker(),
      characters: Array.from({ length: playerCount }, () => this.generateCharacter()),
    };
  }
}

module.exports = { DeckGenerator };
