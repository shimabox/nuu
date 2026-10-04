import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { NuuDashboard, NuuQuestion, NuuReview, NuuTask } from '../types'

const PANE = 'nuu'
const POLL_MS = 10_000
const DEFAULT_ACCENT = '#14B8A6'

const dashboards = atom({ plugin: 'nuu', key: 'dashboards' } as const, [])
const selected = atom({ plugin: 'nuu', key: 'selected' } as const, null)
const isBandHidden = atom({ plugin: 'nuu', key: 'isBandHidden' } as const, false)
const accent = atom({ plugin: 'nuu', key: 'accent' } as const, DEFAULT_ACCENT)
const everything = atom({ plugin: 'nuu', key: 'everything' } as const, [])
const isAll = atom({ plugin: 'nuu', key: 'isAll' } as const, false)

const TASK_ORDER = ['doing', 'waiting', 'blocked', 'todo', 'done', 'skipped']
const TASK_MARK: Record<string, string> = {
  doing: '▶',
  waiting: '…',
  blocked: '✕',
  todo: '·',
  done: '✓',
  skipped: '–',
}
const STATUS_LABEL: Record<string, string> = {
  active: '進行中',
  paused: '中断中',
  done: '完了',
}
const REVIEW_LABEL: Record<string, string> = {
  pr: 'PR',
  mr: 'MR',
  issue: 'Issue',
  release: 'リリース',
  repo: 'リポジトリ',
}

type Where = { root: string; cwd: string; names: string[] }
type Cached = { mtimeMs: number; dashboard: NuuDashboard | null }
type CachedCwd = { mtimeMs: number; cwd: string }

// 固定クライアントの置き場所。プロジェクト名が _client の作業は builder が _client-project にする
const CLIENT_DIR = '_client'

/** `window.nuuDashboardData(` 〜 `);` に包まれた JSON を取り出す */
export function parseDataJs(text: string): unknown {
  const start = text.indexOf('(')
  const end = text.lastIndexOf(')')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start + 1, end))
  } catch {
    return null
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const list = (v: unknown): Record<string, unknown>[] =>
  Array.isArray(v) ? v.filter((x): x is Record<string, unknown> => !!x && typeof x === 'object') : []

/** `(window.NUU_USAGE = ...)["<project>/<slug>"] = {...};` の右辺の JSON を取り出す */
export function parseUsageJs(text: string): unknown {
  const start = text.indexOf('= {')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(text.slice(start + 2, end + 1))
  } catch {
    return null
  }
}

export function toDashboard(raw: unknown, path: string): NuuDashboard | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  const tasks: NuuTask[] = list(d.tasks).map(t => ({
    id: typeof t.id === 'number' ? t.id : 0,
    title: str(t.title),
    status: str(t.status) || 'todo',
    note: str(t.note),
  }))
  const questions: NuuQuestion[] = list(d.questions).map(q => ({
    id: typeof q.id === 'number' ? q.id : 0,
    question: str(q.question),
    default: str(q.default),
    answer: str(q.answer),
  }))
  const blockers = (Array.isArray(d.blockers) ? d.blockers : []).map(b =>
    typeof b === 'string'
      ? b
      : str((b as Record<string, unknown>)?.title) ||
        str((b as Record<string, unknown>)?.blocker) ||
        str((b as Record<string, unknown>)?.note) ||
        JSON.stringify(b),
  )
  const reviews: NuuReview[] = list(d.reviews).map(r => ({
    kind: str(r.kind),
    number: typeof r.number === 'number' ? r.number : null,
    title: str(r.title),
    url: str(r.url),
    state: str(r.state),
  }))
  return {
    path,
    html: path.replace(/\.data\.js$/, '.html'),
    project: str(d.project),
    slug: str(d.slug),
    title: str(d.title) || str(d.slug),
    summary: str(d.summary),
    cwd: str(d.cwd),
    status: str(d.status) || 'active',
    updatedAt: typeof d.updatedAt === 'number' ? d.updatedAt : 0,
    tasks,
    questions,
    blockers,
    reviews,
  }
}

