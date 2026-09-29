// 作業ごとのページ（client/task.html をスタブとして置いたもの）を file:// で開いて確かめる。
const { test, expect } = require('@playwright/test');
const { makeDashboards, openAt, nextPoll, readFixture, watchRequests, SAMPLE, SAMPLE_UPDATED } = require('./helpers');

const PANEL_TYPES = ['progress', 'grid', 'table', 'keyvalue', 'text', 'trend', 'flow'];
const SESSION_ID = '7c1e4a92-3b5d-4f60-9a1e-2d8c5b7f0e13';

let board;
test.beforeEach(() => {
  board = makeDashboards();
});
test.afterEach(() => {
  board.cleanup();
});

const sample = () => readFixture(`${SAMPLE}.data.js`);
const root = (page) => page.locator('[data-page="task"]');

function usage(overrides = {}) {
  const part = (total) => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total });
  return Object.assign({
    since: 1790603523,
    updatedAt: SAMPLE_UPDATED,
    sessionId: SESSION_ID,
    cwd: '/work/sample-shop',
    totals: { input: 18420, output: 64310, cacheRead: 812400, cacheWrite: 64820, total: 959950 },
    byCategory: { main: part(691400), subagents: part(198500), dashboard: part(70050) },
    byModel: { 'claude-sample': 959950 },
  }, overrides);
}

