// fixtures の架空の作業から画面の画像を撮る。通常のテストでは飛ばす。
// - 好みの組み合わせごとの確認用: NUU_SHOTS_DIR=/tmp/shots npx playwright test screenshots --project=chromium
// - README と説明ページの画像（docs/images/ の 4 枚）: NUU_DOCS_IMAGES=1 npx playwright test screenshots --project=chromium
const path = require('path');
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { makeDashboards, openAt, SAMPLE, ROOT } = require('./helpers');

const OUT = process.env.NUU_SHOTS_DIR;
const DOCS_IMAGES = path.join(ROOT, 'docs', 'images');
const DOCS_PREFS = { schema: 1, theme: 'dark', density: 'airy', accent: '#3CCFBC', taskView: 'kanban' };

// 要素の上下に余白を付けた、ページの幅いっぱいの範囲。
async function band(page, top, bottom, margin = 24) {
  const box = await page.evaluate(([a, b]) => {
    const first = document.querySelector(a).getBoundingClientRect();
    const last = document.querySelector(b).getBoundingClientRect();
    return { top: first.top + window.scrollY, bottom: last.bottom + window.scrollY, width: document.documentElement.clientWidth };
  }, [top, bottom]);
  const y = Math.max(0, Math.floor(box.top - margin));
  return { x: 0, y, width: box.width, height: Math.ceil(box.bottom + margin) - y };
}

// ページの上端から、last の欄の下に余白を付けたところまで。余白は next の欄の上端を越えない。
async function topUntil(page, last, next, margin = 24) {
  const box = await page.evaluate(([a, b]) => {
    const end = document.querySelector(a).getBoundingClientRect();
    const following = document.querySelector(b).getBoundingClientRect();
    return { bottom: end.bottom + window.scrollY, next: following.top + window.scrollY, width: document.documentElement.clientWidth };
  }, [last, next]);
  return { x: 0, y: 0, width: box.width, height: Math.ceil(Math.min(box.bottom + margin, box.next)) };
}

test.describe('説明ページの画像', () => {
  test.skip(!process.env.NUU_DOCS_IMAGES, 'NUU_DOCS_IMAGES を渡したときだけ docs/images/ に撮る');
  test.skip(({ browserName }) => browserName !== 'chromium', '画像は Chromium で撮る');

  test('作業ごとのページ、スマホ、一覧、セッションの欄', async ({ page }) => {
    const board = makeDashboards();
    try {
      board.writePrefs(DOCS_PREFS);

      // 作業ごとのページ: 上端から手順のカンバンの終わりまで。次の欄（作業の様子）の見出しは入れない。
      await page.setViewportSize({ width: 1280, height: 900 });
      await openAt(page, board.taskUrl(SAMPLE));
      await expect(page.locator('.nuu-panel')).toHaveCount(7);
      await expect(page.locator('[data-role="usage-short"]')).toBeVisible();
      await page.screenshot({ path: path.join(DOCS_IMAGES, 'dashboard-desktop.png'), fullPage: true,
        clip: await topUntil(page, '[data-slot="tasks"]', '[data-slot="panels"]') });

      // セッションの欄だけを切り出す。
      await page.screenshot({ path: path.join(DOCS_IMAGES, 'dashboard-session.png'), fullPage: true,
        clip: await band(page, '#session', '#session') });

      // スマホの幅: 上端から 1000px。上部の要約と PR / MR の欄が収まらなければ、収まるところまで伸ばす。
      await page.setViewportSize({ width: 390, height: 844 });
      const mobile = await topUntil(page, '[data-slot="reviews"]', '[data-slot="attention"]');
      await page.screenshot({ path: path.join(DOCS_IMAGES, 'dashboard-mobile.png'), fullPage: true,
        clip: { ...mobile, height: Math.max(1000, mobile.height) } });

      // 一覧: ページ全体。
      await page.setViewportSize({ width: 1280, height: 600 });
      await page.goto(board.indexUrl());
      await expect(page.locator('.nuu-row')).toHaveCount(6);
      await expect(page.locator('[data-role="session-short"]').first()).toBeVisible();
      await page.screenshot({ path: path.join(DOCS_IMAGES, 'index-desktop.png'), fullPage: true });
    } finally {
      board.cleanup();
    }
  });
});
const COMBOS = [
  { name: 'dark-airy', prefs: { schema: 1, theme: 'dark', density: 'airy', accent: '#3CCFBC', taskView: 'kanban' } },
  { name: 'light-dense', prefs: { schema: 1, theme: 'light', density: 'dense', accent: '#0EA5E9', taskView: 'kanban' } },
];

test.describe('画面の画像', () => {
  test.skip(!OUT, 'NUU_SHOTS_DIR を渡したときだけ撮る');
  test.skip(({ browserName }) => browserName !== 'chromium', '画像は Chromium で撮る');

  for (const combo of COMBOS) {
    test(`作業のページと一覧（${combo.name}）`, async ({ page }) => {
      fs.mkdirSync(OUT, { recursive: true });
      const board = makeDashboards();
      try {
        board.writePrefs(combo.prefs);

        await page.setViewportSize({ width: 1280, height: 900 });
        await openAt(page, board.taskUrl(SAMPLE));
        await expect(page.locator('.nuu-panel')).toHaveCount(7);
        await expect(page.locator('[data-role="usage-short"]')).toBeVisible();
        await page.screenshot({ path: path.join(OUT, `task-desktop-${combo.name}.png`), fullPage: true });

        await page.setViewportSize({ width: 390, height: 844 });
        await page.screenshot({ path: path.join(OUT, `task-mobile-${combo.name}.png`), fullPage: true });

        await page.setViewportSize({ width: 1280, height: 900 });
        await page.goto(board.indexUrl());
        await expect(page.locator('.nuu-row')).toHaveCount(6);
        await expect(page.locator('[data-role="session-short"]').first()).toBeVisible();
        await page.screenshot({ path: path.join(OUT, `index-desktop-${combo.name}.png`), fullPage: true });
      } finally {
        board.cleanup();
      }
    });
  }
});
