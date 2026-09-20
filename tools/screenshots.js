'use strict';

/**
 * Снимает скриншоты ключевых экранов игры в реальном браузере.
 * Запуск: node tools/screenshots.js [папка]
 * По умолчанию складывает PNG в tools/screenshots/.
 */

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const PW_PATH = process.env.PLAYWRIGHT_PATH || 'D:/HermesPipeline/Hermes/node_modules/playwright';
const { chromium } = require(PW_PATH);

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2] || path.join(ROOT, 'tools', 'screenshots');
const PORT = Number(process.env.SHOT_PORT || 3120);
const BASE = `http://127.0.0.1:${PORT}`;
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
    child.on('exit', (c) => { if (!ready) reject(new Error(`сервер упал: ${c}`)); });
    setTimeout(() => { if (!ready) reject(new Error('сервер не поднялся')); }, 15000);
  });
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });

  const shots = [];
  const shot = async (page, name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file, fullPage: false });
    shots.push(file);
    console.log('✓', name, '→', file);
  };

  // ── Обложка, широкий экран ──
  const desktop = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
  const host = await desktop.newPage();
  await host.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(500);
  await shot(host, '01-home-desktop');

  // ── Обложка, телефон ──
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: 'ru-RU', deviceScaleFactor: 2 });
  const guest = await mobile.newPage();
  await guest.goto(BASE, { waitUntil: 'networkidle' });
  await sleep(400);
  await shot(guest, '02-home-mobile');

  // ── Лобби с кодом приглашения ──
  await host.fill('#create-nick', 'Натали');
  await host.click('#btn-create');
  await host.waitForSelector('#screen-lobby.is-active');
  const code = (await host.textContent('#lobby-code')).trim();

  await guest.goto(`${BASE}/?room=${code}`, { waitUntil: 'networkidle' });
  await guest.fill('#join-nick', 'Артём');
  await guest.click('#btn-join');
  await guest.waitForSelector('#screen-lobby.is-active');

  // Третий игрок, чтобы состав был нагляднее.
  // Отдельный контекст: в одном контексте общий localStorage, и новая вкладка
  // вернулась бы в комнату как уже вошедший игрок.
  const thirdCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
  const third = await thirdCtx.newPage();
  await third.goto(`${BASE}/?room=${code}`, { waitUntil: 'networkidle' });
  await third.fill('#join-nick', 'Кира');
  await third.click('#btn-join');
  await third.waitForSelector('#screen-lobby.is-active');
  await sleep(600);
  await shot(host, '03-lobby-desktop');

  // ── Старт партии: вводная ──
  await host.click('#btn-start');
  await host.waitForSelector('#screen-game.is-active');
  await sleep(700);
  await shot(host, '04-game-intro-desktop');
  await shot(guest, '05-game-intro-mobile');

  // ── Фаза раскрытия: ведущий открывает профессию ──
  await host.locator('#action-buttons .btn').first().click();
  await host.waitForFunction(
    () => /Ваш ход/.test((document.querySelector('#action-what') || {}).textContent || ''),
    null, { timeout: 15000 },
  );
  await sleep(300);
  await shot(host, '06-reveal-choice-desktop');

  await host.locator('#action-buttons .btn').first().click();
  await sleep(700);
  await shot(host, '07-reveal-done-desktop');
  await shot(guest, '08-seat-list-mobile');

  // ── Справка ──
  await host.click('#btn-help-game');
  await sleep(600);
  await shot(host, '09-help-desktop');
  await host.click('#btn-help-close');

  await browser.close();
  server.kill();
  await sleep(300);
  console.log(`\nГотово: ${shots.length} скриншотов в ${OUT}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('Не удалось снять скриншоты:', err.message);
  process.exit(1);
});
