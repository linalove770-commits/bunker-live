'use strict';

/**
 * Поиск Playwright: локально он может лежать вне проекта, в CI — в node_modules.
 * Порядок: явный путь из окружения → зависимость проекта → известный локальный путь.
 */
const CANDIDATES = [
  process.env.PLAYWRIGHT_PATH,
  'playwright',
  'D:/HermesPipeline/Hermes/node_modules/playwright',
];

function loadPlaywright() {
  for (const candidate of CANDIDATES) {
    if (!candidate) continue;
    try {
      // eslint-disable-next-line global-require, import/no-dynamic-require
      return require(candidate);
    } catch (err) {
      // пробуем следующий вариант
    }
  }
  throw new Error(
    'Playwright не найден. Установите его: npm i -D playwright && npx playwright install chromium',
  );
}

module.exports = { loadPlaywright };
