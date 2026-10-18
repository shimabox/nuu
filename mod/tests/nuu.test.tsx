import { expect, mock, test } from 'claude-code/testing'
import type { EngineInterface, On } from 'claude-code'

import type { NuuDashboard } from '../types'
import {
  belongs,
  choose,
  isMine,
  ownOf,
  parseDataJs,
  parseUsageJs,
  progress,
  scan,
  sortDashboards,
  toDashboard,
  visibleOf,
} from '../hooks/register'

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
  on('session.id', () => ({ value: 'session-plain' }))
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
  expect(all.text).toContain('全プロジェクトの進行中の作業 2 件')
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
  on('session.id', () => ({ value: 'session-plain' }))
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
  expect((await run('')).text).toContain('このプロジェクトに進行中の作業はありません（完了・中断中 1 件')
  // _tools は出し、_client は作業として読まない
  expect((await run('all')).text).toContain('全プロジェクトの進行中の作業 1 件、完了・中断中 1 件')
  const pane = await $.ui.mount({
    plugin: 'nuu',
    surface: 'terminal',
    component: 'Pane',
    requestId: 'nuu',
    props: { title: 'nuu', isFocused: false, bodyColumns: 80, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  })
  // 進行中の _tools の作業が先頭に開き、中断中の作業は h を押すとほかの作業に並ぶ
  expect(await pane.find({ type: 'Text', text: '道具の作業' })).toBeDefined()
  expect(await pane.find({ key: 'pick-shop-renamed-paused-work' })).toBeUndefined()
  await pane.press({ key: 'hidden' })
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

test('.usage.js からセッションの ID と作業ディレクトリを読む', async () => {
  const text = `(window.NUU_USAGE = window.NUU_USAGE || {})["shop/a"] = {"since": 1, "cwd": "${CWD}", "sessionId": "S", "totals": {}};\n`
  expect(parseUsageJs(text)).toEqual({ since: 1, cwd: CWD, sessionId: 'S', totals: {} })

  const files: Record<string, string> = {
    [`${ROOT}/shop/a.data.js`]: wrap({ ...ACTIVE, slug: 'a', cwd: '' }),
    [`${ROOT}/shop/a.usage.js`]: text,
    [`${ROOT}/shop/b.data.js`]: wrap({ ...ACTIVE, slug: 'b' }),
  }
  // scan はファイルの一覧と読み込みだけを使うので、その 2 つだけを持つ $ で呼ぶ
  const fs = {
    list: async (path: string) =>
      path === ROOT
        ? [{ name: 'shop', kind: 'dir', mtimeMs: 1 }]
        : ['a.data.js', 'a.usage.js', 'b.data.js'].map(name => ({ name, kind: 'file', mtimeMs: 1 })),
    read: async (path: string) => {
      const found = files[path]
      if (found === undefined) throw new Error('ENOENT')
      return found
    },
  }
  const { every } = await scan({ fs } as unknown as EngineInterface, { root: ROOT, cwd: CWD, names: [] }, new Map(), new Map())
  const bySlug = (slug: string) => every.find(d => d.slug === slug)
  expect(bySlug('a')?.sessionId).toBe('S')
  expect(bySlug('a')?.cwd).toBe(CWD)
  expect(bySlug('b')?.sessionId).toBe('')
})

const as = (over: Partial<NuuDashboard>): NuuDashboard => {
  const d = toDashboard(ACTIVE, `${ROOT}/shop/${over.slug ?? 'x'}.data.js`)
  if (d === null) throw new Error('parse failed')
  return { ...d, ...over }
}

test('自分の作業は同じセッションの進行中の作業のうち、更新の新しいもの', async () => {
  const older = as({ slug: 'older', sessionId: 'S', updatedAt: 100 })
  const newer = as({ slug: 'newer', sessionId: 'S', updatedAt: 300 })
  const theirs = as({ slug: 'theirs', sessionId: 'X', updatedAt: 400 })
  const finished = as({ slug: 'finished', sessionId: 'S', updatedAt: 500, status: 'done' })
  const paused = as({ slug: 'paused', sessionId: 'S', updatedAt: 600, status: 'paused' })
  const all = sortDashboards([older, newer, theirs, finished, paused])
  expect(isMine(newer, 'S')).toBe(true)
  expect(isMine(theirs, 'S')).toBe(false)
  expect(isMine(as({ sessionId: '' }), '')).toBe(false)
  expect(ownOf(all, 'S')?.slug).toBe('newer')
  expect(ownOf(all, '')).toBeUndefined()
  expect(ownOf([finished, paused], 'S')).toBeUndefined()
})

test('隠す設定では完了・中断中を除き、見えない作業を選んでいれば自分の作業か先頭に落とす', async () => {
  const mine = as({ slug: 'mine', sessionId: 'S', updatedAt: 100 })
  const theirs = as({ slug: 'theirs', sessionId: 'X', updatedAt: 200 })
  const finished = as({ slug: 'finished', status: 'done' })
  const paused = as({ slug: 'paused', status: 'paused' })
  const pool = sortDashboards([mine, theirs, finished, paused])
  const visible = visibleOf(pool, false)
  expect(visible.map(d => d.slug)).toEqual(['theirs', 'mine'])
  expect(visibleOf(pool, true)).toHaveLength(4)
  expect(choose(visible, theirs.path, mine)?.slug).toBe('theirs')
  expect(choose(visible, finished.path, mine)?.slug).toBe('mine')
  expect(choose(visible, finished.path, undefined)?.slug).toBe('theirs')
  expect(choose(visibleOf(pool, true), finished.path, mine)?.slug).toBe('finished')
  expect(choose([], null, undefined)).toBeUndefined()
})

const POLL_MS = 10_000
// キャッシュが mtime で読み直しを決めるので、書くたびにテストをまたいで重ならない値にする
let stamp = 1000

type WorkSpec = { dir?: string; slug: string; title: string; status?: string; updatedAt: number; sessionId?: string }

/** 自分の作業を確かめるための、書き換えられるダッシュボードの置き場とエンジンの代わり */
function world(on: On, sessionId: string | null, works: WorkSpec[]) {
  const clock = mock.clock(on)
  mock.env(on, { HOME: '/u/me' })
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const state = { sessionId, isPaneOpen: true }
  const toasts: string[] = []
  const write = (w: WorkSpec) => {
    const dir = w.dir ?? 'shop'
    const base = `${ROOT}/${dir}/${w.slug}`
    const cwd = dir === 'shop' ? CWD : `/work/${dir}`
    const data = { ...ACTIVE, project: dir, slug: w.slug, title: w.title, status: w.status ?? 'active', updatedAt: w.updatedAt, questions: [], cwd }
    files.set(`${base}.data.js`, { text: wrap(data), mtimeMs: ++stamp })
    if (w.sessionId !== undefined) {
      const usage = { since: 1, cwd, sessionId: w.sessionId, totals: {} }
      const usageText = `(window.NUU_USAGE = window.NUU_USAGE || {})["${dir}/${w.slug}"] = ${JSON.stringify(usage)};\n`
      files.set(`${base}.usage.js`, { text: usageText, mtimeMs: ++stamp })
    }
  }
  for (const w of works) write(w)

  on('session.start', (_$, e) => ({ cwd: e.cwd }))
  on('command.register', (_$, e) => ({ value: { command: e.name } }))
  on('session.cwd', () => ({ value: CWD }))
  on('session.id', () => {
    if (state.sessionId === null) throw new Error('セッションの ID を取れない')
    return { value: state.sessionId }
  })
  on('process.run', () => ({ deny: 'git はこのテストでは使わない' }))
  on('fs.list', (_$, e) => {
    const prefix = `${e.path}/`
    const names = new Set<string>()
    for (const path of files.keys()) if (path.startsWith(prefix)) names.add(path.slice(prefix.length).split('/')[0] ?? '')
    return {
      value: [...names].map(name => {
        const file = files.get(`${prefix}${name}`)
        return { name, kind: file ? ('file' as const) : ('dir' as const), size: 1, mtimeMs: file?.mtimeMs ?? 1, isLink: false }
      }),
    }
  })
  on('fs.read', (_$, e) => {
    const file = files.get(e.path)
    if (file === undefined) throw new Error('ENOENT')
    return { value: file.text }
  })
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: undefined }))
  on('ui.panes', () => ({
    value: state.isPaneOpen ? [{ id: 'nuu', title: 'nuu', isShown: true, isFocused: true, isPlaced: true }] : [],
  }))
  on('ui.toast', (_$, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })

  return {
    state,
    ownToasts: () => toasts.filter(t => t.includes('自分の作業')),
    /** 作業を書き直し、10 秒進めて読み直させる */
    touch: async (w: WorkSpec) => {
      write(w)
      await clock.advance(POLL_MS)
    },
    poll: () => clock.advance(POLL_MS),
  }
}

