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
readonly MEMORY_DIR="$TEST_HOME/.claude/agent-memory/dashboard-builder"
readonly IMPECCABLE_DIR="$REPO/vendor/impeccable/plugin/skills/impeccable"
readonly IMPECCABLE_LINK="$TEST_HOME/.claude/nuu/impeccable"

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
check '出力先は .claude-progress/index.html' body_has '.claude-progress/index.html'
check '10 秒ごとに自動で再読み込みする' body_has '<meta http-equiv="refresh" content="10">'
check '時刻は date +%s で取得する' body_has 'date +%s'
check '好みが未記録なら NEEDS_STYLE を返す' body_has 'NEEDS_STYLE'
check '好みはテーマ、密度、アクセントカラーの 3 つ' body_has '- theme: dark | light'
check '外部の CSS や JavaScript を読み込まない' body_has '外部の CSS、JavaScript、フォント、画像は読み込まない'
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
check '判断待ちでは止まらず既定の対応で続ける' rules_have '止まって待たずに'
check '取り消せない操作は既定の対応で進めない' rules_have '取り消せない操作や外部に公開される操作'

echo '== ガード =='

mkdir -p "$(dirname "$GUARD_LINK")" "$(dirname "$IMPECCABLE_LINK")" "$IMPECCABLE_DIR/reference" "$WORK_DIR/.claude-progress"
ln -s "$IMPECCABLE_DIR" "$IMPECCABLE_LINK"
ln -s "$REPO/hooks/dashboard-guard.sh" "$GUARD_LINK"
printf 'skill\n' >"$IMPECCABLE_DIR/SKILL.md"
ln -s /etc/hosts "$WORK_DIR/.claude-progress/outside"

guard_decision() {
  local tool="$1"
  local tool_input="$2"
  local output

  if ! output="$(jq -n --arg tool "$tool" --arg cwd "$WORK_DIR" --argjson input "$tool_input" \
    '{hook_event_name: "PreToolUse", tool_name: $tool, cwd: $cwd, tool_input: $input}' \
    | HOME="$TEST_HOME" "$GUARD_LINK")"; then
    echo error
  elif [[ -z "$output" ]]; then
    echo allow
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
    fail "$name（期待: $expected、結果: $got）"
  fi
}

file_input() {
  jq -n --arg path "$1" '{file_path: $path}'
}

command_input() {
  jq -n --arg command "$1" '{command: $command}'
}

expect_guard allow '.claude-progress/ に書ける' Write "$(file_input "$WORK_DIR/.claude-progress/index.html")"
expect_guard allow '.claude-progress/ を相対パスで編集できる' Edit "$(file_input .claude-progress/index.html)"
expect_guard allow '自分のメモリを読める' Read "$(file_input "$MEMORY_DIR/MEMORY.md")"
expect_guard allow '自分のメモリに ~ 付きのパスで書ける' Write "$(file_input '~/.claude/agent-memory/dashboard-builder/style.md')"
expect_guard allow 'impeccable を読める' Read "$(file_input "$IMPECCABLE_DIR/SKILL.md")"
expect_guard allow 'impeccable を ~/.claude/nuu/impeccable のリンク経由で読める' Read "$(file_input '~/.claude/nuu/impeccable/SKILL.md')"
expect_guard deny 'impeccable にリンク経由でも書けない' Write "$(file_input "$IMPECCABLE_LINK/SKILL.md")"
expect_guard deny 'impeccable には書けない' Write "$(file_input "$IMPECCABLE_DIR/SKILL.md")"
expect_guard deny '作業ディレクトリのほかのファイルは読めない' Read "$(file_input "$WORK_DIR/README.md")"
expect_guard deny '../ で .claude-progress/ の外に出られない' Read "$(file_input "$WORK_DIR/.claude-progress/../README.md")"
expect_guard deny '.claude-progress/ 内のリンクで外に出られない' Read "$(file_input "$WORK_DIR/.claude-progress/outside")"
expect_guard deny '名前が似たフォルダーには書けない' Write "$(file_input "$WORK_DIR/.claude-progress-x/index.html")"
expect_guard deny 'ほかのエージェントのメモリは読めない' Read "$(file_input "$TEST_HOME/.claude/agent-memory/other/MEMORY.md")"
expect_guard deny 'ホームのファイルは読めない' Read "$(file_input "$TEST_HOME/.ssh/id_rsa")"
expect_guard deny 'パスがなければ拒否する' Read '{}'
expect_guard allow 'date +%s を実行できる' Bash "$(command_input 'date +%s')"
expect_guard allow 'date を実行できる' Bash "$(command_input date)"
expect_guard deny 'date 以外のコマンドは実行できない' Bash "$(command_input ls)"
expect_guard deny 'date のあとに ; でつなげない' Bash "$(command_input 'date; rm -rf /tmp/x')"
expect_guard deny 'date のあとに && でつなげない' Bash "$(command_input 'date && cat ~/.ssh/id_rsa')"
expect_guard deny 'date にコマンド置換を渡せない' Bash "$(command_input 'date $(whoami)')"
expect_guard deny 'date の出力をリダイレクトできない' Bash "$(command_input 'date > .claude-progress/x')"
expect_guard allow '報告用の内部ツールは止めない' SubagentHandback '{"message": "done"}'

echo '== install.sh =='

rm -rf "$TEST_HOME/.claude" "$REPO/vendor"
mkdir -p "$TEST_HOME/.claude"
printf 'keep\n' >"$TEST_HOME/.claude/CLAUDE.md"

check 'インストールが成功する' run_install
check 'エージェント定義をリポジトリへのリンクにする' links_to "$AGENT_LINK" "$REPO/agents/dashboard-builder.md"
check 'ガードをリポジトリへのリンクにする' links_to "$GUARD_LINK" "$REPO/hooks/dashboard-guard.sh"
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
check '好みのスタイルは残す' test -f "$MEMORY_DIR/style.md"
check 'impeccable へのリンクを外す' test ! -e "$IMPECCABLE_LINK"
check '空になった ~/.claude/nuu を消す' test ! -e "$TEST_HOME/.claude/nuu"
check 'impeccable は残す' test -d "$REPO/vendor/impeccable"
check 'CLAUDE.md には触れない' grep -qxF keep "$TEST_HOME/.claude/CLAUDE.md"
check 'リンクがなくても成功する' run_uninstall

run_install
check '--purge が成功する' run_uninstall --purge
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
