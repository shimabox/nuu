// fixtures の架空の作業から画面の画像を撮る。NUU_SHOTS_DIR を渡したときだけ動く（通常のテストでは飛ばす）。
// 例: NUU_SHOTS_DIR=/tmp/shots npx playwright test screenshots --project=chromium
const path = require('path');
const fs = require('fs');
const { test, expect } = require('@playwright/test');
const { makeDashboards, openAt, SAMPLE } = require('./helpers');

const OUT = process.env.NUU_SHOTS_DIR;
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