const MINE: WorkSpec = { slug: 'mine', title: '税の計算を直す', updatedAt: 200, sessionId: 'S' }
const THEIRS: WorkSpec = { slug: 'theirs', title: '在庫を数える', updatedAt: 300, sessionId: 'X' }
const FINISHED: WorkSpec = { slug: 'finished', title: '古い作業', status: 'done', updatedAt: 100 }

const PANE_PROPS = {
  title: 'nuu',
  isFocused: true,
  bodyColumns: 80,
  placement: 'dock',
  scroll: { offset: 0, bodyRows: 60 },
  view: {},
} as const
const BAND_PROPS = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 3,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 40 },
  view: {},
} as const
const START = { cwd: CWD, surface: 'terminal', isInteractive: true } as const
const nuu = (args: string) =>
  ({ command: 'nuu', args, origin: { kind: 'composer' }, presentation: { isFullscreen: true, columns: 160 } }) as const

test('帯とペインはこのセッションの作業を優先し、別の作業を見ている間の更新を 1 回だけ知らせる', async ($, on) => {
  const w = world(on, 'S', [MINE, THEIRS, FINISHED])
  await $.session.start(START)
  const ran = await $.command.run(nuu(''))
  expect(ran.text).toContain('進行中の作業 2 件')
  expect(ran.text).toContain('完了・中断中 1 件')

  for (const surface of ['terminal', 'desktop'] as const) {
    const band = await $.ui.mount({ plugin: 'nuu', surface, component: 'AbovePrompt', props: BAND_PROPS })
    expect(await band.find({ type: 'Text', text: '税の計算を直す' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: 'ほか 1 件' })).toBeDefined()
    expect(await band.find({ type: 'Text', text: '在庫を数える' })).toBeUndefined()
    await band.unmount()
  }

  const pane = await $.ui.mount({ plugin: 'nuu', surface: 'terminal', component: 'Pane', requestId: 'nuu', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: '税の計算を直す' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '2/2' })).toBeDefined()
  expect(await pane.find({ key: 'own' })).toBeUndefined()
  expect(await pane.find({ key: 'pick-shop-finished' })).toBeUndefined()
  await pane.press({ key: 'hidden' })
  expect(await pane.find({ key: 'pick-shop-finished' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: '2/3' })).toBeDefined()
  await pane.press({ key: 'hidden' })
  expect(await pane.find({ key: 'pick-shop-finished' })).toBeUndefined()

  // 別の作業を見ている間に自分の作業が更新されても、表示は変えずに知らせる
  await pane.press({ key: 'next' })
  expect(await pane.find({ type: 'Text', text: '在庫を数える' })).toBeDefined()
  expect(await pane.find({ key: 'own' })).toBeDefined()
  await w.touch({ ...MINE, updatedAt: 400 })
  expect(await pane.find({ type: 'Text', text: '在庫を数える' })).toBeDefined()
  expect(await pane.findAll({ type: 'Text', text: /更新されました/ })).toHaveLength(1)
  expect(w.ownToasts()).toHaveLength(1)
  await w.touch({ ...MINE, updatedAt: 500 })
  expect(await pane.findAll({ type: 'Text', text: /更新されました/ })).toHaveLength(1)
  expect(w.ownToasts()).toHaveLength(1)

  // b で戻ると行が消え、再び別の作業を見ているときの更新はまた知らせる
  await pane.press({ key: 'own' })
  expect(await pane.find({ type: 'Text', text: '税の計算を直す' })).toBeDefined()
  expect(await pane.find({ type: 'Text', text: /更新されました/ })).toBeUndefined()
  expect(await pane.find({ key: 'own' })).toBeUndefined()
  await pane.press({ key: 'next' })
  await w.touch({ ...MINE, updatedAt: 600 })
  expect(w.ownToasts()).toHaveLength(2)

  // ペインが閉じているときは、帯が自分の作業を出しているので知らせない
  await pane.press({ key: 'own' })
  await pane.press({ key: 'next' })
  w.state.isPaneOpen = false
  await w.touch({ ...MINE, updatedAt: 700 })
  expect(w.ownToasts()).toHaveLength(2)

  // 自分の作業が完了すると、帯はほかの進行中に移り、上部の行と b は消える
  w.state.isPaneOpen = true
  await w.touch({ ...MINE, updatedAt: 800 })
  expect(await pane.find({ type: 'Text', text: /更新されました/ })).toBeDefined()
  await w.touch({ ...MINE, status: 'done', updatedAt: 900 })
  expect(await pane.find({ type: 'Text', text: /更新されました/ })).toBeUndefined()
  expect(await pane.find({ key: 'own' })).toBeUndefined()
  await pane.unmount()
  const band = await $.ui.mount({ plugin: 'nuu', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ type: 'Text', text: '在庫を数える' })).toBeDefined()
  await band.unmount()
})

