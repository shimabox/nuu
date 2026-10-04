import { expect, mock, test } from 'claude-code/testing'

import { belongs, parseDataJs, progress, toDashboard } from '../hooks/register'

const ROOT = '/u/me/.claude/nuu/dashboards'
const CWD = '/work/shop'

const wrap = (data: unknown) => `window.nuuDashboardData(\n${JSON.stringify(data)}\n);\n`

const ACTIVE = {
  project: 'shop',
  slug: '2026-10-04-1200-cart',
  title: 'カートの合計を直す',
  summary: '税込の合計がずれる',
  cwd: CWD,
  status: 'active',
  updatedAt: 200,
  tasks: [
    { id: 1, title: '原因を調べる', status: 'done', note: '' },
    { id: 2, title: '直す', status: 'doing', note: '' },
    { id: 3, title: '古い案', status: 'skipped', note: '' },
    { id: 4, title: 'PR を作る', status: 'todo', note: '' },
  ],
  questions: [{ id: 1, question: '端数は切り捨てでよいか', default: '切り捨て', answer: '' }],
  blockers: [],
  reviews: [{ kind: 'pr', number: 7, title: '合計を直す', url: 'https://github.com/x/shop/pull/7', state: 'open' }],
}
const OTHER = { ...ACTIVE, project: 'blog', slug: 'other', title: '別のプロジェクト', cwd: '/work/blog' }

const FILES: Record<string, string> = {
  [`${ROOT}/shop/2026-10-04-1200-cart.data.js`]: wrap(ACTIVE),
  [`${ROOT}/blog/other.data.js`]: wrap(OTHER),
  [`${ROOT}/prefs.data.js`]: wrap({ accent: '#FF8800' }),
}
const DIRS: Record<string, { name: string; kind: 'file' | 'dir' }[]> = {
  [ROOT]: [
    { name: '_client', kind: 'dir' },
    { name: 'shop', kind: 'dir' },
    { name: 'blog', kind: 'dir' },
    { name: 'prefs.data.js', kind: 'file' },
  ],
  [`${ROOT}/shop`]: [{ name: '2026-10-04-1200-cart.data.js', kind: 'file' }],
  [`${ROOT}/blog`]: [{ name: 'other.data.js', kind: 'file' }],
}

test('data.js を読み、手順の進み具合を数える', async () => {
  const d = toDashboard(parseDataJs(wrap(ACTIVE)), '/x/a.data.js')
  expect(d?.title).toBe('カートの合計を直す')
  expect(d?.html).toBe('/x/a.html')
  expect(progress(d?.tasks ?? [])).toEqual({ done: 1, total: 3 })
  expect(parseDataJs('壊れたファイル')).toBe(null)
})

test('作業ディレクトリの包含かプロジェクト名で今のプロジェクトを判定する', async () => {
  const d = toDashboard(ACTIVE, 'a')
  if (d === null) throw new Error('parse failed')
  expect(belongs(d, CWD, [])).toBe(true)
  expect(belongs(d, `${CWD}/src`, [])).toBe(true)
  expect(belongs(d, '/work/shop-2', ['shop'])).toBe(true)
  expect(belongs(d, '/work/blog', ['blog'])).toBe(false)
})

