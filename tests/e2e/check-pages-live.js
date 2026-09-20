'use strict';

/**
 * Проверка уже опубликованного демо на GitHub Pages.
 *
 * Открывает живой адрес и играет партию до финала: если сборка уехала битой,
 * тут это видно сразу, а не со слов.
 *
 *   node tests/e2e/check-pages-live.js [url]
 */

const assert = require('node:assert/strict');
const { loadPlaywright } = require('../helpers/playwright');

const { chromium } = loadPlaywright();

const URL = process.argv[2] || 'https://linalove770-commits.github.io/bunker-live/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await chromium.launch({ headless: true });
  const problems = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    const reason = r.failure()?.errorText || '';
    if (reason.includes('ERR_ABORTED')) return;
    problems.push(`запрос упал: ${r.url()} (${reason})`);
  });

  console.log(`Открываю ${URL}`);
  const response = await page.goto(URL, { waitUntil: 'networkidle', timeout: 45000 });
  assert.equal(response.status(), 200, `страница вернула ${response.status()}`);

  const engine = await page.evaluate(() => ({
    есть: !!window.BunkerEngine,
    локально: !!window.__BUNKER_LOCAL__,
    колод: window.__BUNKER_DECKS__ ? Object.keys(window.__BUNKER_DECKS__).length : 0,
    категорий: window.BunkerEngine ? Object.keys(window.BunkerEngine.categoryMeta()).length : 0,
  }));
  assert.equal(engine.есть, true, 'движок не загрузился на живом сайте');
  assert.equal(engine.локально, true, 'локальный режим не включился');
  console.log(`✓ движок загружен: ${engine.колод} колод, ${engine.категорий} категорий`);

  await page.fill('#create-nick', 'Проверка');
  await page.click('#btn-create');
  await page.waitForSelector('#screen-lobby.is-active', { timeout: 15000 });
  const bots = await page.locator('#lobby-players .player-chip--bot').count();
  assert.ok(bots >= 2, `ботов в лобби: ${bots}`);
  console.log(`✓ лобби на живом сайте: ${bots} бота`);

  await page.click('#btn-start');
  await page.waitForSelector('#screen-game.is-active', { timeout: 15000 });
  console.log('✓ партия началась');

  const step = () => page.evaluate(() => {
    const modal = document.querySelector('#modal-vote');
    if (modal && !modal.hasAttribute('hidden')) {
      const card = document.querySelector('#vote-grid .vote-card');
      if (card) {
        card.click();
        const confirm = document.querySelector('#btn-vote-confirm');
        if (confirm && !confirm.disabled) { confirm.click(); return 'voted'; }
      }
      return 'modal';
    }
    const btn = document.querySelector('#action-buttons .btn:not(.btn--danger)');
    if (btn && !btn.disabled) { btn.click(); return 'clicked'; }
    return 'idle';
  });

  let reached = false;
  const deadline = Date.now() + 120000;
  while (!reached && Date.now() < deadline) {
    reached = (await page.locator('#screen-finale:not([hidden])').count()) > 0;
    if (reached) break;
    await step();
    await sleep(300);
  }
  assert.ok(reached, 'партия на живом сайте не дошла до финала');

  const survivors = await page.locator('.finale__player').count();
  const verdict = (await page.textContent('.finale__verdict')).trim();
  assert.ok(survivors >= 1, 'в финале нет выживших');
  console.log(`✓ партия доиграна: выживших ${survivors}`);
  console.log(`  ${verdict.split('\n')[0].slice(0, 70)}`);

  await browser.close();

  if (problems.length) {
    console.error('\n❌ Проблемы на живом сайте:');
    [...new Set(problems)].slice(0, 10).forEach((p) => console.error(`   ${p}`));
    process.exit(1);
  }
  console.log('\n✅ Живой сайт работает без ошибок');
  console.log('PAGES LIVE OK');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nПРОВАЛ ПРОВЕРКИ ЖИВОГО САЙТА:', err.message);
  process.exit(1);
});
