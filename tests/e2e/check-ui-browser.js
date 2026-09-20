'use strict';

/**
 * UI-проверка в настоящем браузере (Playwright + Chromium).
 *
 * Что проверяем:
 *  - страница открывается без ошибок в консоли;
 *  - ведущий создаёт комнату и получает код из 5 символов;
 *  - второй игрок входит по этому коду и появляется в лобби;
 *  - партия стартует, на экране есть катастрофа, бункер и 11 карт персонажа;
 *  - панель «что делать сейчас» подсказывает действие, а не пустует;
 *  - раскрытие карты по кнопке реально меняет её состояние;
 *  - на мобильном разрешении 360px нет горизонтальной прокрутки.
 *
 *   node tests/e2e/check-ui-browser.js
 */

const { spawn } = require('child_process');
const path = require('path');
const assert = require('node:assert/strict');

const PW_PATH = process.env.PLAYWRIGHT_PATH || 'D:/HermesPipeline/Hermes/node_modules/playwright';
const { chromium } = require(PW_PATH);

const PORT = Number(process.env.UI_PORT || 3114);
const ROOT = path.join(__dirname, '..', '..');
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
    child.stderr.on('data', (b) => process.stderr.write(`[server] ${b}`));
    child.on('exit', (c) => { if (!ready) reject(new Error(`сервер упал: ${c}`)); });
    setTimeout(() => { if (!ready) reject(new Error('сервер не поднялся')); }, 15000);
  });
}

/** Собирает ошибки консоли и необработанные исключения страницы. */
function watchErrors(page, bucket) {
  page.on('console', (msg) => {
    if (msg.type() === 'error') bucket.push(`console: ${msg.text()}`);
  });
  page.on('pageerror', (err) => bucket.push(`pageerror: ${err.message}`));
}