test('最初の読み込みでは自分の作業の更新を知らせない', async ($, on) => {
  // 開いたペインに出ない場所へ自分の作業を置き、ペインが別の作業を出している状態で読み込ませる
  const mine = { ...MINE, dir: 'blog' }
  const w = world(on, 'S', [mine, THEIRS])
  await $.session.start(START)
  expect(w.ownToasts()).toHaveLength(0)
  await w.poll()
  expect(w.ownToasts()).toHaveLength(0)
  // 2 回目からの更新は知らせる
  await w.touch({ ...mine, updatedAt: 400 })
  expect(w.ownToasts()).toHaveLength(1)
})

test('セッションの ID を取れなければ自分の作業は無く、帯は最後に更新された作業を出す', async ($, on) => {
  world(on, null, [MINE, THEIRS])
  await $.session.start(START)
  await $.command.run(nuu(''))
  const band = await $.ui.mount({ plugin: 'nuu', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ type: 'Text', text: '在庫を数える' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '税の計算を直す' })).toBeUndefined()
  await band.unmount()
  const pane = await $.ui.mount({ plugin: 'nuu', surface: 'terminal', component: 'Pane', requestId: 'nuu', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: '在庫を数える' })).toBeDefined()
  await pane.press({ key: 'next' })
  expect(await pane.find({ key: 'own' })).toBeUndefined()
  await pane.unmount()
})

