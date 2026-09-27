#!/usr/bin/env bash
# nuu の仕様を確認するテスト。
# 一時ディレクトリにリポジトリを複製し、一時 HOME と偽の git で実行する。
# 実際の ~/.claude やネットワークには触れない。
#
# 仕様の確認のため、$ や ~ を含む文字列をそのまま渡す箇所がある。
# shellcheck disable=SC2016,SC2088

set -euo pipefail

ROOT="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd -P)"
readonly ROOT

TEST_ROOT="$(cd "$(mktemp -d "${TMPDIR:-/tmp}/nuu-test.XXXXXX")" && pwd -P)"
readonly TEST_ROOT
readonly REPO="$TEST_ROOT/repo"
readonly TEST_HOME="$TEST_ROOT/home"
readonly WORK_DIR="$TEST_ROOT/work"
readonly FAKE_BIN="$TEST_ROOT/bin"
readonly GIT_LOG="$TEST_ROOT/git.log"

cleanup() {
  local status=$?
  rm -rf -- "$TEST_ROOT"
  exit "$status"
}
trap cleanup EXIT

failures=0

pass() {
  printf 'PASS  %s\n' "$1"
}

fail() {
  printf 'FAIL  %s\n' "$1"
  failures=$((failures + 1))
}

check() {
  local name="$1"
  shift
  if "$@"; then
    pass "$name"
  else
    fail "$name"
  fi
}

# シェル関数も渡せるよう、別プロセスではなくこのシェルで失敗を確かめる。
fails() {
  ! "$@"
}

# 複製したリポジトリ、一時 HOME、偽の git を用意する。
mkdir -p "$REPO" "$TEST_HOME" "$WORK_DIR" "$FAKE_BIN"
cp -R "$ROOT/agents" "$ROOT/hooks" "$ROOT/install.sh" "$ROOT/uninstall.sh" "$ROOT/claude-instructions.md" "$REPO/"

# shellcheck disable=SC2016 # 生成先のスクリプトで展開する。
printf '%s\n' \
  '#!/bin/sh' \
  'printf "%s\n" "$*" >>"$FAKE_GIT_LOG"' \
  'if [ "$1" = clone ]; then' \
  '  for last in "$@"; do :; done' \
  '  mkdir -p "$last/.git"' \
  'fi' \
  >"$FAKE_BIN/git"
chmod +x "$FAKE_BIN/git"

# 結果を読みやすくするため、スクリプト自体の出力は捨てる。
run_install() {
  HOME="$TEST_HOME" FAKE_GIT_LOG="$GIT_LOG" PATH="$FAKE_BIN:$PATH" "$REPO/install.sh" >/dev/null 2>&1
}

run_uninstall() {
  HOME="$TEST_HOME" "$REPO/uninstall.sh" "$@" >/dev/null 2>&1
}

links_to() {
  [[ -L "$1" && "$(readlink "$1")" == "$2" ]]
}

readonly AGENT_LINK="$TEST_HOME/.claude/agents/dashboard-builder.md"
readonly GUARD_LINK="$TEST_HOME/.claude/hooks/dashboard-guard.sh"
readonly USAGE_LINK="$TEST_HOME/.claude/hooks/dashboard-usage.py"
readonly MEMORY_DIR="$TEST_HOME/.claude/agent-memory/dashboard-builder"
readonly IMPECCABLE_DIR="$REPO/vendor/impeccable/plugin/skills/impeccable"
readonly IMPECCABLE_LINK="$TEST_HOME/.claude/nuu/impeccable"
readonly DASH_DIR="$TEST_HOME/.claude/nuu/dashboards"

echo '== エージェント定義 =='

agent="$REPO/agents/dashboard-builder.md"
frontmatter="$(awk '/^---$/ { n++; next } n == 1' "$agent")"
body="$(awk '/^---$/ { n++; next } n >= 2' "$agent")"

has_line() {
  grep -qxF -- "$1" <<<"$frontmatter"
}

body_has() {
  grep -qF -- "$1" <<<"$body"
}

check '名前は dashboard-builder' has_line 'name: dashboard-builder'
check 'モデルは opus' has_line 'model: opus'
check 'effort は medium' has_line 'effort: medium'
check 'メモリはユーザー単位' has_line 'memory: user'
check '使えるツールは Read, Write, Edit, Bash だけ' has_line 'tools: Read, Write, Edit, Bash'
check 'frontend-design をプリロードする' has_line '  - frontend-design:frontend-design'
check 'design-artifact をプリロードする' has_line '  - plannotator-effective-html:design-artifact'
check 'dataviz をプリロードする' has_line '  - dataviz'
check 'impeccable はプリロードしない（全体のスキルとして登録しないため）' \
  fails grep -q impeccable <<<"$frontmatter"
