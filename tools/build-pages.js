'use strict';

/**
 * Сборка статической версии для GitHub Pages.
 *
 * GitHub Pages умеет отдавать только файлы, поэтому сервер там жить не может.
 * Собираем вариант, где тот же движок и тот же интерфейс работают в браузере,
 * а соперниками выступают боты. Логика не дублируется: берётся ровно тот же
 * код из server/game, меняется только транспорт (local-client вместо сокета).
 *
 *   node tools/build-pages.js
 */

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const DATA_DIR = path.join(ROOT, 'server', 'game', 'data');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else fs.copyFileSync(src, dst);
  }
}

/** Все колоды одним объектом: в браузере файловой системы нет. */
function buildDeckData() {
  const decks = {};
  const files = fs.readdirSync(DATA_DIR).filter((f) => f.endsWith('.json'));
  for (const file of files) {
    const raw = fs.readFileSync(path.join(DATA_DIR, file), 'utf8').replace(/^\uFEFF/, '');
    decks[file.replace(/\.json$/, '')] = JSON.parse(raw);
  }
  return decks;
}

/** В статике сокет не нужен: его место занимает локальный клиент. */
function patchHtml(html) {
  const replacements = [
    ['<script src="/socket.io/socket.io.js"></script>',
      '<script src="decks.data.js"></script>\n<script src="engine.js"></script>'],
    ['<script src="js/socket-client.js"></script>',
      '<script src="js/local-client.js"></script>'],
  ];
  let out = html;
  for (const [from, to] of replacements) {
    if (!out.includes(from)) throw new Error(`В index.html не найдено: ${from}`);
    out = out.replace(from, to);
  }
  // Абсолютные пути на Pages ломаются: сайт живёт в подкаталоге /<репозиторий>/.
  if (/src="\//.test(out) || /href="\//.test(out)) {
    throw new Error('В index.html остались абсолютные пути — на GitHub Pages они не разрешатся');
  }
  return out;
}

async function main() {
  fs.rmSync(DIST, { recursive: true, force: true });
  fs.mkdirSync(DIST, { recursive: true });

  const decks = buildDeckData();
  fs.writeFileSync(path.join(DIST, 'decks.data.js'),
    `window.__BUNKER_DECKS__=${JSON.stringify(decks)};\n`);
  console.log(`✓ данные колод: ${Object.keys(decks).length} файлов`);

  await esbuild.build({
    entryPoints: [path.join(ROOT, 'static', 'engine-entry.js')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    target: 'es2020',
    // fs и path нужны только в Node; в браузере до них дело не доходит.
    external: ['fs', 'path'],
    outfile: path.join(DIST, 'engine.js'),
    logLevel: 'warning',
  });
  console.log(`✓ движок собран: ${Math.round(fs.statSync(path.join(DIST, 'engine.js')).size / 1024)} КБ`);

  copyDir(path.join(ROOT, 'public'), DIST);
  console.log('✓ статика скопирована');

  const indexPath = path.join(DIST, 'index.html');
  fs.writeFileSync(indexPath, patchHtml(fs.readFileSync(indexPath, 'utf8')));
  console.log('✓ index.html переключён на локальный режим');

  // Пустой файл: без него GitHub Pages пытается прогонять Jekyll и спотыкается.
  fs.writeFileSync(path.join(DIST, '.nojekyll'), '');

  const total = fs.readdirSync(DIST, { recursive: true })
    .map((f) => path.join(DIST, f))
    .filter((f) => fs.statSync(f).isFile())
    .reduce((sum, f) => sum + fs.statSync(f).size, 0);
  console.log(`\nГотово: dist/ — ${Math.round(total / 1024 / 1024 * 10) / 10} МБ`);
}

main().catch((err) => {
  console.error('Сборка не удалась:', err.message);
  process.exit(1);
});
