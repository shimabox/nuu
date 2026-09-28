// 一覧のページ（client/index.html）を file:// で開いて確かめる。
const { test, expect } = require('@playwright/test');
const { makeDashboards, openAt, nextPoll, readFixture, watchRequests, SAMPLE_UPDATED } = require('./helpers');

let board;
test.beforeEach(() => {
  board = makeDashboards();
});
test.afterEach(() => {
  board.cleanup();
});

const index = () => readFixture('index.data.js');
const titles = (page, group) => page.locator(`.nuu-group[data-group="${group}"] .nuu-row-title`);

// 一覧の行のトークン量を読み終えるまで待つ（行ごとの .usage.js は一覧のデータのあとに読む）。
async function openIndex(page, seconds) {
  await openAt(page, board.indexUrl(), seconds);
  await expect(page.locator('.nuu-row[data-key="sample-shop/2026-09-28-2252-search-filters"] [data-role="row-tokens"]')).toContainText('96 万');
}

test('進行中、中断中、完了の順に分け、それぞれ最終更新が新しい順に並べる', async ({ page }) => {
  await openIndex(page);
  await expect(page.locator('.nuu-group')).toHaveCount(3);
  expect(await page.locator('.nuu-group').evaluateAll((nodes) => nodes.map((n) => n.getAttribute('data-group')))).toEqual(['active', 'paused', 'done']);
  await expect(titles(page, 'active')).toHaveText(['商品検索に価格・在庫・評価の絞り込みを追加する', 'ログインの監査ログを残す', '始めたばかりの作業']);
  await expect(titles(page, 'paused')).toHaveText(['API の利用ガイドを書き直す']);
  await expect(titles(page, 'done')).toHaveText(['バックアップの戻し方を確かめる', 'データベースを新しい版へ移す']);
});

test('知らない status の作業は進行中に並べる', async ({ page }) => {
  const data = index();
  data.items[0].status = 'archived';
  board.writeIndex(data);
  await openIndex(page);
  await expect(titles(page, 'active')).toContainText(['データベースを新しい版へ移す']);
  await expect(page.locator('.nuu-row[data-key="sample-infra/2026-09-26-0930-db-migration"] [data-status="active"]')).toHaveText('進行中');
});

test('進行中で 15 分以上更新がない作業だけを目立たせる', async ({ page }) => {
  await openIndex(page);
  const row = (key) => page.locator(`.nuu-row[data-key="${key}"]`);
  await expect(row('sample-shop/2026-09-28-2252-search-filters')).not.toHaveAttribute('data-stale');
  await expect(row('sample-app/2026-09-28-1905-login-audit')).toHaveAttribute('data-stale', '');
  await expect(row('sample-app/2026-09-28-1905-login-audit').locator('[data-role="stale"]')).toBeVisible();
  await expect(row('sample-docs/2026-09-27-1010-api-guide')).not.toHaveAttribute('data-stale');
  await expect(row('sample-infra/2026-09-26-0930-db-migration')).not.toHaveAttribute('data-stale');
  await expect(row('sample-shop/2026-09-28-2252-search-filters').locator('[data-role="stale"]')).toBeHidden();

  // 時間が進めば、見本の作業も止まっているとみなす。
  await page.clock.runFor(15 * 60 * 1000);
  await expect(row('sample-shop/2026-09-28-2252-search-filters')).toHaveAttribute('data-stale', '');
});

test('作業ごとのトークン量とセッションの ID の先頭 8 文字を出す', async ({ page }) => {
  await openIndex(page);
  const shop = page.locator('.nuu-row[data-key="sample-shop/2026-09-28-2252-search-filters"]');
  await expect(shop.locator('[data-role="row-tokens"]')).toContainText('96 万');
  await expect(shop.locator('[data-role="row-tokens"]')).toContainText('959,950');
  await expect(shop.locator('[data-role="session-short"]')).toHaveText('セッション 7c1e4a92');
  const app = page.locator('.nuu-row[data-key="sample-app/2026-09-28-1905-login-audit"]');
  await expect(app.locator('[data-role="row-tokens"]')).toContainText('33.7 万');
  await expect(app.locator('[data-role="session-short"]')).toHaveText('セッション 0f9d2c41');
  const docs = page.locator('.nuu-row[data-key="sample-docs/2026-09-27-1010-api-guide"]');
  await expect(docs.locator('[data-role="row-tokens"]')).toHaveText('集計前');
  await expect(docs.locator('[data-role="session-short"]')).toHaveCount(0);
});