test('/nuu で今のプロジェクトの作業だけをペインと帯に出す', async ($, on) => {
  mock.env(on, { HOME: '/u/me' })
  on('session.cwd', () => ({ value: CWD }))
  on('process.run', () => ({ deny: 'git はこのテストでは使わない' }))
  on('fs.list', (_$, e) => ({
    value: (DIRS[e.path] ?? []).map(x => ({ ...x, size: 1, mtimeMs: 1, isLink: false })),
  }))
  on('fs.read', (_$, e) => {
    const text = FILES[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })

  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))

  const ran = await $.command.run({
    command: 'nuu',
    args: '',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(ran.text).toContain('1 件')

  for (const surface of ['terminal', 'desktop'] as const) {
    const pane = await $.ui.mount({
      plugin: 'nuu',
      surface,
      component: 'Pane',
      requestId: 'nuu',
      props: { title: 'nuu', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
    expect(await pane.find({ type: 'Text', text: 'カートの合計を直す' })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: /端数は切り捨て/ })).toBeDefined()
    expect(await pane.find({ type: 'Text', text: '別のプロジェクト' })).toBeUndefined()
    expect(await pane.find({ key: 'browser' })).toBeDefined()
    await pane.unmount()

    const band = await $.ui.mount({
      plugin: 'nuu',
      surface,
      component: 'AbovePrompt',
      props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} },
    })
    expect(await band.find({ type: 'Text', text: '質問 1' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: '1/3' })).toBeDefined()
    await band.unmount()
  }

  const all = await $.command.run({
    command: 'nuu',
    args: 'all',
    origin: { kind: 'composer' },
    presentation: { isFullscreen: true, columns: 160 },
  })
  expect(all.text).toContain('全プロジェクトの作業 2 件')
  const pane = await $.ui.mount({
    plugin: 'nuu',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'nuu',
    props: { title: 'nuu', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await pane.find({ key: 'pick-blog-other' })).toBeDefined()
  await pane.press({ key: 'scope' })
  expect(await pane.find({ key: 'pick-blog-other' })).toBeUndefined()
  await pane.unmount()
})

const usage = (key: string, cwd: string) =>
  `// dashboard-usage.py が書く。手で編集しない。\n(window.NUU_USAGE = window.NUU_USAGE || {})["${key}"] = {"since": 1, "cwd": "${cwd}", "totals": {}};\n`

const PAUSED = { ...ACTIVE, project: 'shop-renamed', slug: 'paused-work', title: '中断中の作業', status: 'paused' }
delete (PAUSED as { cwd?: string }).cwd
const TOOLS = { ...ACTIVE, project: '_tools', slug: 'tools-work', title: '道具の作業', cwd: '/work/tools' }
const CLIENT_LIKE = { ...ACTIVE, project: '_client', slug: 'not-a-work', title: 'クライアントのフォルダー' }

const FILES2: Record<string, string> = {
  [`${ROOT}/shop-renamed/paused-work.data.js`]: wrap(PAUSED),
  [`${ROOT}/shop-renamed/paused-work.usage.js`]: usage('shop-renamed/paused-work', CWD),
  [`${ROOT}/_tools/tools-work.data.js`]: wrap(TOOLS),
  [`${ROOT}/_client/not-a-work.data.js`]: wrap(CLIENT_LIKE),
}
const DIRS2: Record<string, { name: string; kind: 'file' | 'dir'; mtimeMs: number }[]> = {
  [ROOT]: [
    { name: '_client', kind: 'dir', mtimeMs: 2 },
    { name: '_tools', kind: 'dir', mtimeMs: 2 },
    { name: 'shop-renamed', kind: 'dir', mtimeMs: 2 },
  ],
  [`${ROOT}/shop-renamed`]: [
    { name: 'paused-work.data.js', kind: 'file', mtimeMs: 2 },
    { name: 'paused-work.usage.js', kind: 'file', mtimeMs: 2 },
  ],
  [`${ROOT}/_tools`]: [{ name: 'tools-work.data.js', kind: 'file', mtimeMs: 2 }],
  [`${ROOT}/_client`]: [{ name: 'not-a-work.data.js', kind: 'file', mtimeMs: 2 }],
}

test('作業ディレクトリは .usage.js から取り、_client だけを除き、中断中の作業は帯に出さない', async ($, on) => {
  mock.env(on, { HOME: '/u/me' })
  mock.clock(on)
  // mod が帯を描かずに渡したときに、エンジンの代わりに描く
  on('ui.render', { component: 'AbovePrompt' }, (_$, e) => {
    const { Text } = _$.ui.resolve(e)
    return <Text>engine</Text>
  })
  on('session.cwd', () => ({ value: CWD }))
  on('process.run', () => ({ deny: 'git はこのテストでは使わない' }))
  on('fs.list', (_$, e) => ({
    value: (DIRS2[e.path] ?? []).map(x => ({ ...x, size: 1, isLink: false })),
  }))
  on('fs.read', (_$, e) => {
    const text = FILES2[e.path]
    if (text === undefined) throw new Error('ENOENT')
    return { value: text }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.panes', () => ({ value: [] }))
  const run = (args: string) =>
    $.command.run({
      command: 'nuu',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: true, columns: 160 },
    })

  // プロジェクト名がフォルダー名と違っても、.usage.js の作業ディレクトリで今のプロジェクトの作業になる
  expect((await run('')).text).toContain('このプロジェクトの作業 1 件')
  // _tools は出し、_client は作業として読まない
  expect((await run('all')).text).toContain('全プロジェクトの作業 2 件')
  const pane = await $.ui.mount({
    plugin: 'nuu',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'nuu',
    props: { title: 'nuu', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  // 進行中の _tools の作業が先頭に開き、中断中の作業はほかの作業に並ぶ
  expect(await pane.find({ type: 'Text', text: '道具の作業' })).toBeDefined()
  expect(await pane.find({ key: 'pick-shop-renamed-paused-work' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: 'クライアントのフォルダー' })).toBeUndefined()
  await pane.unmount()

  // 今のプロジェクトには中断中の作業しかないので、帯は出さずにエンジンへ渡す
  await run('')
  const band = await $.ui.mount({
    plugin: 'nuu',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { hasSurvey: false, isWorking: false, maxRows: 3, bodyColumns: 120, scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  expect(await band.find({ key: 'open' })).toBeUndefined()
  expect(await band.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await band.unmount()
})