/** ダッシュボードが今のプロジェクトのものか。作業ディレクトリの包含か、プロジェクト名で判定する */
export function belongs(d: NuuDashboard, cwd: string, names: string[]): boolean {
  if (d.cwd !== '') {
    if (d.cwd === cwd || cwd.startsWith(`${d.cwd}/`) || d.cwd.startsWith(`${cwd}/`)) return true
  }
  return d.project !== '' && names.includes(d.project)
}

export function progress(tasks: NuuTask[]): { done: number; total: number } {
  const total = tasks.filter(t => t.status !== 'skipped').length
  const done = tasks.filter(t => t.status === 'done').length
  return { done, total }
}

export function bar(done: number, total: number, width: number): string {
  if (total === 0) return '░'.repeat(width)
  const filled = Math.round((done / total) * width)
  return '█'.repeat(filled) + '░'.repeat(width - filled)
}

const openQuestions = (d: NuuDashboard) => d.questions.filter(q => q.answer === '')

const STATUS_RANK: Record<string, number> = { active: 0, paused: 1, done: 2 }

/** 進行中、中断中、完了の順に、同じ状態の中は更新の新しい順に並べる */
export function sortDashboards(all: NuuDashboard[]): NuuDashboard[] {
  const rank = (d: NuuDashboard) => STATUS_RANK[d.status] ?? 1
  return [...all].sort((a, b) => rank(a) - rank(b) || b.updatedAt - a.updatedAt)
}

const basename = (p: string) => p.replace(/\/+$/, '').split('/').pop() ?? ''

async function locate($: EngineInterface): Promise<Where | null> {
  const home = await $.env.get('HOME')
  if (home === undefined) return null
  const cwd = await $.session.cwd()
  const names = [basename(cwd)]
  // worktree でも元のリポジトリ名で引けるよう、共通の .git の親フォルダー名も候補にする
  const git = await $.process
    .run(['git', 'rev-parse', '--path-format=absolute', '--git-common-dir', '--show-toplevel'])
    .catch(() => null)
  if (git && git.exitCode === 0) {
    const [common, top] = git.stdout.trim().split('\n')
    if (common) names.push(basename(common.replace(/\/\.git$/, '')))
    if (top) names.push(basename(top))
  }
  return { root: `${home}/.claude/nuu/dashboards`, cwd, names: [...new Set(names.filter(Boolean))] }
}

async function scan(
  $: EngineInterface,
  where: Where,
  cache: Map<string, Cached>,
  cwds: Map<string, CachedCwd>,
) {
  const projects = await $.fs.list(where.root).catch(() => [])
  const mine: NuuDashboard[] = []
  const every: NuuDashboard[] = []
  for (const dir of projects) {
    if (dir.kind !== 'dir' || dir.name === CLIENT_DIR) continue
    const files = await $.fs.list(`${where.root}/${dir.name}`).catch(() => [])
    const stamps = new Map(files.map(f => [f.name, f.mtimeMs]))
    for (const file of files) {
      if (!file.name.endsWith('.data.js')) continue
      const path = `${where.root}/${dir.name}/${file.name}`
      let hit = cache.get(path)
      if (!hit || hit.mtimeMs !== file.mtimeMs) {
        const text = await $.fs.read(path).catch(() => '')
        hit = { mtimeMs: file.mtimeMs, dashboard: toDashboard(parseDataJs(text), path) }
        cache.set(path, hit)
      }
      if (!hit.dashboard) continue
      // 作業ディレクトリは .data.js ではなく、同名の .usage.js に記録される
      let dashboard = hit.dashboard
      const usageName = file.name.replace(/\.data\.js$/, '.usage.js')
      const usageAt = stamps.get(usageName)
      if (dashboard.cwd === '' && usageAt !== undefined) {
        const usagePath = `${where.root}/${dir.name}/${usageName}`
        let known = cwds.get(usagePath)
        if (!known || known.mtimeMs !== usageAt) {
          const usage = parseUsageJs(await $.fs.read(usagePath).catch(() => '')) as { cwd?: unknown } | null
          known = { mtimeMs: usageAt, cwd: typeof usage?.cwd === 'string' ? usage.cwd : '' }
          cwds.set(usagePath, known)
        }
        if (known.cwd !== '') dashboard = { ...dashboard, cwd: known.cwd }
      }
      every.push(dashboard)
      if (belongs(dashboard, where.cwd, where.names)) mine.push(dashboard)
    }
  }
  return { mine: sortDashboards(mine), every: sortDashboards(every) }
}