check 'ガードはファイル操作と Bash にだけ掛ける（報告用の内部ツールを止めない）' \
  has_line '    - matcher: "Read|Write|Edit|Bash"'
check 'ガードは ~/.claude/hooks のリンクから呼ぶ' \
  has_line "          command: \"\\\"\$HOME/.claude/hooks/dashboard-guard.sh\\\"\""
check '作業ごとに ~/.claude/nuu/dashboards/ の下へ 1 ファイル作る' body_has '`~/.claude/nuu/dashboards/<プロジェクト名>/<開始日時>-<作業名>.html`'
check 'ほかの作業のファイルは上書きしない' body_has 'ほかの作業のファイルは上書きしない'
check 'update と finish は渡されたパスのファイルだけを更新する' body_has 'update と finish では、呼び出し元から渡されたパスのファイルだけを更新する'
check 'パスがなければ既存のファイルを推測で選ばない' body_has 'パスが渡されていなければ、推測で既存のファイルを選ばず'
check 'ダッシュボードを書いたあとにトークン量を集計する' has_line '    - matcher: "Write|Edit"'
check '集計は ~/.claude/hooks のリンクから呼ぶ' \
  has_line "          command: \"\\\"\$HOME/.claude/hooks/dashboard-usage.py\\\"\""
check 'トークン量のファイルは作らず編集もしない' body_has '`.usage.js` は作らない、編集しない。トークン量を推測して書かない'
check 'トークン量は作業ごとのキーで読む' body_has 'window.NUU_USAGE["<プロジェクト名>/<作業名>"]'
check 'トークン量は目安と注記する' body_has '目安です。サブエージェントの出力トークンは少なめに出ることがあります'
check '一覧でも作業ごとの合計を表示する' body_has '一覧では、各作業の `.usage.js` を script 要素で読み込み'
check '全体の一覧を更新する' body_has '全体の一覧 `~/.claude/nuu/dashboards/index.html` を、setup、update、finish のたびに更新する'
check '一覧ではこの作業の行だけを変える' body_has 'この作業の行だけを追加・更新する。ほかの作業の行は変えない'
check '一覧では更新が止まった作業を目立たせる' body_has '進行中なのに 15 分以上更新がない作業は'
check 'setup の返答でダッシュボードのパスを返す' body_has '以後の update と finish でこのパスを渡す'
check '作業ディレクトリにはダッシュボードを作らない' fails grep -q 'claude-progress' <<<"$body"
check '10 秒ごとに自動で再読み込みする' body_has '<meta http-equiv="refresh" content="10">'
check '時刻は date +%s で取得する' body_has 'date +%s'
check '好みが未記録なら NEEDS_STYLE を返す' body_has 'NEEDS_STYLE'
check '初回に聞く好みはテーマ、密度、アクセントカラーの 3 つ' body_has '- theme: dark | light'
check 'タスクの表示は聞かず、既定はカンバン' body_has 'タスクの表示（kanban | list）は NEEDS_STYLE で聞かない。記録がなければ kanban にする'
check 'カンバンでは状態ごとの列にタスクを並べる' body_has 'kanban: 状態ごとの列（未着手 / 進行中 / 待ち / 停止 / 完了）'
check 'タスクの表示は作業によって変えない' body_has 'タスクの表示だけは好みに従い、作業によって変えない'
check 'NEEDS_STYLE ではタスクの表示を聞かない' fails grep -q -- '- layout' <<<"$body"
check '好みの変更を受け取ったら上書きする' body_has '利用者から変更の指示が渡されたら上書きする'
check '利用者の答えとして渡された好みだけを保存する' body_has '「利用者の答え」としてスタイルが渡されたら、`style.md` に保存し'
check '今回だけの好みは保存しない' body_has '「今回だけ」としてスタイルが渡されたら、そのダッシュボードにだけ使い、メモリには保存しない'
check 'どちらか示されていなければ保存しない' body_has '示されていなければ、今回だけとして扱う'
check 'update と finish では好みを聞き直さない' body_has 'update と finish では NEEDS_STYLE を返さない'
check '外部の CSS や JavaScript を読み込まない' body_has '外部の CSS、JavaScript、フォント、画像は読み込まない'
check 'スマホの幅に合わせる viewport を入れる' body_has '<meta name="viewport" content="width=device-width, initial-scale=1">'
check '幅 360px でも横にはみ出さない' body_has '幅 360px でも、ページ全体が横にはみ出さない'
check '狭い画面ではカンバンの列を縦に積む' body_has 'カンバンは、狭い画面では列を縦に積む'
check '狭い画面では質問と止まっているものを一番上に置く' body_has '未回答の質問と止まっているものを一番上に置く'
check 'ホバーでしか見えない情報を作らない' body_has 'ホバーでしか見えない情報を作らない'
check '狭い画面では表を使わずカードにする' body_has '狭い画面では表を使わない。'
check '時刻や件数を途中で折り返さない' body_has '時刻、件数、進み具合（3 / 8 など）は途中で折り返さない'
check 'テンプレートを使い回さない' body_has 'テンプレートを使い回さない'
for section in 'タスクと状態' '利用者への質問' '最新の成果物' '止まっているもの'; do
  check "必ず載せる内容に「${section}」がある" body_has "$section"
