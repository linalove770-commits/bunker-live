'use strict';

/**
 * Соло-проверка в настоящем браузере: ОДИН живой человек.
 *
 * Открывается одна страница, создаётся комната, добавляются боты, партия
 * играется до финала. Человек жмёт только свои ходы — боты раскрывают карты,
 * голосуют и оправдываются сами.
 *
 *   node tests/e2e/check-solo.js
 */

const { spawn } = require('child_process');
const path = require('path');
const assert = require('node:assert/strict');

const PW_PATH = process.env.PLAYWRIGHT_PATH || 'D:/HermesPipeline/Hermes/node_modules/playwright';
const { chromium } = require(PW_PATH);

const PORT = Number(process.env.SOLO_PORT || 3125);
const ROOT = path.join(__dirname, '..', '..');
const BASE = `http://127.0.0.1:${PORT}`;
const BOTS = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function startServer() {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [path.join(ROOT, 'server', 'server.js')], {
      cwd: ROOT,
      env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let ready = false;
    child.stdout.on('data', (b) => {
      if (!ready && /запущен/.test(b.toString())) { ready = true; resolve(child); }
    });
    child.stderr.on('data', (b) => process.stderr.write(`[server] ${b}`));
    child.on('exit', (c) => { if (!ready) reject(new Error(`сервер упал: ${c}`)); });
    setTimeout(() => { if (!ready) reject(new Error('сервер не поднялся')); }, 15000);
  });
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const problems = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));

  await page.goto(BASE, { waitUntil: 'domcontentloaded' });
  await page.fill('#create-nick', 'Натали');
  await page.click('#btn-create');
  await page.waitForSelector('#screen-lobby.is-active');

  // Одному начинать нечем — кнопка старта заблокирована.
  assert.equal(await page.locator('#btn-start').isDisabled(), true, 'одному стартовать нельзя');
  console.log('✓ одному без ботов старт заблокирован');

  // Добавляем ботов прямо из лобби.
  for (let i = 0; i < BOTS; i += 1) await page.click('#btn-add-bot');
  await page.waitForFunction(
    (n) => document.querySelectorAll('#lobby-players .player-chip--bot').length === n,
    BOTS, { timeout: 10000 },
  );
  const total = await page.locator('#lobby-players .player-chip').count();
  assert.equal(total, BOTS + 1, `в лобби должно быть ${BOTS + 1} участников, а не ${total}`);
  console.log(`✓ добавлено ${BOTS} бота, в лобби ${total} участник(ов)`);

  assert.equal(await page.locator('#btn-start').isDisabled(), false, 'с ботами старт доступен');
  await page.click('#btn-start');
  await page.waitForSelector('#screen-game.is-active', { timeout: 10000 });
  console.log('✓ партия с ботами стартовала');

  // Играем до финала: человек делает только свои ходы, остальное — боты и таймеры.
  const humanStep = () => page.evaluate(() => {
    const modal = document.querySelector('#modal-vote');
    if (modal && !modal.hasAttribute('hidden')) {
      const card = document.querySelector('#vote-grid .vote-card');
      if (card) {
        card.click();
        const confirm = document.querySelector('#btn-vote-confirm');
        if (confirm && !confirm.disabled) { confirm.click(); return 'voted'; }
        return 'picked';
      }
      return 'modal-empty';
    }
    // Кнопку спец. возможности не трогаем: она требует выбора цели.
    const btn = document.querySelector('#action-buttons .btn:not(.btn--danger)');
    if (btn && !btn.disabled) { btn.click(); return 'clicked'; }
    return 'idle';
  });

  let reached = false;
  const deadline = Date.now() + 120000;
  while (!reached && Date.now() < deadline) {
    reached = (await page.locator('#screen-finale:not([hidden])').count()) > 0;
    if (reached) break;
    await humanStep();
    await sleep(300);
  }

  assert.ok(reached, 'соло-партия не дошла до финала');
  console.log('✓ соло-партия доиграна до финала');

  const verdict = (await page.textContent('.finale__verdict')).trim();
  const survivors = await page.locator('.finale__player').count();
  const exiled = await page.locator('.player-chip--out').count();
  const seatText = (await page.textContent('.finale__verdict')).trim();
  assert.ok(verdict.length > 20, 'финал не отрисован');
  assert.equal(survivors + exiled, BOTS + 1, `выживших ${survivors} + изгнанных ${exiled} ≠ ${BOTS + 1}`);
  console.log(`✓ финал: выживших ${survivors}, изгнанных ${exiled}`);
  console.log(`  ${seatText.split('\n')[0].slice(0, 70)}`);

  // Боты должны были раскрывать характеристики — иначе партия не сыграна.
  const revealed = await page.evaluate(() =>
    [...document.querySelectorAll('#seat-list .seat')]
      .filter((s) => s.querySelectorAll('.card--revealed').length > 0).length);
  assert.ok(revealed >= 1, 'ни один участник не раскрыл карт — партия не сыграна');
  console.log(`✓ характеристики раскрывали ${revealed} участник(ов)`);

  await browser.close();
  server.kill();
  await sleep(300);

  if (problems.length) {
    console.error('\n❌ Ошибки в браузере:');
    problems.slice(0, 8).forEach((p) => console.error(`   ${p}`));
    process.exit(1);
  }
  console.log('\n✅ Ошибок в консоли нет');
  console.log('SOLO OK');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nПРОВАЛ СОЛО-ПРОВЕРКИ:', err.message);
  process.exit(1);
});