test.describe('描画', () => {
  test('見本のデータから、要約、質問、止まっているもの、手順、パネル 7 種、成果物を描く', async ({ page }) => {
    await openAt(page, board.taskUrl());
    const data = sample();
    await expect(page.locator('.nuu-title')).toHaveText(data.title);
    await expect(page).toHaveTitle(`${data.title} — nuu`);
    await expect(page.locator('.nuu-summary')).toHaveText(data.summary);
    await expect(page.locator('.nuu-stats')).toContainText('3 / 8');
    await expect(page.locator('.nuu-stats [data-status="active"]')).toHaveText('進行中');
    await expect(page.locator('.nuu-question[data-tone="waiting"]')).toHaveCount(1);
    await expect(page.locator('.nuu-blocker')).toContainText('インデックスの追加');
    await expect(page.locator('.nuu-column')).toHaveCount(5);
    await expect(page.locator('.nuu-column[data-tone="done"] .nuu-task')).toHaveCount(3);
    for (const type of PANEL_TYPES) {
      await expect(page.locator(`.nuu-panel[data-type="${type}"]`)).toHaveCount(1);
    }
    await expect(page.locator('.nuu-panel[data-type="table"] tbody tr')).toHaveCount(4);
    await expect(page.locator('.nuu-panel[data-type="trend"] polyline')).toHaveCount(2);
    await expect(page.locator('.nuu-panel[data-type="flow"] .nuu-step')).toHaveCount(7);
    // 成果物は新しい順に並べる。
    await expect(page.locator('.nuu-artifact-name')).toHaveText(['画面の確認用のプレビュー', '検索 API の変更', '絞り込み条件の設計メモ']);
    await expect(page.locator('.nuu-back')).toHaveAttribute('href', '../index.html');
  });

  test('スタブは自分のファイル名からデータとトークン量のファイルを決める（日本語や空白を含む名前でも）', async ({ page }) => {
    const key = 'sample-shop/2026-09-28-2300-日本語 の作業';
    const data = sample();
    data.slug = '2026-09-28-2300-日本語 の作業';
    data.title = '名前に日本語と空白を含む作業';
    board.writeTask(key, data);
    board.writeUsage(key, usage({ totals: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 12345 } }));
    await openAt(page, board.taskUrl(key));
    await expect(page.locator('.nuu-title')).toHaveText('名前に日本語と空白を含む作業');
    await expect(page.locator('[data-role="usage-exact"]')).toHaveText('12,345');
  });

  test('状態は色だけでなく記号と文字でも示す', async ({ page }) => {
    await openAt(page, board.taskUrl());
    for (const badge of await page.locator('.nuu-badge:visible').all()) {
      await expect(badge.locator('svg.nuu-icon')).toHaveCount(1);
      expect((await badge.innerText()).trim()).not.toBe('');
    }
  });

  test('favicon があり、file: と data: 以外の URL を読み込まない', async ({ page, browserName }) => {
    const { requests, external } = await watchRequests(page);
    await openAt(page, board.taskUrl());
    await nextPoll(page);
    const icon = await page.locator('link[rel="icon"]').getAttribute('href');
    expect(icon).toMatch(/^data:image\/svg\+xml,/);
    // Firefox は file: の読み込みを request として知らせないので、数の確認は Chromium と WebKit だけで行う。
    if (browserName !== 'firefox') expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((url) => !/^(file|data):/.test(url))).toEqual([]);
    expect(external).toEqual([]);
  });

  test('知らない status は進行中として、知らないパネルの種類は「未対応」として出し、描画を続ける', async ({ page }) => {
    const data = sample();
    data.status = 'sleeping';
    data.panels.splice(1, 0, { id: 'chart', type: 'chart', title: '新しい種類', series: [] });
    data.panels.push({ id: 'broken', type: 'progress', title: '中身が壊れたパネル', items: 'x' });
    board.writeTask(SAMPLE, data);
    await openAt(page, board.taskUrl());
    await expect(page.locator('.nuu-stats [data-status="active"]')).toHaveText('進行中');
    await expect(page.locator('.nuu-panel-unknown')).toContainText('未対応の種類のパネルです（type: chart）');
    await expect(page.locator('.nuu-panel')).toHaveCount(9);
    await expect(page.locator('.nuu-panel[data-panel="broken"]')).toContainText('なし');
    await expect(page.locator('.nuu-artifact')).toHaveCount(3);
  });

  test('タイトルなどに入れた HTML の断片は文字として出し、javascript: の参照はリンクにしない', async ({ page }) => {
    const data = sample();
    const title = '<img src=x onerror="window.__xss = 1">題名';
    data.title = title;
    data.summary = '<script>window.__xss = 2</script>';
    data.tasks[0].title = '<b onmouseover="window.__xss = 3">太字</b>';
    data.panels.find((p) => p.type === 'text').body = '<a href="javascript:window.__xss = 4">押す</a>';
    data.artifacts = [
      { name: 'a', ref: 'javascript:window.__xss = 5', at: 1790606900 },
      { name: 'b', ref: ' JAVASCRIPT:window.__xss = 6', at: 1790606800 },
      { name: 'c', ref: 'data:text/html,<script>1</script>', at: 1790606700 },
      { name: 'd', ref: 'https://example.com/ok', at: 1790606600 },
    ];
    board.writeTask(SAMPLE, data);
    await openAt(page, board.taskUrl());
    await expect(page.locator('.nuu-title')).toHaveText(title);
    await expect(page.locator('.nuu-summary')).toHaveText(data.summary);
    await expect(page.locator('img[src="x"], b, script:not([src])')).toHaveCount(0);
    await expect(page.locator('a[href^="javascript" i], a[href^=" javascript" i], a[href^="data:" i]')).toHaveCount(0);
    await expect(page.locator('a.nuu-ref')).toHaveCount(1);
    await expect(page.locator('a.nuu-ref')).toHaveAttribute('href', 'https://example.com/ok');
    await expect(page.locator('code.nuu-ref').first()).toHaveText('javascript:window.__xss = 5');
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('描く部分に JSON オブジェクトを直接渡して、ファイルを読まずに描ける', async ({ page }) => {
    board.write('direct.html', '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="_client/nuu.css"><div id="target"></div><script src="_client/nuu.js"></script>');
    const requests = [];
    page.on('request', (request) => requests.push(request.url()));
    await page.goto(board.url('direct.html'));
    const data = sample();
    const result = await page.evaluate(({ data, usage }) => {
      const target = document.getElementById('target');
      window.NUU.renderTask(target, data, usage);
      return {
        title: target.querySelector('.nuu-title').textContent,
        panels: target.querySelectorAll('.nuu-panel').length,
        tokens: target.querySelector('[data-role="usage-short"]').textContent,
        resume: target.querySelector('[data-role="resume"]').textContent,
      };
    }, { data, usage: usage() });
    expect(result).toEqual({
      title: data.title,
      panels: 7,
      tokens: '96 万',
      resume: `cd '/work/sample-shop' && claude --resume ${SESSION_ID}`,
    });
    expect(requests.filter((url) => /\.data\.js|\.usage\.js/.test(url))).toEqual([]);
  });
});

