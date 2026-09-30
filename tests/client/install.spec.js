// install.sh で入れたときの通しの確認。一時 HOME にリポジトリの複製を入れ、フックが置いたスタブを file:// で開く。
// リポジトリの client/nuu.js を書き換えると、前に作った作業のページも、開き直すだけで新しい動きになる（U2 のリンク）。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { pathToFileURL } = require('url');
const { test, expect } = require('@playwright/test');
const { ROOT, FIXTURES, SAMPLE, readFixture } = require('./helpers');

const VALID = path.join(FIXTURES, 'valid');
const PARTS = ['agents', 'client', 'hooks', 'install.sh', 'uninstall.sh', 'claude-instructions.md'];

function run(command, args, options) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')}: ${result.status}\n${result.stdout}\n${result.stderr}`);
  return result;
}

function installed() {
  const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'nuu-install-')));
  const repo = path.join(base, 'repo');
  const home = path.join(base, 'home');
  fs.mkdirSync(repo);
  fs.mkdirSync(home);
  for (const part of PARTS) fs.cpSync(path.join(ROOT, part), path.join(repo, part), { recursive: true });
  const env = { ...process.env, HOME: home };
  run('bash', [path.join(repo, 'install.sh'), '--no-claude-md'], { env });
  const dashboards = path.join(home, '.claude', 'nuu', 'dashboards');
  return {
    repo,
    dashboards,
    // エージェントがデータを書いたあとに動くフックを、同じ入力で呼ぶ。
    writeTask(relative) {
      const target = path.join(dashboards, `${relative}.data.js`);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.copyFileSync(path.join(VALID, `${relative}.data.js`), target);
      const input = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: target } });
      run('python3', [path.join(home, '.claude', 'hooks', 'dashboard-page.py')], { env, input });
    },
    url: (relative) => pathToFileURL(path.join(dashboards, relative)).href,
    cleanup: () => fs.rmSync(base, { recursive: true, force: true }),
  };
}

test('install.sh で入れると、フックが置いたスタブがリンク越しに固定クライアントを読む', async ({ page }) => {
  const nuu = installed();
  try {
    nuu.writeTask(SAMPLE);
    expect(fs.lstatSync(path.join(nuu.dashboards, '_client')).isSymbolicLink()).toBe(true);
    await page.goto(nuu.url(`${SAMPLE}.html`));
    await expect(page.locator('.nuu-title')).toHaveText(readFixture(`${SAMPLE}.data.js`).title);
    await expect(page.locator('.nuu-panel')).toHaveCount(7);

    await page.goto(nuu.url('index.html'));
    await expect(page.locator('.nuu-row')).toHaveCount(1);
  } finally {
    nuu.cleanup();
  }
});

test('client/nuu.js を書き換えると、前に作った作業のページも開き直すだけで新しい動きになる', async ({ context }) => {
  const nuu = installed();
  try {
    nuu.writeTask(SAMPLE);
    const url = nuu.url(`${SAMPLE}.html`);
    const before = await context.newPage();
    await before.goto(url);
    await expect(before.locator('.nuu-title')).toBeVisible();
    expect(await before.locator('html').getAttribute('data-nuu-next')).toBeNull();
    await before.close();

    // リポジトリの client/nuu.js だけを書き換える（git pull で届く変更の代わり）。スタブとデータには触れない。
    fs.appendFileSync(path.join(nuu.repo, 'client', 'nuu.js'), "\ndocument.documentElement.setAttribute('data-nuu-next', 'yes');\n");
    const after = await context.newPage();
    await after.goto(url);
    await expect(after.locator('html')).toHaveAttribute('data-nuu-next', 'yes');
    await expect(after.locator('.nuu-title')).toBeVisible();
  } finally {
    nuu.cleanup();
  }
});
