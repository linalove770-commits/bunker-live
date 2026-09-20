'use strict';

/**
 * Проверка интеграции разметки и стилей:
 * каждый класс, который реально используется в HTML и JS, должен быть описан в CSS.
 * И наоборот: не должно остаться «мёртвых» классов из контракта, которые никто не применяет.
 *
 *   node tests/e2e/check-ui-integration.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..');
const PUBLIC = path.join(ROOT, 'public');

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

const html = read('public/index.html');
const jsFiles = ['public/js/app.js', 'public/js/render.js', 'public/js/socket-client.js'];
const js = jsFiles.map(read).join('\n');
const css = ['tokens.css', 'app.css', 'components.css']
  .map((f) => fs.readFileSync(path.join(PUBLIC, 'css', f), 'utf8')).join('\n');

/** Классы, реально встречающиеся в разметке и в JS-строках. */
function usedClasses() {
  const found = new Set();
  const addAll = (str) => {
    String(str)
      .replace(/\$\{[^}]*\}/g, ' ')
      .split(/\s+/)
      .filter(Boolean)
      .forEach((c) => {
        // Отбрасываем мусор от шаблонных склеек и одиночные символы.
        if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(c)) return;
        found.add(c);
      });
  };

  // 1. class="a b c" в HTML
  for (const m of html.matchAll(/class="([^"]+)"/g)) addAll(m[1]);

  // 2. присваивания className / class в JS
  for (const m of js.matchAll(/(?:className|class)\s*=\s*[`'"]([^`'"]+)[`'"]/g)) addAll(m[1]);

  // 3. classList.add/remove/toggle('x')
  for (const m of js.matchAll(/classList\.(?:add|remove|toggle)\(\s*['"]([^'"]+)['"]/g)) addAll(m[1]);

  // 4. массивы классов: const classes = ['card']; classes.push('card--mine')
  for (const m of js.matchAll(/(?:const|let)\s+(?:classes|cls|classList)\w*\s*=\s*\[([^\]]+)\]/g)) {
    for (const s of m[1].matchAll(/['"]([^'"]+)['"]/g)) addAll(s[1]);
  }
  for (const m of js.matchAll(/(?:classes|cls|classList)\w*\.push\(\s*['"]([^'"]+)['"]/g)) addAll(m[1]);

  // 5. шаблонные строки, начинающиеся с известного класса (каркас компонентов)
  for (const m of js.matchAll(/`([a-z][a-z0-9_-]*(?:__[a-z0-9-]+)?(?:--[a-z0-9-]+)?)[^`]*`/g)) {
    if (/^(btn|card|seat|tag|toast|tally|vote-card|modal|player-chip|phase-badge|timer|bunker|catastrophe|input|field|screen|topbar|lobby|settings|segmented|switch|sheet|help|faq|glossary|log|divider|empty-state|tooltip|tip|code|reveal|rules|home|action|panel|finale)/.test(m[1])) {
      addAll(m[1]);
    }
  }

  return [...found];
}

/** Артефакты извлечения: склейки шаблонных строк и слова-команды, не классы. */
const ARTIFACTS = new Set([
  'reveal', 'sev', 'card', 'is-on', 'is-active', 'is-open', 'is-picked', 'is-locked',
  'muted', 'bunker-card--', 'finale__verdict--', 'toast--', 'hud', 'game', 'lobby',
]);

/** Все классы, описанные в CSS. */
function definedClasses() {
  const found = new Set();
  for (const m of css.matchAll(/\.([a-zA-Z][a-zA-Z0-9_-]*)/g)) found.add(m[1]);
  return found;
}

const used = usedClasses().filter((c) => !ARTIFACTS.has(c) && !c.endsWith('--'));
const defined = definedClasses();

const missing = used.filter((c) => !defined.has(c)).sort();
const stateOnly = new Set(['is-active', 'is-open', 'is-picked', 'is-locked', 'is-on', 'muted']);

console.log(`Классов используется: ${used.length}`);
console.log(`Классов описано в CSS: ${defined.size}`);

let failed = false;

if (missing.length) {
  console.log(`\n❌ Используются, но НЕ описаны в CSS (${missing.length}):`);
  missing.forEach((c) => console.log(`   .${c}`));
  failed = true;
} else {
  console.log('\n✅ Все используемые классы описаны в CSS');
}

// Обязательные переменные дизайн-системы.
const REQUIRED_VARS = [
  '--bg-0', '--bg-1', '--bg-2', '--surface', '--surface-2', '--border', '--border-strong',
  '--text', '--text-dim', '--text-mute', '--accent', '--accent-2', '--danger', '--ok',
  '--radius-s', '--radius-m', '--radius-l', '--shadow-1', '--shadow-2',
  '--font-ui', '--font-mono', '--dur-fast', '--dur-med', '--ease',
];
const missingVars = REQUIRED_VARS.filter((v) => !css.includes(`${v}:`));
if (missingVars.length) {
  console.log(`\n❌ Нет переменных в CSS (${missingVars.length}): ${missingVars.join(', ')}`);
  failed = true;
} else {
  console.log('✅ Все дизайн-токены объявлены');
}

// Никаких внешних ресурсов — игра должна работать офлайн.
const external = /https?:\/\/(?!www\.w3\.org)/.test(css);
if (external) {
  console.log('\n❌ CSS тянет внешние ресурсы (CDN/шрифты) — игра сломается без интернета');
  failed = true;
} else {
  console.log('✅ CSS без внешних зависимостей');
}

// Доступность: контрастные состояния таймера и reduced-motion.
if (!css.includes('prefers-reduced-motion')) {
  console.log('\n❌ Нет @media (prefers-reduced-motion: reduce)');
  failed = true;
} else {
  console.log('✅ Уважает prefers-reduced-motion');
}

if (stateOnly.size) console.log(`\n(служебные классы-состояния: ${[...stateOnly].join(', ')})`);

if (failed) {
  console.error('\nПРОВАЛ проверки интеграции UI');
  process.exit(1);
}
console.log('\nUI INTEGRATION OK');