test.describe('PR / MR', () => {
  const review = (overrides) => Object.assign({
    provider: 'github', kind: 'pr', number: 7, title: '題名', url: 'https://github.com/example/app/pull/7', state: 'open', at: 1790606000,
  }, overrides);
  const rows = (page) => page.locator('[data-slot="reviews"] .nuu-review');

  test('要約のすぐ下に欄を置き、番号と題名を新しいタブで開くリンクにする', async ({ page }) => {
    await openAt(page, board.taskUrl());
    const section = page.locator('[data-slot="reviews"]');
    await expect(section).toHaveAttribute('aria-label', 'PR');
    await expect(section.locator('.nuu-h2')).toHaveText('PR');
    await expect(section.locator('.nuu-count')).toHaveText('1 件');
    expect(await section.evaluate((node) => node.previousElementSibling.getAttribute('data-slot'))).toBe('stats');
    const row = rows(page).first();
    await expect(row.locator('.nuu-review-provider')).toHaveText('GitHub PR');
    const link = row.locator('a.nuu-review-main');
    await expect(link).toHaveAttribute('href', 'https://github.com/example-shop/storefront/pull/128');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener');
    await expect(link.locator('.nuu-review-number')).toHaveText('#128');
    await expect(link.locator('.nuu-review-title')).toHaveText('検索 API に価格と在庫の絞り込みを追加する');
    await expect(row.locator('.nuu-review-state')).toHaveText('レビュー中');
    await expect(row.locator('.nuu-review-time')).toHaveText('最終更新 23:35（18 分前）');
  });

  test('GitHub は #、GitLab は ! で番号を書き、4 つの状態を色と記号と文字で示し、新しい順に並べる', async ({ page }) => {
    const data = sample();
    data.reviews = [
      review({ number: 1, url: 'https://github.com/example/app/pull/1', state: 'draft', at: 1790604000 }),
      review({ provider: 'gitlab', kind: 'mr', number: 12, url: 'https://gitlab.com/example/app/-/merge_requests/12', state: 'merged', at: 1790606000 }),
      review({ number: 2, url: 'https://github.com/example/app/pull/2', state: 'open', at: 1790605000 }),
      review({ provider: 'gitlab', kind: 'mr', number: 13, url: 'https://gitlab.example.com/group/sub/app/-/merge_requests/13', state: 'closed', at: 1790607000 }),
    ];
    board.writeTask(SAMPLE, data);
    await openAt(page, board.taskUrl());
    await expect(rows(page).locator('.nuu-review-number')).toHaveText(['!13', '!12', '#2', '#1']);
    await expect(rows(page).locator('.nuu-review-provider')).toHaveText(['GitLab MR', 'GitLab MR', 'GitHub PR', 'GitHub PR']);
    await expect(rows(page).locator('.nuu-review-state')).toHaveText(['閉じた', 'マージ済み', 'レビュー中', '下書き']);
    const tones = await rows(page).locator('.nuu-review-state').evaluateAll((nodes) => nodes.map((n) => [n.getAttribute('data-tone'), getComputedStyle(n).color]));
    expect(tones.map((t) => t[0])).toEqual(['blocked', 'done', 'doing', 'todo']);
    expect(new Set(tones.map((t) => t[1])).size).toBe(4);
    for (const badge of await rows(page).locator('.nuu-review-state').all()) {
      await expect(badge.locator('svg.nuu-icon')).toHaveCount(1);
    }
  });

  test('見出しと aria-label は、GitHub だけなら PR、GitLab だけなら MR、両方あれば PR / MR にし、読み直して中身が変わると切り替える', async ({ page }) => {
    const gitlab = (overrides) => review(Object.assign({
      provider: 'gitlab', kind: 'mr', number: 12, url: 'https://gitlab.com/example/app/-/merge_requests/12',
    }, overrides));
    const section = page.locator('[data-slot="reviews"]');
    const expectTitle = async (title, count) => {
      await expect(section).toHaveAttribute('aria-label', title);
      await expect(section.locator('.nuu-h2')).toHaveText(title);
      await expect(section.locator('.nuu-count')).toHaveText(`${count} 件`);
    };
    const data = sample();
    data.reviews = [review({ number: 1, url: 'https://github.com/example/app/pull/1' }), review({ number: 2, url: 'https://github.com/example/app/pull/2' })];
    board.writeTask(SAMPLE, data);
    await openAt(page, board.taskUrl());
    await expectTitle('PR', 2);

    data.reviews = [gitlab({ number: 12 }), gitlab({ number: 13, url: 'https://gitlab.com/example/app/-/merge_requests/13' })];
    board.writeTask(SAMPLE, data);
    await nextPoll(page);
    await expectTitle('MR', 2);
    await expect(rows(page).locator('.nuu-review-provider')).toHaveText(['GitLab MR', 'GitLab MR']);

    data.reviews = [gitlab(), review()];
    board.writeTask(SAMPLE, data);
    await nextPoll(page);
    await expectTitle('PR / MR', 2);
    await expect(rows(page).locator('.nuu-review-provider')).toHaveText(['GitLab MR', 'GitHub PR']);

    data.reviews = [review()];
    board.writeTask(SAMPLE, data);
    await nextPoll(page);
    await expectTitle('PR', 1);
  });

  test('https: 以外の URL はリンクにせず、題名などの HTML の断片は文字として出す', async ({ page }) => {
    const data = sample();
    data.reviews = [
      review({ number: 1, url: 'http://github.com/example/app/pull/1', title: '<img src=x onerror="window.__xss = 1">http', at: 1790606500 }),
      review({ number: 2, url: 'javascript:window.__xss = 2', at: 1790606400 }),
      review({ number: 3, url: ' https://github.com/example/app/pull/3', at: 1790606300 }),
      review({ number: 4, url: 'https://github.com/example/app/pull/4 onmouseover=x', at: 1790606200 }),
      review({ number: 5, url: 'https://github.com/example/app/pull/5', at: 1790606100 }),
    ];
    board.writeTask(SAMPLE, data);
    await openAt(page, board.taskUrl());
    await expect(rows(page)).toHaveCount(5);
    await expect(page.locator('[data-slot="reviews"] a')).toHaveCount(1);
    await expect(page.locator('[data-slot="reviews"] a')).toHaveAttribute('href', 'https://github.com/example/app/pull/5');
    await expect(rows(page).first().locator('span.nuu-review-main')).toHaveText('#1<img src=x onerror="window.__xss = 1">http');
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
    expect(await page.evaluate(() => window.__xss)).toBeUndefined();
  });

  test('PR / MR がないか空なら欄を出さず、足されたら出す', async ({ page }) => {
    const data = sample();
    delete data.reviews;
    board.writeTask(SAMPLE, data);
    await openAt(page, board.taskUrl());
    const section = page.locator('[data-slot="reviews"]');
    await expect(section).toBeHidden();
    await expect(section).toBeEmpty();

    data.reviews = [];
    board.writeTask(SAMPLE, data);
    await nextPoll(page);
    await expect(section).toBeHidden();

    data.reviews = [review({ state: 'draft' })];
    board.writeTask(SAMPLE, data);
    await nextPoll(page);
    await expect(section).toBeVisible();
    await expect(rows(page).locator('.nuu-review-state')).toHaveText('下書き');

    data.reviews = [review({ state: 'merged', at: 1790607000 })];
    board.writeTask(SAMPLE, data);
    await nextPoll(page);
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).locator('.nuu-review-state')).toHaveText('マージ済み');
  });
});