test('セッションの ID が変わると新しい ID の作業を自分の作業とし、変わった直後は知らせない', async ($, on) => {
  const w = world(on, 'S', [MINE, THEIRS])
  await $.session.start(START)
  await $.command.run(nuu(''))
  const pane = await $.ui.mount({ plugin: 'nuu', surface: 'terminal', component: 'Pane', requestId: 'nuu', props: PANE_PROPS })
  // 元のセッションの作業をはっきり選んでおく
  await pane.press({ key: 'next' })
  await pane.press({ key: 'next' })
  expect(await pane.find({ type: 'Text', text: '税の計算を直す' })).toBeDefined()

  w.state.sessionId = 'X'
  await w.touch({ ...THEIRS, updatedAt: 400 })
  expect(w.ownToasts()).toHaveLength(0)
  const band = await $.ui.mount({ plugin: 'nuu', surface: 'terminal', component: 'AbovePrompt', props: BAND_PROPS })
  expect(await band.find({ type: 'Text', text: '在庫を数える' })).toBeDefined()
  await band.unmount()
  // 変わったあとの更新は知らせる
  await w.touch({ ...THEIRS, updatedAt: 500 })
  expect(w.ownToasts()).toHaveLength(1)
  await pane.unmount()
})

test('/nuu all でも自分の作業が先頭に開き、b で戻れる', async ($, on) => {
  world(on, 'S', [MINE, THEIRS, { slug: 'blog-work', dir: 'blog', title: '記事を書く', updatedAt: 900, sessionId: 'B' }])
  await $.session.start(START)
  expect((await $.command.run(nuu('all'))).text).toContain('全プロジェクトの進行中の作業 3 件')
  const pane = await $.ui.mount({ plugin: 'nuu', surface: 'terminal', component: 'Pane', requestId: 'nuu', props: PANE_PROPS })
  expect(await pane.find({ type: 'Text', text: '税の計算を直す' })).toBeDefined()
  await pane.press({ key: 'pick-blog-blog-work' })
  expect(await pane.find({ type: 'Text', text: '記事を書く' })).toBeDefined()
  await pane.press({ key: 'own' })
  expect(await pane.find({ type: 'Text', text: '税の計算を直す' })).toBeDefined()
  await pane.unmount()
})

test('/nuu で開き直すと、別の作業を選んでいても自分の作業から開く', async ($, on) => {
  world(on, 'S', [MINE, THEIRS])
  await $.session.start(START)
  await $.command.run(nuu(''))
  const pane = await $.ui.mount({ plugin: 'nuu', surface: 'terminal', component: 'Pane', requestId: 'nuu', props: PANE_PROPS })
  await pane.press({ key: 'next' })
  expect(await pane.find({ type: 'Text', text: '在庫を数える' })).toBeDefined()
  await $.command.run(nuu(''))
  expect(await pane.find({ type: 'Text', text: '税の計算を直す' })).toBeDefined()
  expect(await pane.find({ key: 'own' })).toBeUndefined()
  await pane.unmount()
})