done
check 'impeccable のランチャーは実行しない' body_has 'ランチャー（`scripts/impeccable`）は実行しない'
check 'impeccable は clone した場所に関係なく ~/.claude/nuu/impeccable から読む' body_has '`~/.claude/nuu/impeccable/`'
for file in agents/dashboard-builder.md hooks/dashboard-guard.sh install.sh uninstall.sh claude-instructions.md; do
  check "${file} に利用者固有のパスを書かない" fails grep -qE '/Users/|/home/|shimabox/github' "$REPO/$file"
done

echo '== CLAUDE.md に追記するルール =='

rules="$(cat "$REPO/claude-instructions.md")"

rules_have() {
  grep -qF -- "$1" <<<"$rules"
}

check 'dashboard-builder が使えるときだけ適用する' rules_have 'dashboard-builder` サブエージェントが使えるときに適用する'
check '5 ステップ超か 30 分超の作業で着手前に用意する' rules_have '5 ステップを超える作業、または 30 分を超えそうな作業では、着手前に'
check '1 ステップごとに更新する' rules_have '1 ステップ終えるごとに'
check 'NEEDS_STYLE なら利用者に好みを聞く' rules_have 'NEEDS_STYLE` を返したら、AskUserQuestion で'
check '利用者の答えは「利用者の答え」として渡す' rules_have '答えを「利用者の答え」として渡して呼び直す'
check '聞けないときは好みを決めず「今回だけ」として渡す' rules_have '仮の好みを「今回だけ」として渡す'
check '用意するときに作業ディレクトリを渡す' rules_have '用意するときは、作業ディレクトリ、'
check 'ダッシュボードのパスを覚えて更新のたびに渡す' rules_have '作業ごとのダッシュボードのパスは覚えておき、以後の更新と完了のたびに'
check '途中の更新は待たずに次の手順へ進む' rules_have '途中の更新はバックグラウンドで呼び、完了を待たずに次の手順へ進む'
check '用意は完了を待つ' rules_have '用意（setup）は返ってくるパスが必要なので、完了を待つ'
check '同じダッシュボードを同時に更新させない' rules_have '同じダッシュボードを同時に更新させない'
check '完了の更新は待ってから報告する' rules_have '終わるのを待ってから利用者に報告する'
check '好みの変更を求められたら dashboard-builder に渡す' rules_have '好み（テーマ、密度、アクセントカラー、タスクの表示）の変更を求めたら、新しい好みを「利用者の答え」として `dashboard-builder` に渡す'
check '判断待ちでは止まらず既定の対応で続ける' rules_have '止まって待たずに'
check '取り消せない操作は既定の対応で進めない' rules_have '取り消せない操作や外部に公開される操作'

echo '== ガード =='

mkdir -p "$(dirname "$GUARD_LINK")" "$DASH_DIR/project" "$IMPECCABLE_DIR/reference"
ln -s "$IMPECCABLE_DIR" "$IMPECCABLE_LINK"
ln -s "$REPO/hooks/dashboard-guard.sh" "$GUARD_LINK"
printf 'skill\n' >"$IMPECCABLE_DIR/SKILL.md"
ln -s /etc/hosts "$DASH_DIR/outside"