async function readAccent($: EngineInterface, where: Where): Promise<string> {
  const text = await $.fs.read(`${where.root}/prefs.data.js`).catch(() => '')
  const prefs = parseDataJs(text) as { accent?: unknown } | null
  return typeof prefs?.accent === 'string' && /^#[0-9a-fA-F]{6}$/.test(prefs.accent)
    ? prefs.accent
    : DEFAULT_ACCENT
}

async function openInBrowser($: EngineInterface, path: string) {
  const opened = await $.process.run(['open', path]).catch(() => null)
  if (opened?.exitCode === 0) return
  const fallback = await $.process.run(['xdg-open', path]).catch(() => null)
  if (fallback?.exitCode !== 0) $.ui.toast('nuu: ブラウザで開けませんでした')
}

const cache = new Map<string, Cached>()
const cwds = new Map<string, CachedCwd>()
// 質問が増えたときだけ知らせるため、前回見た未回答の質問を覚えておく。最初の読み込みでは知らせない
let seen: Set<string> | null = null
let place: Where | null = null

async function refresh($: EngineInterface, where: Where) {
  const { mine: found, every } = await scan($, where, cache, cwds)
  const now = new Set(found.flatMap(d => openQuestions(d).map(q => `${d.path}#${q.id}`)))
  if (seen !== null) {
    const fresh = found.flatMap(d => openQuestions(d).filter(q => !seen?.has(`${d.path}#${q.id}`)))
    if (fresh.length > 0) $.ui.toast(`nuu: 新しい質問「${fresh[0]?.question ?? ''}」`, { timeoutMs: 8000 })
  }
  seen = now
  await update($, dashboards, () => found)
  await update($, everything, () => every)
  const color = await readAccent($, where)
  await update($, accent, () => color)
}

// すでに開いているペインに open を重ねても題名が変わるだけでキー入力は移らないので、閉じてから開き直す
async function openFocused($: EngineInterface) {
  const shown = (await $.ui.panes()).find(p => p.id === PANE)
  if (shown && !shown.isFocused) await $.ui.close({ id: PANE })
  await $.ui.open({ id: PANE, title: 'nuu', focus: true, closeOnEscape: true })
}