test.describe('読み直し', () => {
  test('データを書き換えると再読み込みせずに表示が変わり、スクロール位置と開いた詳細が残る', async ({ page }) => {
    await openAt(page, board.taskUrl());
    await page.evaluate(() => { window.__marker = 'same page'; });
    await page.locator('details[data-key="answered"] > summary').click();
    await expect(page.locator('details[data-key="answered"]')).toHaveAttribute('open', '');
    await page.evaluate(() => window.scrollTo(0, 900));

    const data = sample();
    data.title = '書き換えたタイトル';
    data.tasks[4].status = 'done';
    data.questions[1].answer = '回答を直した';
    data.updatedAt += 30;
    board.writeTask(SAMPLE, data);
    await nextPoll(page);

    await expect(page.locator('.nuu-title')).toHaveText('書き換えたタイトル');
    await expect(page.locator('.nuu-stats')).toContainText('4 / 8');
    await expect(page.locator('details[data-key="answered"]')).toHaveAttribute('open', '');
    await expect(page.locator('details[data-key="answered"]')).toContainText('回答を直した');
    expect(await page.evaluate(() => window.__marker)).toBe('same page');
    expect(await page.evaluate(() => window.scrollY)).toBe(900);
  });

  test('同じデータなら描き直さない', async ({ page }) => {
    await openAt(page, board.taskUrl());
    const before = await root(page).getAttribute('data-renders');
    const title = await page.locator('.nuu-title').elementHandle();
    await nextPoll(page);
    await nextPoll(page);
    expect(await root(page).getAttribute('data-renders')).toBe(before);
    // 同じ要素のまま残っている（差し替えていない）。
    expect(await title.evaluate((node) => node.isConnected)).toBe(true);
  });

  test('読み込みが 3 回続けて失敗したときだけ警告を出し、読めたら消す', async ({ page }) => {
    await openAt(page, board.taskUrl());
    const warning = page.locator('[data-role="load-warning"]');
    const original = sample();
    board.remove(`${SAMPLE}.data.js`);
    await nextPoll(page);
    await expect(root(page)).toHaveAttribute('data-load-failures', '1');
    await expect(warning).toBeHidden();
    await nextPoll(page);
    await expect(root(page)).toHaveAttribute('data-load-failures', '2');
    await expect(warning).toBeHidden();
    await nextPoll(page);
    await expect(root(page)).toHaveAttribute('data-load-failures', '3');
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('2026-09-28-2252-search-filters.data.js が、この HTML と同じフォルダーにあるか');
    // 読めない間も、前の表示を残す。
    await expect(page.locator('.nuu-title')).toHaveText(original.title);

    board.writeTask(SAMPLE, original);
    await nextPoll(page);
    await expect(root(page)).toHaveAttribute('data-load-failures', '0');
    await expect(warning).toBeHidden();
  });

  test('構文が壊れたデータ（書き込み途中など）も読めなかった回として数える', async ({ page }) => {
    await openAt(page, board.taskUrl());
    board.write(`${SAMPLE}.data.js`, 'window.nuuDashboardData(\n{"title": "途中まで", "tasks": [\n');
    await nextPoll(page);
    await nextPoll(page);
    await expect(page.locator('[data-role="load-warning"]')).toBeHidden();
    await nextPoll(page);
    await expect(root(page)).toHaveAttribute('data-load-failures', '3');
    await expect(page.locator('[data-role="load-warning"]')).toBeVisible();
    await expect(page.locator('.nuu-title')).toHaveText(sample().title);
  });

  test('コールバックを呼ばないファイルも読めなかった回として数える', async ({ page }) => {
    await openAt(page, board.taskUrl());
    board.write(`${SAMPLE}.data.js`, '// 空\n');
    await nextPoll(page);
    await expect(root(page)).toHaveAttribute('data-load-failures', '1');
  });
});

