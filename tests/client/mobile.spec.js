// 狭い幅（360px）で、作業のページ（パネル 7 種を含む）と一覧が横にはみ出さず、押しやすいかを確かめる。
const { test, expect } = require('@playwright/test');
const { makeDashboards, openAt, SAMPLE } = require('./helpers');

let board;
test.beforeEach(async ({ page }) => {
  board = makeDashboards();
  await page.setViewportSize({ width: 360, height: 780 });
});
test.afterEach(() => {
  board.cleanup();
});

// ページ全体と、見えている要素のどれも、画面の右端を越えない。
async function expectNoOverflow(page) {
  const result = await page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const over = [];
    for (const node of document.querySelectorAll('.nuu-shell *')) {
      const rect = node.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;
      if (rect.right > width + 0.5 || rect.left < -0.5) over.push(`${node.tagName.toLowerCase()}.${node.getAttribute('class') || ''} ${Math.round(rect.left)}..${Math.round(rect.right)}`);
    }
    return { scrollWidth: document.documentElement.scrollWidth, width, over: over.slice(0, 10) };
  });
  expect(result.over).toEqual([]);
  expect(result.scrollWidth).toBeLessThanOrEqual(360);
}

// 要素の高さ。ブラウザによっては小数点以下の丸めで 44px がわずかに小さく出る（例: 43.99993896484375）ので、0.01px 未満の差は許す。
async function tapHeight(node) {
  return (await node.boundingBox()).height + 0.01;
}

for (const density of ['airy', 'dense']) {
  test(`作業のページは幅 360px で横にはみ出さない（${density}）`, async ({ page }) => {
    board.writePrefs({ schema: 1, theme: 'dark', density, accent: '#3CCFBC', taskView: 'kanban' });
    await openAt(page, board.taskUrl(SAMPLE));
    await expect(page.locator('.nuu-panel')).toHaveCount(7);
    await expect(page.locator('[data-role="usage-short"]')).toBeVisible();
    await expect(page.locator('[data-role="usage-fresh-short"]')).toBeVisible();
    await expect(page.locator('[data-role="token-note"]')).toBeVisible();
    await expect(page.locator('.nuu-review').first()).toBeVisible();
    await expectNoOverflow(page);
  });

  test(`一覧は幅 360px で横にはみ出さない（${density}）`, async ({ page }) => {
    board.writePrefs({ schema: 1, theme: 'light', density, accent: '#3CCFBC', taskView: 'kanban' });
    await openAt(page, board.indexUrl());
    await expect(page.locator('.nuu-row [data-role="session-short"]').first()).toBeVisible();
    await expect(page.locator('.nuu-review-more')).toBeVisible();
    await expect(page.locator('[data-role="token-note"]')).toBeVisible();
    await expectNoOverflow(page);
  });
}

test('長い名前や長い値も横にはみ出さない（手順は一覧の表示）', async ({ page }) => {
  const long = 'とても長い名前'.repeat(12);
  board.writePrefs({ schema: 1, theme: 'dark', density: 'airy', accent: '#3CCFBC', taskView: 'list' });
  board.writeTask('sample-long/2026-09-28-0000-long', {
    schema: 1, project: 'sample-long', slug: '2026-09-28-0000-long', title: long, summary: long,
    status: 'active', startedAt: 1790600000, updatedAt: 1790600000,
    tasks: [{ id: 1, title: long, status: 'doing', note: 'x'.repeat(300) }],
    questions: [{ id: 1, question: long, default: long, proceeding: true, askedAt: 1790600000 }],
    blockers: [{ what: long, why: long, since: 1790600000, next: long }],
    artifacts: [{ name: long, ref: `/very/long/path/${'segment/'.repeat(20)}file.ts`, at: 1790600000 }],
    reviews: [
      { provider: 'gitlab', kind: 'mr', number: 123456789, title: long, url: `https://gitlab.example.com/${'group/'.repeat(20)}app/-/merge_requests/123456789`, state: 'merged', at: 1790600000 },
      { provider: 'github', kind: 'pr', number: 7, title: long, url: 'http://github.com/example/app/pull/7', state: 'draft', at: 1790599000 },
    ],
    panels: [
      { id: 't', type: 'table', title: long, columns: [{ label: long }, { label: 'b' }, { label: 'c' }], rows: [[long, 12345678901, { text: long, state: 'blocked' }]] },
      { id: 'k', type: 'keyvalue', title: 'k', items: [{ label: long, value: long, state: 'failed' }] },
      { id: 'f', type: 'flow', title: 'f', steps: Array.from({ length: 12 }, (_, i) => ({ label: `段階 ${i}`, state: 'todo', note: long })) },
    ],
  });
  board.writeUsage('sample-long/2026-09-28-0000-long', { sessionId: 's'.repeat(80), cwd: `/work/${'d'.repeat(120)}`, totals: { total: 123456789012 } });
  await openAt(page, board.taskUrl('sample-long/2026-09-28-0000-long'));
  await expect(page.locator('.nuu-tasklist')).toBeVisible();
  await expect(page.locator('.nuu-review')).toHaveCount(2);
  await expectNoOverflow(page);
});

test('狭い画面ではカンバンの列を縦に積み、表を 1 行 1 枚のカードに、流れを縦にする', async ({ page }) => {
  await openAt(page, board.taskUrl(SAMPLE));
  const columns = await page.locator('.nuu-column').evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().left)));
  expect(new Set(columns).size).toBe(1);
  // カードのない列は見出しと件数だけにする。
  await expect(page.locator('.nuu-column.is-empty .nuu-column-empty')).toHaveCount(0);
  await expect(page.locator('.nuu-table thead')).toBeHidden();
  const cell = page.locator('.nuu-table tbody td').nth(1);
  expect(await cell.evaluate((node) => getComputedStyle(node, '::before').content)).toContain('API');
  const steps = await page.locator('.nuu-step').evaluateAll((nodes) => nodes.map((n) => Math.round(n.getBoundingClientRect().left)));
  expect(new Set(steps).size).toBe(1);
  // 質問と止まっているものを、手順とパネルより上に置く。
  const top = async (selector) => page.locator(selector).first().evaluate((node) => node.getBoundingClientRect().top);
  expect(await top('.nuu-questions')).toBeLessThan(await top('[data-slot="tasks"]'));
  expect(await top('.nuu-blockers')).toBeLessThan(await top('[data-slot="tasks"]'));
});

test('リンクとボタンは指で押しやすい高さ（44px 以上）にし、本文の文字は 14px 以上にする', async ({ page }) => {
  board.writePrefs({ schema: 1, theme: 'dark', density: 'dense', accent: '#3CCFBC', taskView: 'kanban' });
  await openAt(page, board.taskUrl(SAMPLE));
  for (const selector of ['.nuu-back', '[data-role="token-total"]', 'a.nuu-review-main', '.nuu-button', 'details[data-key="answered"] > summary']) {
    for (const node of await page.locator(selector).all()) {
      expect(await tapHeight(node), selector).toBeGreaterThanOrEqual(44);
    }
  }
  expect(await page.evaluate(() => parseFloat(getComputedStyle(document.body).fontSize))).toBeGreaterThanOrEqual(14);

  await page.goto(board.indexUrl());
  await expect(page.locator('a.nuu-row-title').first()).toBeVisible();
  for (const node of await page.locator('a.nuu-row-title').all()) {
    expect(await tapHeight(node)).toBeGreaterThanOrEqual(44);
  }
});
