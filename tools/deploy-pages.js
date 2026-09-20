'use strict';

/**
 * Публикация статического демо на GitHub Pages.
 *
 * Pages отдаёт ветку как есть, поэтому сборку кладём в ветку `gh-pages`.
 * GitHub Actions для этого не нужен — что важно, если Actions недоступен.
 * Обновление идёт поверх истории ветки, force-push не требуется.
 *
 *   node tools/deploy-pages.js
 */

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIST = path.join(ROOT, 'dist');
const BRANCH = 'gh-pages';

function git(args, cwd = DIST) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function gitSafe(args, cwd = DIST) {
  try {
    return { ok: true, out: git(args, cwd) };
  } catch (err) {
    return { ok: false, out: (err.stderr || err.message || '').toString().trim() };
  }
}

function remoteUrl() {
  // Берём адрес из основного репозитория, чтобы не хранить его в двух местах.
  const url = gitSafe(['remote', 'get-url', 'origin'], ROOT);
  if (!url.ok) throw new Error('У основного репозитория нет remote origin');
  return url.out;
}

function main() {
  // 1. Свежая сборка.
  execFileSync(process.execPath, [path.join(__dirname, 'build-pages.js')], { stdio: 'inherit' });
  if (!fs.existsSync(path.join(DIST, 'index.html'))) throw new Error('Сборка не создала dist/index.html');

  // 2. Готовим репозиторий сборки.
  if (!fs.existsSync(path.join(DIST, '.git'))) git(['init', '-q']);
  const url = remoteUrl();
  if (!gitSafe(['remote', 'get-url', 'origin']).ok) git(['remote', 'add', 'origin', url]);

  // 3. Встаём на текущее состояние ветки, не трогая файлы сборки.
  const fetched = gitSafe(['fetch', 'origin', BRANCH]);
  if (fetched.ok) {
    git(['reset', '--mixed', 'FETCH_HEAD']);
    console.log(`✓ ветка ${BRANCH} подтянута, обновляем поверх истории`);
  } else {
    gitSafe(['checkout', '-q', '-B', BRANCH]);
    console.log(`✓ ветка ${BRANCH} создаётся впервые`);
  }

  // 4. Коммит и отправка.
  git(['add', '-A']);
  const changed = gitSafe(['diff', '--cached', '--quiet']);
  if (changed.ok) {
    console.log('Нечего публиковать: сборка совпадает с тем, что уже на Pages');
    return;
  }
  const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
  git(['-c', 'user.name=Hermes Agent', '-c', 'user.email=agent@hermes.local',
    'commit', '-q', '-m', `Статическая сборка: демо для GitHub Pages (${stamp})`]);
  git(['push', '-q', 'origin', `HEAD:${BRANCH}`]);
  console.log(`✓ опубликовано в ${BRANCH}`);
  console.log('\nGitHub Pages подхватит ветку за минуту-две.');
}

try {
  main();
} catch (err) {
  console.error('Публикация не удалась:', err.message);
  process.exit(1);
}