test.describe('止まっている警告', () => {
  test('進行中で 15 分以上更新がないときだけ出し、警告から #session へ移れる', async ({ page }) => {
    await openAt(page, board.taskUrl(), SAMPLE_UPDATED + 15 * 60 - 1);
    const warning = page.locator('[data-role="stale-warning"]');
    await expect(warning).toBeHidden();
    await page.clock.runFor(1000);
    await expect(warning).toBeVisible();
    await expect(warning).toContainText('15 分以上更新がありません');
    await expect(warning.locator('a[href="#session"]')).toHaveText('再開のコマンドへ');
    await warning.locator('a[href="#session"]').click();
    await expect(page).toHaveURL(/#session$/);
    await expect(page.locator('#session')).toBeInViewport();
  });

  for (const status of ['paused', 'done']) {
    test(`${status} のときは長く更新がなくても出さない`, async ({ page }) => {
      const data = sample();
      data.status = status;
      board.writeTask(SAMPLE, data);
      await openAt(page, board.taskUrl(), SAMPLE_UPDATED + 3 * 3600);
      await page.clock.runFor(2000);
      await expect(page.locator('[data-role="stale-warning"]')).toBeHidden();
    });
  }

  test('更新されたら警告が消える', async ({ page }) => {
    await openAt(page, board.taskUrl(), SAMPLE_UPDATED + 20 * 60);
    await expect(page.locator('[data-role="stale-warning"]')).toBeVisible();
    const data = sample();
    data.updatedAt = SAMPLE_UPDATED + 20 * 60;
    board.writeTask(SAMPLE, data);
    await nextPoll(page);
    await expect(page.locator('[data-role="stale-warning"]')).toBeHidden();
  });

  test('時計と経過時間を 1 秒ごとに書き換える', async ({ page }) => {
    await openAt(page, board.taskUrl(), SAMPLE_UPDATED + 59);
    await expect(page.locator('[data-clock="now"]')).toHaveText('23:53:02');
    await expect(page.locator('.nuu-clock-ago')).toHaveText('たった今更新');
    await page.clock.runFor(1000);
    await expect(page.locator('[data-clock="now"]')).toHaveText('23:53:03');
    await expect(page.locator('.nuu-clock-ago')).toHaveText('1 分前に更新');
  });
});

test.describe('セッションとコピー', () => {
  test('再開のコマンドは作業ディレクトリの \' を置き換えて囲む', async ({ page }) => {
    board.writeUsage(SAMPLE, usage({ cwd: "/work/it's here" }));
    await openAt(page, board.taskUrl());
    await expect(page.locator('[data-role="resume"]')).toHaveText(`cd '/work/it'\\''s here' && claude --resume ${SESSION_ID}`);
    await expect(page.locator('[data-role="session-id"]')).toHaveText(SESSION_ID);
    await expect(page.locator('[data-role="cwd"]')).toHaveText("/work/it's here");
  });

  test('作業ディレクトリがなければ claude --resume だけにする', async ({ page }) => {
    board.writeUsage(SAMPLE, usage({ cwd: null }));
    await openAt(page, board.taskUrl());
    await expect(page.locator('[data-role="resume"]')).toHaveText(`claude --resume ${SESSION_ID}`);
    await expect(page.locator('[data-role="cwd"]')).toHaveText('記録なし');
  });

  test('コピーに成功したときだけ「コピーしました」と出す', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: (value) => { window.__copied = value; return Promise.resolve(); } },
      });
    });
    await openAt(page, board.taskUrl());
    await page.locator('[data-role="resume-copy"]').click();
    await expect(page.locator('[data-role="resume-status"]')).toHaveText('コピーしました');
    expect(await page.evaluate(() => window.__copied)).toBe(`cd '/work/sample-shop' && claude --resume ${SESSION_ID}`);
    await page.locator('[data-role="session-id-copy"]').click();
    expect(await page.evaluate(() => window.__copied)).toBe(SESSION_ID);
  });

  test('コピーに失敗したら文字列を選び、⌘C か Ctrl+C を案内する', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error('denied')) },
      });
    });
    await openAt(page, board.taskUrl());
    await page.locator('[data-role="resume-copy"]').click();
    await expect(page.locator('[data-role="resume-status"]')).toHaveText('選びました。⌘C か Ctrl+C でコピーしてください');
    expect(await page.evaluate(() => window.getSelection().toString())).toBe(`cd '/work/sample-shop' && claude --resume ${SESSION_ID}`);
  });

  test('クリップボードが使えないときも選んで案内する', async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined });
    });
    await openAt(page, board.taskUrl());
    await page.locator('[data-role="session-id-copy"]').click();
    await expect(page.locator('[data-role="session-id-status"]')).toHaveText('選びました。⌘C か Ctrl+C でコピーしてください');
    expect(await page.evaluate(() => window.getSelection().toString())).toBe(SESSION_ID);
  });
});

