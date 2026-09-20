'use strict';

/**
 * Проверка статической сборки (та, что уезжает на GitHub Pages).
 *
 * Поднимает dist/ по подкаталогу — ровно так GitHub Pages отдаёт проектные
 * сайты (/имя-репозитория/) — и играет партию в браузере без всякого сервера.
 * Если в сборке остались абсолютные пути или не подключился движок, тест это
 * поймает: на Pages такие ошибки видны только вживую.
 *
 *   node tools/build-pages.js && node tests/e2e/check-pages-build.js
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('node:assert/strict');

const { loadPlaywright } = require('../helpers/playwright');

const { chromium } = loadPlaywright();

const ROOT = path.join(__dirname, '..', '..');
const DIST = path.join(ROOT, 'dist');
const PREFIX = '/bunker-live';
const PORT = Number(process.env.PAGES_PORT || 3126);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

/** Статический сервер с префиксом подкаталога, как у GitHub Pages. */
function serve() {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(path.join(DIST, 'index.html'))) {
      reject(new Error('Нет dist/index.html — сначала запустите node tools/build-pages.js'));
      return;
    }
    const server = http.createServer((req, res) => {
      let rel = decodeURIComponent(req.url.split('?')[0]);
      if (!rel.startsWith(PREFIX)) {
        res.writeHead(404).end('вне подкаталога');
        return;
      }
      rel = rel.slice(PREFIX.length) || '/';
      if (rel === '/') rel = '/index.html';
      const file = path.join(DIST, rel);
      if (!file.startsWith(DIST) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404).end('не найдено');
        return;
      }
      res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
      fs.createReadStream(file).pipe(res);
    });
    server.listen(PORT, '127.0.0.1', () => resolve(server));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const server = await serve();
  const base = `http://127.0.0.1:${PORT}${PREFIX}/`;
  console.log(`Сервер статики: ${base}`);

  const browser = await chromium.launch({ headless: true });
  const problems = [];
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
  page.on('console', (m) => { if (m.type() === 'error') problems.push(`console: ${m.text()}`); });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    // ERR_ABORTED — это отмена запроса, а не ошибка: Chromium прерывает
    // загрузку фоновой картинки, когда её экран скрывается. Реальную
    // доступность файлов проверяем отдельным запросом ниже.
    const reason = r.failure()?.errorText || '';
    if (reason.includes('ERR_ABORTED')) return;
    problems.push(`запрос упал: ${r.url()} (${reason})`);
  });

  await page.goto(base, { waitUntil: 'networkidle' });

  // Движок должен был загрузиться из бандла.
  const engine = await page.evaluate(() => ({
    есть: !!window.BunkerEngine,
    локально: !!window.__BUNKER_LOCAL__,
    колоды: window.__BUNKER_DECKS__ ? Object.keys(window.__BUNKER_DECKS__).length : 0,
    категорий: window.BunkerEngine ? Object.keys(window.BunkerEngine.categoryMeta()).length : 0,
  }));
  assert.equal(engine.есть, true, 'движок не загрузился');
  assert.equal(engine.локально, true, 'локальный клиент не подключился');
  assert.equal(engine.колоды, 14, `колод в сборке: ${engine.колоды}`);
  assert.equal(engine.категорий, 11, `категорий персонажа: ${engine.категорий}`);
  console.log(`✓ движок в браузере: ${engine.колоды} колод, ${engine.категорий} категорий`);

  // Панель входа по коду в статике бессмысленна и должна быть скрыта.
  const joinHidden = await page.locator('#panel-join').isHidden();
  assert.equal(joinHidden, true, 'панель «Войти по коду» должна быть скрыта в статической сборке');
  const noteVisible = await page.locator('#local-note').isVisible();
  assert.equal(noteVisible, true, 'пояснение про демо-сборку должно быть видно');
  console.log('✓ режим без сервера объявлен честно');

  await page.fill('#create-nick', 'Натали');
  await page.click('#btn-create');
  await page.waitForSelector('#screen-lobby.is-active', { timeout: 10000 });

  const bots = await page.locator('#lobby-players .player-chip--bot').count();
  assert.ok(bots >= 2, `ботов в лобби: ${bots} — партию не с кем играть`);
  const codeBlockHidden = await page.locator('.lobby__code').isHidden();
  assert.equal(codeBlockHidden, true, 'код приглашения не нужен в статике');
  console.log(`✓ лобби: ${bots} бота, код приглашения скрыт`);

  await page.click('#btn-start');
  await page.waitForSelector('#screen-game.is-active', { timeout: 10000 });
  console.log('✓ партия началась без сервера');

  // Играем до финала: человек делает свои ходы, боты — сами.
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
  assert.ok(reached, 'партия в статической сборке не дошла до финала');
  const survivors = await page.locator('.finale__player').count();
  const verdict = (await page.textContent('.finale__verdict')).trim();
  console.log(`✓ финал без сервера: выживших ${survivors}`);
  console.log(`  ${verdict.split('\n')[0].slice(0, 70)}`);

  // Картинки должны грузиться по относительным путям.
  const imgOk = await page.evaluate(async () => {
    const r = await fetch('img/hero.jpg', { method: 'HEAD' });
    return r.ok;
  });
  assert.equal(imgOk, true, 'картинки не отдаются по относительному пути');
  console.log('✓ статика (арт) отдаётся по относительным путям');

  await browser.close();
  server.close();
  await sleep(200);

  if (problems.length) {
    console.error('\n❌ Проблемы в браузере:');
    [...new Set(problems)].slice(0, 10).forEach((p) => console.error(`   ${p}`));
    process.exit(1);
  }
  console.log('\n✅ Ошибок и упавших запросов нет');
  console.log('PAGES BUILD OK');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nПРОВАЛ ПРОВЕРКИ СБОРКИ:', err.message);
  process.exit(1);
});