test('行から作業のページへ移れる。形の違う href はリンクにしない', async ({ page }) => {
  const data = index();
  data.items.push({ project: 'evil', slug: 'x', title: '<b>悪い行</b>', status: 'active', done: 0, total: 0, questions: 0, blockers: 0, startedAt: 1790603523, updatedAt: 1790603523, href: 'javascript:alert(1)' });
  data.items.push({ project: 'evil', slug: 'y', title: '外へのリンク', status: 'active', done: 0, total: 0, questions: 0, blockers: 0, startedAt: 1790603523, updatedAt: 1790603523, href: 'https://example.com/y.html' });
  board.writeIndex(data);
  await openIndex(page);
  await expect(page.locator('a.nuu-row-title[href="sample-shop/2026-09-28-2252-search-filters.html"]')).toHaveCount(1);
  await expect(page.locator('a[href^="javascript" i], a[href^="https:"]')).toHaveCount(0);
  await expect(page.locator('.nuu-row[data-key="evil/x"] .nuu-row-title')).toHaveText('<b>悪い行</b>');
  await page.locator('a.nuu-row-title[href="sample-shop/2026-09-28-2252-search-filters.html"]').click();
  await expect(page.locator('[data-page="task"] .nuu-title')).toHaveText('商品検索に価格・在庫・評価の絞り込みを追加する');
});

test('一覧のデータを書き換えると、再読み込みせずに行が変わる', async ({ page }) => {
  await openIndex(page);
  await page.evaluate(() => { window.__marker = 'same page'; });
  const data = index();
  data.items = data.items.filter((item) => item.project !== 'sample-min');
  data.items.find((item) => item.project === 'sample-docs').status = 'active';
  data.items.find((item) => item.project === 'sample-docs').updatedAt = SAMPLE_UPDATED + 30;
  board.writeIndex(data);
  await nextPoll(page);
  await expect(titles(page, 'active')).toHaveText(['API の利用ガイドを書き直す', '商品検索に価格・在庫・評価の絞り込みを追加する', 'ログインの監査ログを残す']);
  await expect(page.locator('.nuu-group[data-group="paused"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__marker)).toBe('same page');
});

test('一覧のデータも 3 回続けて読めなかったときだけ警告を出す', async ({ page }) => {
  await openIndex(page);
  board.remove('index.data.js');
  await nextPoll(page);
  await nextPoll(page);
  await expect(page.locator('[data-role="load-warning"]')).toBeHidden();
  await nextPoll(page);
  await expect(page.locator('[data-role="load-warning"]')).toContainText('index.data.js');
  await expect(page.locator('.nuu-row')).toHaveCount(6);
});

test('好みを変えると一覧の見た目も変わる', async ({ page }) => {
  await openIndex(page);
  board.writePrefs({ schema: 1, theme: 'light', density: 'dense', accent: '#0EA5E9', taskView: 'list' });
  await page.clock.runFor(10_000);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  await expect(page.locator('html')).toHaveAttribute('data-density', 'dense');
});

test('favicon があり、file: と data: 以外の URL を読み込まない', async ({ page }) => {
  const { requests, external } = await watchRequests(page);
  await openIndex(page);
  await expect(page.locator('link[rel="icon"]')).toHaveAttribute('href', /^data:image\/svg\+xml,/);
  expect(requests.filter((url) => !/^(file|data):/.test(url))).toEqual([]);
  expect(external).toEqual([]);
});