guard_decision() {
  local tool="$1"
  local tool_input="$2"
  local output

  if ! output="$(jq -n --arg tool "$tool" --arg cwd "$WORK_DIR" --argjson input "$tool_input" \
    '{hook_event_name: "PreToolUse", tool_name: $tool, cwd: $cwd, tool_input: $input}' \
    | HOME="$TEST_HOME" "$GUARD_LINK")"; then
    echo error
  elif [[ -z "$output" ]]; then
    echo none
  else
    jq -r '.hookSpecificOutput.permissionDecision' <<<"$output"
  fi
}

expect_guard() {
  local expected="$1"
  local name="$2"
  local got

  got="$(guard_decision "$3" "$4")"
  if [[ "$got" == "$expected" ]]; then
    pass "$name"
  else
    fail "${name}（期待: ${expected}、結果: ${got}）"
  fi
}

file_input() {
  jq -n --arg path "$1" '{file_path: $path}'
}

command_input() {
  jq -n --arg command "$1" '{command: $command}'
}

expect_guard allow 'ダッシュボードに書ける' Write "$(file_input "$DASH_DIR/project/2026-09-27-1043-task.html")"
expect_guard allow '一覧を ~ 付きのパスで編集できる' Edit "$(file_input '~/.claude/nuu/dashboards/index.html')"
expect_guard allow 'ダッシュボードを読める' Read "$(file_input "$DASH_DIR/index.html")"
expect_guard allow '自分のメモリを読める' Read "$(file_input "$MEMORY_DIR/MEMORY.md")"
expect_guard allow '自分のメモリに ~ 付きのパスで書ける' Write "$(file_input '~/.claude/agent-memory/dashboard-builder/style.md')"
expect_guard allow 'impeccable を読める' Read "$(file_input "$IMPECCABLE_DIR/SKILL.md")"
expect_guard allow 'impeccable を ~/.claude/nuu/impeccable のリンク経由で読める' Read "$(file_input '~/.claude/nuu/impeccable/SKILL.md')"
expect_guard deny 'impeccable にリンク経由でも書けない' Write "$(file_input "$IMPECCABLE_LINK/SKILL.md")"
expect_guard deny 'impeccable には書けない' Write "$(file_input "$IMPECCABLE_DIR/SKILL.md")"
expect_guard deny '作業ディレクトリには書けない' Write "$(file_input "$WORK_DIR/.claude-progress/index.html")"
expect_guard deny '作業ディレクトリのファイルは相対パスでも読めない' Read "$(file_input README.md)"
expect_guard deny '../ でダッシュボードの外に出られない' Read "$(file_input "$DASH_DIR/../../settings.json")"
expect_guard deny 'ダッシュボード内のリンクで外に出られない' Read "$(file_input "$DASH_DIR/outside")"
expect_guard deny '名前が似たフォルダーには書けない' Write "$(file_input "$TEST_HOME/.claude/nuu/dashboards-x/index.html")"
expect_guard deny 'ほかのエージェントのメモリは読めない' Read "$(file_input "$TEST_HOME/.claude/agent-memory/other/MEMORY.md")"
expect_guard deny 'ホームのファイルは読めない' Read "$(file_input "$TEST_HOME/.ssh/id_rsa")"
expect_guard deny 'パスがなければ拒否する' Read '{}'
expect_guard allow 'date +%s を実行できる' Bash "$(command_input 'date +%s')"
expect_guard allow 'date を実行できる' Bash "$(command_input date)"
expect_guard allow 'ファイル名用の日時を取得できる' Bash "$(command_input 'date +%Y-%m-%d-%H%M')"
expect_guard deny 'date 以外のコマンドは実行できない' Bash "$(command_input ls)"
expect_guard deny 'date のあとに ; でつなげない' Bash "$(command_input 'date; rm -rf /tmp/x')"
expect_guard deny 'date のあとに && でつなげない' Bash "$(command_input 'date && cat ~/.ssh/id_rsa')"
expect_guard deny 'date にコマンド置換を渡せない' Bash "$(command_input 'date $(whoami)')"
expect_guard deny 'date の出力をリダイレクトできない' Bash "$(command_input 'date > ~/.claude/nuu/dashboards/x')"
expect_guard none '報告用の内部ツールには口を出さない' SubagentHandback '{"message": "done"}'

echo '== トークン量の集計 =='

ln -s "$REPO/hooks/dashboard-usage.py" "$USAGE_LINK"
readonly PROJECTS="$TEST_ROOT/projects/work"
readonly SESSION="$PROJECTS/session"
readonly MAIN_LOG="$PROJECTS/session.jsonl"
mkdir -p "$SESSION/subagents"