// コマンドの実行中は入力欄がキーを持っていないことがあるため、実行が終わってからもう一度キー入力を渡す
async function retryFocus($: EngineInterface) {
  const shown = (await $.ui.panes()).find(p => p.id === PANE)
  if (!shown || shown.isFocused) return
  await openFocused($)
  const again = (await $.ui.panes()).find(p => p.id === PANE)
  if (again && !again.isFocused) $.ui.toast('nuu: ctrl+x のあと tab でペインを操作できます', { timeoutMs: 6000 })
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'nuu',
      description: 'このプロジェクトの nuu ダッシュボードをペインで開く（all で全プロジェクト）',
    })
    place = await locate($)
    const where = place
    if (where) {
      await refresh($, where)
      $.clock.every(POLL_MS, () => void refresh($, where).catch(() => undefined))
    }

    return next(e)
  })

  on('command.run', { command: 'nuu' }, async ($, e) => {
    const wantsAll = e.args.trim() === 'all'
    await update($, isBandHidden, () => false)
    await update($, isAll, () => wantsAll)
    place = place ?? (await locate($))
    if (place) await refresh($, place)
    const all = wantsAll ? await read($, everything) : await read($, dashboards)
    await openFocused($)
    $.clock.after(300, () => void retryFocus($).catch(() => undefined))
    const scope = wantsAll ? '全プロジェクト' : 'このプロジェクト'

    return {
      text:
        all.length === 0
          ? `${scope}の nuu ダッシュボードはまだありません。`
          : `nuu のペインを開きました（${scope}の作業 ${all.length} 件）。`,
    }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const all = await read($, dashboards)
    const active = all.filter(d => d.status === 'active')
    const first = active[0]
    if (e.props.hasSurvey || first === undefined || (await read($, isBandHidden))) return next(e)

    const { Box, Text, Button } = $.ui.resolve(e)
    const color = await read($, accent)
    const { done, total } = progress(first.tasks)
    const asking = openQuestions(first).length
    const doing = first.tasks.find(t => t.status === 'doing')
    const width = e.props.bodyColumns

    return (
      <Box flexDirection="row" gap={1}>
        <Text color={color} bold>
          nuu
        </Text>
        <Text wrap="truncate-end">
          {first.title}
          {doing && width >= 100 ? ` ▸ ${doing.title}` : ''}
        </Text>
        <Text color={color}>{bar(done, total, 8)}</Text>
        <Text>
          {done}/{total}
        </Text>
        {asking > 0 && <Text color="yellow">質問 {asking}</Text>}
        {first.blockers.length > 0 && <Text color="red">停止 {first.blockers.length}</Text>}
        {active.length > 1 && <Text dimColor>ほか {active.length - 1} 件</Text>}
        <Button
          key="open"
          label="詳細"
          onPress={async () => {
            await update($, selected, () => first.path)
            await openFocused($)
          }}
        />
        <Button key="hide" label="隠す" plain dimColor onPress={() => update($, isBandHidden, () => true)} />
      </Box>
    )
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const { Box, Text, Button, Link } = $.ui.resolve(e)
    const showsAll = await read($, isAll)
    const all = showsAll ? await read($, everything) : await read($, dashboards)
    const color = await read($, accent)
    const want = await read($, selected)
    const d = all.find(x => x.path === want) ?? all[0]
    const width = Math.max(20, e.props.bodyColumns)

    const scopeRow = (
      <Box flexDirection="row" gap={1}>
        <Text dimColor>{showsAll ? '全プロジェクト' : 'このプロジェクト'}</Text>
        <Button
          key="scope"
          hotkey="a"
          plain
          dimColor
          label={showsAll ? '→ このプロジェクトだけ' : '→ 全プロジェクト'}
          onPress={async () => {
            await update($, selected, () => null)
            await update($, isAll, () => !showsAll)
          }}
        />
      </Box>
    )

    if (d === undefined) {
      return (
        <Box flexDirection="column">
          {scopeRow}
          <Text dimColor>{showsAll ? '全プロジェクト' : 'このプロジェクト'}の nuu ダッシュボードはまだありません。</Text>
          <Text dimColor>長い作業を始めると、ここに進み具合が出ます。</Text>
        </Box>
      )
    }

    const { done, total } = progress(d.tasks)
    const asking = openQuestions(d)
    const tasks = [...d.tasks].sort(
      (a, b) => TASK_ORDER.indexOf(a.status) - TASK_ORDER.indexOf(b.status) || a.id - b.id,
    )
    const others = all.filter(x => x.path !== d.path).slice(0, showsAll ? 12 : 6)
    const at = all.indexOf(d)
    const prev = all[(at - 1 + all.length) % all.length]
    const nextOne = all[(at + 1) % all.length]
    // 高さの限られたペインで要点が先に見えるよう、完了した手順はまとめ、質問は先頭だけを出す
    const open = tasks.filter(t => t.status !== 'done' && t.status !== 'skipped')
    const closed = tasks.filter(t => t.status === 'done' || t.status === 'skipped')
    const shownTasks = closed.length <= 3 ? tasks : open
    const shownQuestions = asking.slice(0, 2)

    return (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" gap={1} flexWrap="wrap">
          <Button key="browser" label="ブラウザで開く" hotkey="o" variant="primary" onPress={() => openInBrowser($, d.html)} />
          {all.length > 1 && prev && (
            <Button key="prev" label="◀ 前" hotkey="p" onPress={() => update($, selected, () => prev.path)} />
          )}
          {all.length > 1 && nextOne && (
            <Button key="next" label="次 ▶" hotkey="n" onPress={() => update($, selected, () => nextOne.path)} />
          )}
          <Text dimColor>
            {at + 1}/{all.length}
          </Text>
          {scopeRow}
          <Button key="close" label="閉じる" hotkey="q" role="dismiss" onPress={() => $.ui.close({ id: PANE })} />
        </Box>
        <Text dimColor>o ブラウザ・n / p 次と前・a 範囲・Tab 移動・Esc 閉じる（ペインを離れたら ctrl+x tab で戻る）</Text>
        <Box flexDirection="column">
          {showsAll && <Text dimColor>{d.project}</Text>}
          <Box flexDirection="row" gap={1}>
            <Text color={color} bold>
              {STATUS_LABEL[d.status] ?? d.status}
            </Text>
            <Text bold wrap="wrap">
              {d.title}
            </Text>
          </Box>
          {d.summary !== '' && <Text dimColor wrap="truncate-end">{d.summary}</Text>}
          <Box flexDirection="row" gap={1}>
            <Text color={color}>{bar(done, total, Math.min(30, Math.max(8, width - 20)))}</Text>
            <Text>
              {done}/{total}
            </Text>
          </Box>
        </Box>

        {asking.length > 0 && (
          <Box flexDirection="column">
            <Text color="yellow" bold>
              質問 {asking.length}
            </Text>
            {shownQuestions.map(q => (
              <Box flexDirection="column">
                <Text wrap="wrap">? {q.question}</Text>
                <Text dimColor wrap="wrap">
                  {'  '}既定: {q.default}
                </Text>
              </Box>
            ))}
            {asking.length > shownQuestions.length && (
              <Text dimColor>ほか {asking.length - shownQuestions.length} 件（ブラウザで全部見られます）</Text>
            )}
          </Box>
        )}

        {d.blockers.length > 0 && (
          <Box flexDirection="column">
            <Text color="red" bold>
              止まっているもの {d.blockers.length}
            </Text>
            {d.blockers.map(b => (
              <Text wrap="wrap">✕ {b}</Text>
            ))}
          </Box>
        )}

        <Box flexDirection="column">
          <Text bold>手順</Text>
          {shownTasks !== tasks && <Text dimColor>✓ 完了・見送り {closed.length} 件</Text>}
          {shownTasks.map(t => (
            <Box flexDirection="column">
              <Text
                wrap="wrap"
                color={t.status === 'doing' ? color : t.status === 'blocked' ? 'red' : undefined}
                dimColor={t.status === 'done' || t.status === 'skipped'}
                bold={t.status === 'doing'}
              >
                {TASK_MARK[t.status] ?? '·'} {t.id}. {t.title}
              </Text>
              {t.note !== '' && t.status === 'doing' && (
                <Text dimColor wrap="wrap">
                  {'    '}
                  {t.note}
                </Text>
              )}
            </Box>
          ))}
        </Box>

        {d.reviews.length > 0 && (
          <Box flexDirection="column">
            <Text bold>GitHub / GitLab</Text>
            {d.reviews.map(r => (
              <Box flexDirection="row" gap={1}>
                <Link
                  href={r.url}
                  label={`${REVIEW_LABEL[r.kind] ?? r.kind}${r.number === null ? '' : ` #${r.number}`}`}
                />
                <Text dimColor>{r.state}</Text>
                <Text wrap="truncate-end">{r.title}</Text>
              </Box>
            ))}
          </Box>
        )}

        {others.length > 0 && (
          <Box flexDirection="column">
            <Text dimColor>ほかの作業</Text>
            {others.map(o => {
              const p = progress(o.tasks)
              return (
                <Button
                  key={`pick-${o.project}-${o.slug}`}
                  plain
                  dimColor={o.status === 'done'}
                  label={`${o.status === 'done' ? '✓' : '▶'} ${showsAll ? `[${o.project}] ` : ''}${o.title}  ${p.done}/${p.total}`}
                  onPress={() => update($, selected, () => o.path)}
                />
              )
            })}
          </Box>
        )}
      </Box>
    )
  })
}