test.describe('トークン量', () => {
  test('.usage.js がないときは「集計前」と出し、ページは壊れない', async ({ page }) => {
    board.remove(`${SAMPLE}.usage.js`);
    await openAt(page, board.taskUrl());
    await expect(root(page)).toHaveAttribute('data-usage-state', 'missing');
    await expect(page.locator('[data-role="token-total"]')).toContainText('集計前');
    await expect(page.locator('[data-role="token-total"]')).toHaveAttribute('href', '#usage');
    await expect(page.locator('#usage')).toContainText('集計前');
    await expect(page.locator('#session')).toContainText('集計前');
    await expect(page.locator('.nuu-panel')).toHaveCount(7);
  });

  test('大きな数は短く出し、正確な値を 3 桁区切りで添える', async ({ page }) => {
    await openAt(page, board.taskUrl());
    await expect(page.locator('[data-role="token-total"]')).toContainText('96 万');
    await expect(page.locator('[data-role="usage-short"]')).toHaveText('96 万');
    await expect(page.locator('[data-role="usage-exact"]')).toHaveText('959,950');
    await expect(page.locator('#usage')).toContainText('目安です。サブエージェントの出力トークンは少なめに出ることがあります');
    const formats = await page.evaluate(() => [8500, 10000, 191000, 959950, 1180000, 99999999, 123456789, 0].map(window.NUU.format.short));
    expect(formats).toEqual(['8,500', '1 万', '19.1 万', '96 万', '118 万', '1 億', '1.2 億', '0']);
    expect(await page.evaluate(() => window.NUU.format.exact(1234567))).toBe('1,234,567');
  });

  test('正常な .usage.js の読み直しは成功、構文が壊れた .usage.js は失敗として扱い、表示は前の値のまま', async ({ page }) => {
    await openAt(page, board.taskUrl());
    await expect(root(page)).toHaveAttribute('data-usage-state', 'ok');
    await expect(page.locator('[data-role="usage-short"]')).toHaveText('96 万');

    board.write(`${SAMPLE}.usage.js`, `(window.NUU_USAGE = window.NUU_USAGE || {})["${SAMPLE}"] = {"since": 1, "totals": {"to`);
    await nextPoll(page);
    await expect(root(page)).toHaveAttribute('data-usage-state', 'failed');
    await expect(page.locator('[data-role="usage-short"]')).toHaveText('96 万');

    const next = usage();
    next.totals.total = 2000000;
    board.writeUsage(SAMPLE, next);
    await nextPoll(page);
    await expect(root(page)).toHaveAttribute('data-usage-state', 'ok');
    await expect(page.locator('[data-role="usage-short"]')).toHaveText('200 万');
    await expect(page.locator('[data-role="token-total"]')).toContainText('200 万');

    // 同じ内容をもう一度読んでも、入れ替わったので成功として扱う。
    await nextPoll(page);
    await expect(root(page)).toHaveAttribute('data-usage-state', 'ok');
  });
});