# 応答 1 行を作る。同じ id の行は、書き出し途中の値と確定した値を表す。
log_line() {
  jq -cn --arg ts "$1" --arg id "$2" --argjson input "$3" --argjson output "$4" \
    --argjson read "$5" --argjson write "$6" \
    '{type: "assistant", timestamp: $ts, message: {id: $id, model: "claude-test",
      usage: {input_tokens: $input, output_tokens: $output,
        cache_read_input_tokens: $read, cache_creation_input_tokens: $write}}}'
}

{
  log_line 2026-09-27T01:59:00.000Z before 999 999 999 999
  log_line 2026-09-27T02:00:10.000Z main-1 10 5 1000 50
  log_line 2026-09-27T02:00:11.000Z main-1 10 100 1000 50
} >"$MAIN_LOG"
{
  jq -cn '{type: "user", timestamp: "2026-09-27T02:00:00.000Z"}'
  log_line 2026-09-27T02:00:01.000Z board-1 2 7 500 0
} >"$SESSION/subagents/agent-setup.jsonl"
printf '{"agentType":"dashboard-builder"}\n' >"$SESSION/subagents/agent-setup.meta.json"
log_line 2026-09-27T02:00:05.000Z other-1 3 30 0 0 >"$SESSION/subagents/agent-other.jsonl"
printf '{"agentType":"Explore"}\n' >"$SESSION/subagents/agent-other.meta.json"

run_usage() {
  jq -n --arg tool "$1" --arg path "$2" --arg log "$MAIN_LOG" \
    '{tool_name: $tool, transcript_path: $log, agent_id: "setup", session_id: "session", tool_input: {file_path: $path}}' \
    | HOME="$TEST_HOME" "$USAGE_LINK"
}

usage_of() {
  sed -n 2p "$DASH_DIR/project/task.usage.js" | sed 's/^.*\] = {/{/; s/;$//' | jq -r "$1"
}

expect_usage() {
  local got

  got="$(usage_of "$2")"
  if [[ "$got" == "$3" ]]; then
    pass "$1"
  else
    fail "${1}（期待: ${3}、結果: ${got}）"
  fi
}

check '作業ごとのダッシュボードを書いたら集計が成功する' run_usage Write "$DASH_DIR/project/task.html"
check '集計結果をダッシュボードの隣に書く' test -f "$DASH_DIR/project/task.usage.js"
check '作業ごとのキーで書く' grep -qF '["project/task"]' "$DASH_DIR/project/task.usage.js"
expect_usage '用意を始めた時刻から数える' '.since | todate' 2026-09-27T02:00:00Z
expect_usage '同じ応答は最大値で 1 回だけ数える' '.byCategory.main.total' 1160
expect_usage '用意より前の応答は数えない' '.byCategory.main.input' 10
expect_usage 'dashboard-builder の分を分けて数える' '.byCategory.dashboard.total' 509
expect_usage 'ほかのサブエージェントの分を分けて数える' '.byCategory.subagents.total' 33
expect_usage '合計を出す' '.totals.total' 1702
expect_usage '種類ごとに合計する' '[.totals.input, .totals.output, .totals.cacheRead, .totals.cacheWrite] | join(",")' 15,137,1500,50
expect_usage 'モデルごとに合計する' '.byModel["claude-test"]' 1702

log_line 2026-09-27T02:00:20.000Z main-2 5 5 0 0 >>"$MAIN_LOG"
rm "$SESSION/subagents/agent-setup.jsonl"
check '2 回目の集計が成功する' run_usage Edit "$DASH_DIR/project/task.html"
expect_usage '2 回目も用意を始めた時刻を保つ' '.since | todate' 2026-09-27T02:00:00Z
expect_usage '2 回目は増えた分を足す' '.byCategory.main.total' 1170

check '一覧を書いても成功する' run_usage Write "$DASH_DIR/index.html"
check '一覧のトークン量は作らない' test ! -e "$DASH_DIR/index.usage.js"
check 'メモリを書いても成功する' run_usage Write "$MEMORY_DIR/style.md"
check 'メモリのトークン量は作らない' test ! -e "$MEMORY_DIR/style.usage.js"
check '壊れた入力でも作業を止めない' bash -c '"$1" <<<"not json" 2>/dev/null' _ "$USAGE_LINK"

echo '== install.sh =='