async function main() {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true });
  const problems = [];

  // ── Ведущий ──
  const hostCtx = await browser.newContext({ viewport: { width: 1280, height: 900 }, locale: 'ru-RU' });
  const host = await hostCtx.newPage();
  watchErrors(host, problems);

  await host.goto(BASE, { waitUntil: 'domcontentloaded' });
  await host.waitForSelector('#screen-home.is-active', { timeout: 10000 });
  console.log('✓ главный экран открылся');

  const title = await host.title();
  assert.match(title, /Бункер/i, `заголовок страницы: ${title}`);
  console.log(`✓ заголовок: ${title}`);

  // Правила на обложке должны быть видны сразу.
  const ruleSteps = await host.locator('.rule-step').count();
  assert.equal(ruleSteps, 4, `шагов правил на обложке: ${ruleSteps}`);
  console.log('✓ на обложке 4 шага правил');

  await host.fill('#create-nick', 'Ведущая');
  await host.click('#btn-create');
  await host.waitForSelector('#screen-lobby.is-active', { timeout: 10000 });

  const code = (await host.textContent('#lobby-code')).trim();
  assert.match(code, /^[A-Z0-9]{5}$/, `код комнаты: «${code}»`);
  console.log(`✓ комната создана, код ${code}`);

  const lobbyPlayers = await host.locator('#lobby-players .player-chip').count();
  assert.equal(lobbyPlayers, 1, 'в лобби должен быть один игрок');
  console.log('✓ ведущий виден в лобби');

  // Кнопка старта заблокирована, пока нет второго игрока.
  assert.equal(await host.locator('#btn-start').isDisabled(), true, 'старт должен быть недоступен в одиночку');
  console.log('✓ старт заблокирован без второго игрока');

  // ── Второй игрок ──
  const guestCtx = await browser.newContext({ viewport: { width: 360, height: 740 }, locale: 'ru-RU' });
  const guest = await guestCtx.newPage();
  watchErrors(guest, problems);

  await guest.goto(`${BASE}/?room=${code}`, { waitUntil: 'domcontentloaded' });
  await guest.waitForSelector('#screen-home.is-active', { timeout: 10000 });

  // Ссылка-приглашение должна сама подставить код.
  const prefilled = await guest.inputValue('#join-code');
  assert.equal(prefilled, code, 'код из ссылки должен подставляться автоматически');
  console.log('✓ код из ссылки подставился сам');

  await guest.fill('#join-nick', 'Гость');
  await guest.click('#btn-join');
  await guest.waitForSelector('#screen-lobby.is-active', { timeout: 10000 });

  await host.waitForFunction(
    () => document.querySelectorAll('#lobby-players .player-chip').length === 2,
    null, { timeout: 10000 },
  );
  console.log('✓ оба игрока видны в лобби');

  // Гость не ведущий: настройки у него заблокированы, старт недоступен.
  assert.equal(await guest.locator('#btn-start').isDisabled(), true, 'гость не должен запускать партию');
  const locked = await guest.locator('#settings-panel').evaluate((n) => n.classList.contains('is-locked'));
  assert.equal(locked, true, 'настройки гостя должны быть заблокированы');
  console.log('✓ у гостя нет прав ведущего');

  // Подсказка о местах считается по правилам: 2 игрока → 1 место.
  const preview = await host.textContent('#seats-preview');
  assert.match(preview, /1/, `предпросмотр мест: «${preview}»`);
  console.log(`✓ предпросмотр мест: ${preview.trim().replace(/\s+/g, ' ')}`);

  // ── Старт партии ──
  await host.click('#btn-start');
  await host.waitForSelector('#screen-game.is-active', { timeout: 10000 });
  await guest.waitForSelector('#screen-game.is-active', { timeout: 10000 });
  console.log('✓ партия стартовала у обоих');

  // Катастрофа и бункер отрисованы.
  const catastrophe = (await host.textContent('#catastrophe-box')).trim();
  assert.ok(catastrophe.length > 40, 'катастрофа не отрисована');
  const bunkerCards = await host.locator('#bunker-box .bunker-card').count();
  assert.equal(bunkerCards, 5, `карт бункера: ${bunkerCards}`);
  console.log(`✓ катастрофа и бункер на экране (${bunkerCards} карт)`);

  // У персонажа 11 характеристик.
  const myCards = await host.locator('#my-sheet .card').count();
  assert.equal(myCards, 11, `карт персонажа: ${myCards}`);
  const hidden = await host.locator('#my-sheet .card--hidden').count();
  assert.equal(hidden, 11, 'на старте все карты закрыты');
  console.log('✓ 11 характеристик, все закрыты на старте');

  // Панель действий подсказывает, что делать.
  const what = (await host.textContent('#action-what')).trim();
  assert.ok(what.length > 3, `панель действий пустая: «${what}»`);
  console.log(`✓ панель действий: ${what}`);

  // ── Раскрытие карты по кнопке ──
  // Сначала закрываем вводную: у ведущего это кнопка «Начать раунд 1».
  const introBtn = host.locator('#action-buttons .btn').first();
  const introLabel = (await introBtn.textContent()).trim();
  await introBtn.click();
  console.log(`✓ вводная закрыта кнопкой «${introLabel}»`);

  // Ведущий ходит первым: ждём подсказку «Ваш ход» и кнопки выбора карты.
  await host.waitForFunction(
    () => /Ваш ход/.test((document.querySelector('#action-what') || {}).textContent || ''),
    null, { timeout: 15000 },
  );
  await host.waitForFunction(
    () => document.querySelectorAll('#action-buttons .btn').length > 0,
    null, { timeout: 15000 },
  );
  const firstBtn = host.locator('#action-buttons .btn').first();
  const btnLabel = (await firstBtn.textContent()).trim();
  await firstBtn.click();

  await host.waitForFunction(
    () => document.querySelectorAll('#my-sheet .card--revealed').length > 0,
    null, { timeout: 10000 },
  );
  const revealed = await host.locator('#my-sheet .card--revealed').count();
  assert.ok(revealed >= 1, 'карта не раскрылась');
  console.log(`✓ раскрытие работает: нажали «${btnLabel}», открыто ${revealed}`);

  // Раскрытая карта должна показывать подсказку 💡 — это ключ к понятности.
  const tipText = (await host.locator('#my-sheet .card--revealed .card__tip').first().textContent()).trim();
  assert.ok(tipText.length > 20, 'у раскрытой карты нет подсказки');
  console.log(`✓ подсказка на карте: ${tipText.slice(0, 60)}…`);

  // Другие игроки видят раскрытую карту в списке лагеря.
  await guest.waitForFunction(
    () => document.querySelectorAll('#seat-list .seat__cards .card--revealed').length > 0,
    null, { timeout: 10000 },
  );
  console.log('✓ раскрытая карта видна сопернику');

  // ── Мобильная вёрстка ──
  const overflow = await guest.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  assert.ok(
    overflow.scrollWidth <= overflow.innerWidth + 2,
    `горизонтальная прокрутка на 360px: ${overflow.scrollWidth} > ${overflow.innerWidth}`,
  );
  console.log(`✓ мобильная вёрстка без переполнения (${overflow.scrollWidth}px ≤ ${overflow.innerWidth}px)`);

  // ── Справка ──
  await host.click('#btn-help-game');
  await host.waitForSelector('#help-drawer.is-open', { timeout: 5000 });
  const phases = await host.locator('#help-body .help-phase').count();
  const faq = await host.locator('#help-body .faq-item').count();
  assert.equal(phases, 6, `фаз в справке: ${phases}`);
  assert.ok(faq >= 10, `вопросов в справке: ${faq}`);
  console.log(`✓ справка: ${phases} фаз, ${faq} вопросов`);
  await host.click('#btn-help-close');

  // ── На экране одновременно виден ровно один экран ──
  // Без этой проверки «все экраны сразу» остаётся незамеченным: классы-то на месте.
  const visibleScreens = await host.evaluate(() =>
    [...document.querySelectorAll('.screen')]
      .filter((n) => !n.hasAttribute('hidden') && getComputedStyle(n).display !== 'none')
      .map((n) => n.id));
  assert.equal(visibleScreens.length, 1, `видимых экранов: ${visibleScreens.length} (${visibleScreens.join(', ')})`);
  assert.equal(visibleScreens[0], 'screen-game', `на экране должна быть игра, а не ${visibleScreens[0]}`);
  console.log('✓ виден ровно один экран: игра');

  // ── Доигрываем партию до финала прямо в браузере ──
  // 2 игрока → 1 место, значит достаточно одного изгнания.
  // Кликаем внутри страницы: панель перерисовывается на каждом снапшоте,
  // и внешние клики Playwright не успевают за этим DOM.
  const clickStep = async (page) => page.evaluate(() => {
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
    const btn = document.querySelector('#action-buttons .btn:not(.btn--danger)');
    if (btn && !btn.disabled) { btn.click(); return 'clicked'; }
    return 'idle';
  });

  let finaleReached = false;
  for (let i = 0; i < 150 && !finaleReached; i += 1) {
    finaleReached = (await host.locator('#screen-finale:not([hidden])').count()) > 0;
    if (finaleReached) break;
    const a = await clickStep(host);
    const b = await clickStep(guest);
    if (a === 'idle' && b === 'idle') await sleep(200);
    else await sleep(60);
  }
  assert.ok(finaleReached, 'партия не дошла до финала в браузере');
  console.log('✓ партия доиграна до финала в браузере');

  const verdict = (await host.textContent('.finale__verdict')).trim();
  assert.ok(verdict.length > 20, `финал не отрисован: «${verdict}»`);
  const score = (await host.textContent('.finale__score')).trim();
  const survivors = await host.locator('.finale__player').count();
  assert.equal(survivors, 1, `персонажей выживших в финале: ${survivors}`);
  console.log(`✓ финал: «${verdict.split('\n')[0].slice(0, 40)}…», оценка ${score}, выживших ${survivors}`);

  const finaleScreens = await host.evaluate(() =>
    [...document.querySelectorAll('.screen')]
      .filter((n) => !n.hasAttribute('hidden') && getComputedStyle(n).display !== 'none')
      .map((n) => n.id));
  assert.deepEqual(finaleScreens, ['screen-finale'], `экраны в финале: ${finaleScreens.join(', ')}`);
  console.log('✓ в финале показан только экран финала');

  await browser.close();
  server.kill();
  await sleep(300);

  if (problems.length) {
    console.error('\n❌ Ошибки в браузере:');
    problems.slice(0, 10).forEach((p) => console.error(`   ${p}`));
    process.exit(1);
  }

  console.log('\n✅ Ошибок в консоли браузера нет');
  console.log('UI BROWSER OK');
}

main().then(() => process.exit(0)).catch((err) => {
  console.error('\nПРОВАЛ UI-ПРОВЕРКИ:', err.message);
  process.exit(1);
});