test.describe('好み', () => {
  test('好みの 4 項目を変えると、10 秒以内の読み直しで見た目が変わる', async ({ page }) => {
    await openAt(page, board.taskUrl());
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(html).toHaveAttribute('data-density', 'airy');
    await expect(page.locator('.nuu-kanban')).toHaveCount(1);
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const padding = await page.locator('.nuu-stat').first().evaluate((node) => getComputedStyle(node).paddingTop);

    board.writePrefs({ schema: 1, theme: 'light', density: 'dense', accent: '#FF5500', taskView: 'list' });
    await page.clock.runFor(10_000);
    await expect(html).toHaveAttribute('data-theme', 'light');
    await expect(html).toHaveAttribute('data-density', 'dense');
    await expect(page.locator('.nuu-tasklist[data-view="list"]')).toHaveCount(1);
    await expect(page.locator('.nuu-kanban')).toHaveCount(0);
    expect(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim().toUpperCase())).toBe('#FF5500');
    expect(await page.evaluate(() => getComputedStyle(document.body).backgroundColor)).not.toBe(background);
    expect(await page.locator('.nuu-stat').first().evaluate((node) => getComputedStyle(node).paddingTop)).not.toBe(padding);
  });

  test('好みのファイルがなくても既定の見た目で表示し、消えたら既定に戻す', async ({ page }) => {
    board.remove('prefs.data.js');
    await openAt(page, board.taskUrl());
    const html = page.locator('html');
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(html).toHaveAttribute('data-density', 'airy');
    await expect(page.locator('.nuu-kanban')).toHaveCount(1);
    await expect(page.locator('.nuu-panel')).toHaveCount(7);

    board.writePrefs({ schema: 1, theme: 'light', density: 'dense', accent: '#0EA5E9', taskView: 'list' });
    await nextPoll(page);
    await expect(html).toHaveAttribute('data-theme', 'light');
    board.remove('prefs.data.js');
    await nextPoll(page);
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(page.locator('.nuu-kanban')).toHaveCount(1);
  });

  test('壊れた好みのファイルでは今の見た目を保つ', async ({ page }) => {
    await openAt(page, board.taskUrl());
    board.write('prefs.data.js', 'window.nuuDashboardPrefs(\n{"theme": "li');
    await nextPoll(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});
