// ブラウザのテストの土台。一時ディレクトリに ~/.claude/nuu/dashboards/ と同じ形を作り、file:// で開く。
// _client は install.sh と同じく、リポジトリの client/ へのリンクにする。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { pathToFileURL } = require('url');
const { expect } = require('@playwright/test');

const ROOT = path.resolve(__dirname, '..', '..');
const CLIENT = path.join(ROOT, 'client');
const FIXTURES = path.join(ROOT, 'tests', 'fixtures');
const VALID = path.join(FIXTURES, 'valid');

// fixtures の見本の作業。パネル 7 種がすべて入っている。
const SAMPLE = 'sample-shop/2026-09-28-2252-search-filters';
// 見本の作業の最終更新（updatedAt）。時計はこの少しあとに合わせる。
const SAMPLE_UPDATED = 1790607123;

const DATA_CALLBACK = 'window.nuuDashboardData(';
const PREFS_CALLBACK = 'window.nuuDashboardPrefs(';

function wrap(callback, value) {
  return `${callback}\n${JSON.stringify(value, null, 2)}\n);\n`;
}

// fixtures のデータファイル（1 行目の呼び出しと最終行の ); の間が JSON）を読む。
function readFixture(relative) {
  const lines = fs.readFileSync(path.join(VALID, relative), 'utf8').trimEnd().split('\n');
  return JSON.parse(lines.slice(1, -1).join('\n'));
}

function copyTree(from, to) {
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const source = path.join(from, entry.name);
    const target = path.join(to, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(target, { recursive: true });
      copyTree(source, target);
    } else {
      fs.copyFileSync(source, target);
    }
  }
}

// 書き込み途中のファイルを読ませないよう、一時ファイルに書いてから置き換える。
function writeAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, content);
  fs.renameSync(temporary, file);
}

function makeDashboards({ fixtures = true, prefs = true } = {}) {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nuu-client-')));
  const dir = path.join(base, 'dashboards');
  fs.mkdirSync(dir);
  fs.symlinkSync(CLIENT, path.join(dir, '_client'));
  fs.copyFileSync(path.join(CLIENT, 'index.html'), path.join(dir, 'index.html'));

  const board = {
    dir,
    file: (relative) => path.join(dir, relative),
    url: (relative) => pathToFileURL(path.join(dir, relative)).href,
    taskUrl: (key = SAMPLE) => board.url(`${key}.html`),
    indexUrl: () => board.url('index.html'),
    write: (relative, content) => writeAtomic(path.join(dir, relative), content),
    remove: (relative) => fs.rmSync(path.join(dir, relative), { force: true }),
    // 作業のデータを書く。スタブがなければ置く（本番ではフックが置く）。
    writeTask: (key, data) => {
      board.write(`${key}.data.js`, wrap(DATA_CALLBACK, data));
      const stub = path.join(dir, `${key}.html`);
      if (!fs.existsSync(stub)) fs.copyFileSync(path.join(CLIENT, 'task.html'), stub);
    },
    writeIndex: (data) => board.write('index.data.js', wrap(DATA_CALLBACK, data)),
    writePrefs: (value) => board.write('prefs.data.js', wrap(PREFS_CALLBACK, value)),
    writeUsage: (key, usage) => board.write(`${key}.usage.js`,
      `// dashboard-usage.py が書く。手で編集しない。\n(window.NUU_USAGE = window.NUU_USAGE || {})[${JSON.stringify(key)}] = ${JSON.stringify(usage)};\n`),
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };

  if (fixtures) {
    copyTree(VALID, dir);
    if (!prefs) board.remove('prefs.data.js');
    for (const project of fs.readdirSync(dir, { withFileTypes: true })) {
      if (!project.isDirectory() || project.name === '_client') continue;
      for (const name of fs.readdirSync(path.join(dir, project.name))) {
        if (name.endsWith('.data.js')) {
          fs.copyFileSync(path.join(CLIENT, 'task.html'), path.join(dir, project.name, name.replace(/\.data\.js$/, '.html')));
        }
      }
    }
  }
  return board;
}

const LOAD_COUNTERS = ['data-loads', 'data-usage-loads', 'data-prefs-loads'];

async function counters(page) {
  return page.locator('[data-page]').evaluate((root, names) =>
    Object.fromEntries(names.map((name) => [name, Number(root.getAttribute(name) || 0)])), LOAD_COUNTERS);
}

// 時計を止めた状態で開き、最初の読み込み（データ、トークン量、好み）が終わるまで待つ。
// setInterval などは page.clock.runFor で進める。
async function openAt(page, url, seconds = SAMPLE_UPDATED + 60) {
  // install の直後から時計は進むので、少し前に合わせてから止める（同じ時刻で止めると過去に戻せず失敗する）。
  await page.clock.install({ time: new Date((seconds - 1) * 1000) });
  await page.clock.pauseAt(new Date(seconds * 1000));
  await page.goto(url);
  const isTask = await page.locator('[data-page="task"]').count();
  await expect.poll(async () => {
    const c = await counters(page);
    return c['data-loads'] >= 1 && c['data-prefs-loads'] >= 1 && (!isTask || c['data-usage-loads'] >= 1);
  }).toBe(true);
}

// 10 秒ごとの読み直しを 1 回進め、データ、トークン量、好みの読み込みが終わるまで待つ。
async function nextPoll(page) {
  const before = await counters(page);
  await page.clock.runFor(10_000);
  const isTask = await page.locator('[data-page="task"]').count();
  await expect.poll(async () => {
    const c = await counters(page);
    return c['data-loads'] > before['data-loads'] && c['data-prefs-loads'] > before['data-prefs-loads']
      && (!isTask || c['data-usage-loads'] > before['data-usage-loads']);
  }).toBe(true);
}

// ページが読み込んだ URL と、外（http: と https:）へ出ようとした URL を集める。外への読み込みは止める。
async function watchRequests(page) {
  const requests = [];
  const external = [];
  page.on('request', (request) => requests.push(request.url()));
  await page.route(/^https?:/, (route) => {
    external.push(route.request().url());
    return route.abort();
  });
  return { requests, external };
}

module.exports = {
  watchRequests,
  ROOT,
  CLIENT,
  FIXTURES,
  SAMPLE,
  SAMPLE_UPDATED,
  DATA_CALLBACK,
  PREFS_CALLBACK,
  wrap,
  readFixture,
  makeDashboards,
  openAt,
  nextPoll,
};
