'use strict';

/**
 * Детерминированный генератор случайных чисел (mulberry32).
 * Нужен, чтобы партии можно было воспроизводить в тестах по seed.
 */
function createRng(seed) {
  let a = seed >>> 0;
  const rng = function next() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  rng.int = (min, max) => min + Math.floor(rng() * (max - min + 1));
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length)];
  rng.chance = (p) => rng() < p;

  /** Перемешивание Фишера — Йетса, возвращает новый массив. */
  rng.shuffle = (arr) => {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
      const j = Math.floor(rng() * (i + 1));
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  };

  /** Берёт n элементов без повторов. */
  rng.sample = (arr, n) => rng.shuffle(arr).slice(0, Math.max(0, Math.min(n, arr.length)));

  return rng;
}

/** Случайный seed, если вызывающий код его не задал. */
function randomSeed() {
  return Math.floor(Math.random() * 0xffffffff) >>> 0;
}

module.exports = { createRng, randomSeed };