rm -rf "$TEST_HOME/.claude" "$REPO/vendor"
mkdir -p "$TEST_HOME/.claude"
printf 'keep\n' >"$TEST_HOME/.claude/CLAUDE.md"

check 'インストールが成功する' run_install
check 'エージェント定義をリポジトリへのリンクにする' links_to "$AGENT_LINK" "$REPO/agents/dashboard-builder.md"
check 'ガードをリポジトリへのリンクにする' links_to "$GUARD_LINK" "$REPO/hooks/dashboard-guard.sh"
check '集計スクリプトをリポジトリへのリンクにする' links_to "$USAGE_LINK" "$REPO/hooks/dashboard-usage.py"
check 'impeccable を sparse clone で取得する' \
  grep -qxF "clone --quiet --filter=blob:none --sparse --no-checkout https://github.com/pbakaus/impeccable.git $REPO/vendor/impeccable" "$GIT_LOG"
check 'impeccable はスキル部分だけを取り出す' \
  grep -qxF -- "-C $REPO/vendor/impeccable sparse-checkout set --no-cone /plugin/skills/impeccable/" "$GIT_LOG"
check 'impeccable は固定した版を使う' \
  grep -qxF -- "-C $REPO/vendor/impeccable -c advice.detachedHead=false checkout --quiet skill-v4.3.1" "$GIT_LOG"
check 'impeccable を ~/.claude/nuu/impeccable にリンクする' links_to "$IMPECCABLE_LINK" "$IMPECCABLE_DIR"
check '2 回目も成功する' run_install
check '2 回目は固定した版だけを取得する' grep -qxF -- "-C $REPO/vendor/impeccable fetch --quiet origin tag skill-v4.3.1" "$GIT_LOG"
check 'CLAUDE.md には触れない' grep -qxF keep "$TEST_HOME/.claude/CLAUDE.md"

rm "$AGENT_LINK"
printf 'mine\n' >"$AGENT_LINK"
check '既存のファイルがあれば失敗する' fails run_install
check '既存のファイルは上書きしない' grep -qxF mine "$AGENT_LINK"
rm "$AGENT_LINK"
run_install

echo '== uninstall.sh =='

mkdir -p "$MEMORY_DIR"
printf 'style\n' >"$MEMORY_DIR/style.md"

check 'アンインストールが成功する' run_uninstall
check 'エージェント定義のリンクを外す' test ! -e "$AGENT_LINK"
check 'ガードのリンクを外す' test ! -e "$GUARD_LINK"
check '集計スクリプトのリンクを外す' test ! -e "$USAGE_LINK"
check '好みのスタイルは残す' test -f "$MEMORY_DIR/style.md"
check 'impeccable へのリンクを外す' test ! -e "$IMPECCABLE_LINK"
check '空になった ~/.claude/nuu を消す' test ! -e "$TEST_HOME/.claude/nuu"
check 'impeccable は残す' test -d "$REPO/vendor/impeccable"
check 'CLAUDE.md には触れない' grep -qxF keep "$TEST_HOME/.claude/CLAUDE.md"
check 'リンクがなくても成功する' run_uninstall

run_install
mkdir -p "$DASH_DIR/project"
printf 'board\n' >"$DASH_DIR/project/task.html"
check 'ダッシュボードがあってもアンインストールが成功する' run_uninstall
check 'ダッシュボードは残す' test -f "$DASH_DIR/project/task.html"

run_install
check '--purge が成功する' run_uninstall --purge
check '--purge でダッシュボードを消す' test ! -e "$DASH_DIR"
check '--purge で空になった ~/.claude/nuu を消す' test ! -e "$TEST_HOME/.claude/nuu"
check '--purge でリンクを外す' test ! -e "$AGENT_LINK"
check '--purge で好みのスタイルを消す' test ! -e "$MEMORY_DIR"
check '--purge で impeccable を消す' test ! -e "$REPO/vendor/impeccable"
check '--purge でもリポジトリは残す' test -f "$REPO/agents/dashboard-builder.md"

printf 'mine\n' >"$AGENT_LINK"
check '別のファイルがあっても成功する' run_uninstall
check '別のファイルは消さない' grep -qxF mine "$AGENT_LINK"

set +e
run_uninstall --unknown
status=$?
set -e
check '知らない引数は終了コード 2 で止まる' test "$status" -eq 2

echo
if ((failures > 0)); then
  printf '%d 件失敗しました。\n' "$failures"
  exit 1
fi
echo 'すべて成功しました。'
