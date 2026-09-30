#!/usr/bin/env bash
# nuu の仕様を確認するテスト。
# 一時ディレクトリにリポジトリを複製し、一時 HOME で実行する。git が呼ばれたら記録する。
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

# 複製したリポジトリと一時 HOME を用意する。install.sh が git を呼ばないことを確かめるため、
# 呼ばれたら記録するだけの git を PATH の先頭に置く。
mkdir -p "$REPO" "$TEST_HOME" "$WORK_DIR" "$FAKE_BIN"
cp -R "$ROOT/agents" "$ROOT/client" "$ROOT/hooks" "$ROOT/install.sh" "$ROOT/uninstall.sh" "$ROOT/claude-instructions.md" "$REPO/"

# shellcheck disable=SC2016 # 生成先のスクリプトで展開する。
printf '%s\n' \
  '#!/bin/sh' \
  'printf "%s\n" "$*" >>"$FAKE_GIT_LOG"' \
  >"$FAKE_BIN/git"
chmod +x "$FAKE_BIN/git"

# 結果を読みやすくするため、スクリプト自体の出力は捨てる。
run_install() {
  HOME="$TEST_HOME" FAKE_GIT_LOG="$GIT_LOG" PATH="$FAKE_BIN:$PATH" "$REPO/install.sh" "$@" >/dev/null 2>&1
}

# 出力を確かめたいときに使う。標準出力と標準エラーをまとめて返す。
install_output() {
  HOME="$TEST_HOME" FAKE_GIT_LOG="$GIT_LOG" PATH="$FAKE_BIN:$PATH" "$REPO/install.sh" "$@" 2>&1 || true
}

uninstall_output() {
  HOME="$TEST_HOME" "$REPO/uninstall.sh" 2>&1 || true
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
readonly VALIDATE_LINK="$TEST_HOME/.claude/hooks/dashboard-validate.py"
readonly UPDATER_LINK="$TEST_HOME/.claude/agents/dashboard-updater.md"
readonly RULES_LINK="$TEST_HOME/.claude/nuu/claude-instructions.md"
readonly CLAUDE_MD="$TEST_HOME/.claude/CLAUDE.md"
readonly IMPORT_LINE='@~/.claude/nuu/claude-instructions.md'
readonly MEMORY_DIR="$TEST_HOME/.claude/agent-memory/dashboard-builder"
readonly DASH_DIR="$TEST_HOME/.claude/nuu/dashboards"
readonly CLIENT_LINK="$DASH_DIR/_client"
readonly PAGE_LINK="$TEST_HOME/.claude/hooks/dashboard-page.py"

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
check 'effort は low' has_line 'effort: low'
check '使えるツールは Read, Write, Edit, Bash だけ' has_line 'tools: Read, Write, Edit, Bash'
check 'メモリを使わない（好みは prefs.data.js に置く）' fails grep -q '^memory:' <<<"$frontmatter"
check 'デザインのスキルを読み込まない' fails grep -q '^skills:' <<<"$frontmatter"
check 'impeccable を使わない' fails grep -qi impeccable "$agent"
check 'builder は途中の更新と完了を updater に任せる' has_line 'description: 長い作業の進捗ダッシュボード（~/.claude/nuu/dashboards/ の作業ごとのページと、全体の一覧）を用意する専用エージェント。5 ステップを超える作業や 30 分を超えそうな作業の着手前、好みのスタイルの変更、構成の見直しに使う。途中の更新と完了は dashboard-updater が行う。'
check 'ガードはファイル操作と Bash にだけ掛ける（報告用の内部ツールを止めない）' \
  has_line '    - matcher: "Read|Write|Edit|Bash"'
check 'ガードは ~/.claude/hooks のリンクから呼ぶ' \
  has_line "          command: \"\\\"\$HOME/.claude/hooks/dashboard-guard.sh\\\"\""
check '書いたあとにフックを動かす' has_line '    - matcher: "Write|Edit"'
check '書いたあとにデータを確かめる' \
  has_line "          command: \"\\\"\$HOME/.claude/hooks/dashboard-validate.py\\\"\""
check '書いたあとにスタブと一覧を作る' \
  has_line "          command: \"\\\"\$HOME/.claude/hooks/dashboard-page.py\\\"\""
check '書いたあとにトークン量を集計する' \
  has_line "          command: \"\\\"\$HOME/.claude/hooks/dashboard-usage.py\\\"\""
check 'ページ、一覧のデータ、トークン量はフックに任せて書かない' \
  body_has 'ページ（`.html`）、一覧のデータ（`index.data.js`）、トークン量（`.usage.js`）はフックが作るので、書かない'
check '作業ごとに ~/.claude/nuu/dashboards/ の下へデータを 1 つ作る' \
  body_has '作業のデータは `~/.claude/nuu/dashboards/<プロジェクト名>/<開始日時>-<作業名>.data.js` に置く'
check 'ほかの作業のファイルは上書きしない' body_has 'ほかの作業のファイルは上書きしない'
check 'プロジェクト名が _client のときは _client-project にする' \
  body_has '作業ディレクトリの名前が `_client` のときは `_client-project` にする'
check 'プロジェクト名の先頭の . は外す' body_has '先頭の `.` は外す'
check 'project と slug をパスに合わせる' body_has '`project` にはプロジェクト名、`slug` にはファイル名から `.data.js` を除いたものを書く'
check 'update と finish は渡されたパスのデータだけを更新する' body_has '渡されたパスのデータだけを更新する'
check 'パスがなければ既存のファイルを推測で選ばない' body_has 'パスが渡されていなければ、推測で既存のファイルを選ばず'
check '好みは全体で 1 つの prefs.data.js に置く' body_has '好みは全体で 1 つの `~/.claude/nuu/dashboards/prefs.data.js` に置く'
check 'setup では最初に好みを 1 回読む' body_has 'setup では、最初に `prefs.data.js` を 1 回 Read する'
check '好みがなく、渡されてもいなければ NEEDS_STYLE を返す' \
  body_has 'ファイルがなく、呼び出し元から好みも「好みを聞けない」も渡されていなければ、何も書かずに次の形式だけを返して終える'
check '初回に聞く好みはテーマ、密度、アクセントカラーの 3 つ' body_has '- theme: dark | light'
check 'NEEDS_STYLE ではタスクの表示を聞かない' fails grep -q -- '- taskView' <<<"$body"
check '利用者の答えは prefs.data.js に書く' body_has '「利用者の答え」として好みが渡されたら、`prefs.data.js` に書いてから続ける'
check 'タスクの表示の既定はカンバン' body_has 'ファイルもなければ、`taskView` は `kanban` にする'
check '好みを聞けないときは何も保存しない' body_has '「好みを聞けない」と渡されたら、好みを決めず、何も保存しない'
check '「今回だけ」の好みはない' fails grep -q '今回だけ' <<<"$body"
check '色の名前は 16 進に直す' body_has '色の名前（teal など）を渡されたら、近い 16 進の値に直す'
check '好みの変更は prefs.data.js だけを書き換える' body_has '好みの変更: `prefs.data.js` だけを書き換える'
check '時刻は date +%s で取得する' body_has '`date +%s` で取った実際の時刻（UNIX 秒）を使う'
check 'データファイルは決まった呼び出しの間に JSON だけを書く' body_has '1 行目を `window.nuuDashboardData(`、最終行を `);` にし、その間に JSON だけを書く'
for type in progress grid table keyvalue text trend flow; do
  check "パネルの種類 ${type} を示す" body_has "| \`${type}\` |"
done
check 'state の語彙を示す' body_has '`state` は `todo | doing | waiting | blocked | done | failed`'
check '収まらない内容は table か text で表す' body_has '7 種に収まらない内容は `table` か `text` で表す'
check 'テンプレートを使い回さない' body_has 'テンプレートを使い回さない'
check '手順のカンバンと同じことを別のパネルに書かない' body_has '手順のカンバンと同じことを別のパネルに書かない'
check 'flow は手順の並びをなぞらない' body_has '`flow` は手順の並びをなぞらない'
check '渡されていない進捗や数値は作らない' body_has '呼び出し元から渡されていない進捗や数値は作らない'
check '確かめるために読み直さない' body_has '確かめるために読み直さない'
check 'setup でスタブができたかを 1 回確かめる' body_has '同じ名前の `.html` を 1 回 Read して、フックがページを置いたかを確かめる'
check 'スタブがなければその旨を返す' body_has 'ページ（.html）ができていません'
check 'setup の返答でダッシュボードのパスを返す' body_has '以後の update と finish でこのパスを渡す'
check '作業ディレクトリにはダッシュボードを作らない' fails grep -q 'claude-progress' <<<"$body"
check 'setup で渡された PR / MR を reviews に書く' body_has '作業に関係する PR / MR が渡されたら `reviews` に書く'
check 'builder の例に PR / MR（reviews）が入っている' body_has '  "reviews": ['
check 'reviews は省略できる' body_has '`note` と `reviews` は省略できる'
check 'PR / MR の kind は provider で決まる' body_has '`kind` は、`github` なら `pr`、`gitlab` なら `mr` に限る'
check 'PR / MR の状態の語彙を示す' body_has '`state` は `draft`（下書き）、`open`（レビュー中）、`merged`（マージ済み）、`closed`（閉じた）'
check 'PR / MR の url は https:// だけ' body_has '`url` は `https://` で始まるものだけを書ける'
check '同じ url の PR / MR は 1 つだけ' body_has '同じ `url` の要素は 1 つだけにする'
check 'PR / MR の上限を示す（20 件、題名 200 字、url 500 字）' body_has '上限: 20 件、題名 200 字、`url` 500 字'
check 'ページは PR / MR の状態を取りにいかない' body_has 'ページは PR / MR の状態を取りにいかないので、渡された値だけを載せる'

echo '== 更新専用エージェントの定義 =='

updater="$REPO/agents/dashboard-updater.md"
updater_frontmatter="$(awk '/^---$/ { n++; next } n == 1' "$updater")"
updater_body="$(awk '/^---$/ { n++; next } n >= 2' "$updater")"

updater_line() {
  grep -qxF -- "$1" <<<"$updater_frontmatter"
}

updater_says() {
  grep -qF -- "$1" <<<"$updater_body"
}

check 'updater の名前は dashboard-updater' updater_line 'name: dashboard-updater'
check 'updater のモデルは sonnet' updater_line 'model: sonnet'
check 'updater の effort は low' updater_line 'effort: low'
check 'updater は Write を使えない' updater_line 'tools: Read, Edit, Bash'
check 'updater はデザインのスキルを読み込まない' fails grep -q '^skills:' <<<"$updater_frontmatter"
check 'updater はメモリを使わない' fails grep -q '^memory:' <<<"$updater_frontmatter"
check 'updater もガードを通す' updater_line '    - matcher: "Read|Write|Edit|Bash"'
check 'updater は書いたあとにデータを確かめる' updater_line "          command: \"\\\"\$HOME/.claude/hooks/dashboard-validate.py\\\"\""
check 'updater の書き込みでも一覧を作り直す' updater_line "          command: \"\\\"\$HOME/.claude/hooks/dashboard-page.py\\\"\""
check 'updater の分もトークン量を集計する' updater_line "          command: \"\\\"\$HOME/.claude/hooks/dashboard-usage.py\\\"\""
check 'updater はデータファイルの JSON だけを書き換える' updater_says '`window.nuuDashboardData(` と `);` の間にある JSON だけを Edit で書き換える'
check 'updater は最初に 1 回だけ読み、読み直さない' updater_says 'データファイルを最初に 1 回 Read する。読み直さない'
check 'updater は HTML、一覧、好みを読まない' updater_says '`.html`、一覧、好みは読まない'
check 'updater は一覧を読み書きしない' updater_says '一覧はフックが作業のデータから作るので、読まない、書かない'
check 'updater はパネルの足し引きをしない' updater_says 'パネルの足し引きと、種類・`id`・並びの変更はしない'
check 'updater は既存の trend に点を足す' updater_says '既存の系列の `points` の末尾に'
check 'updater は trend の点が上限を超えたら古い点から落とす' updater_says '点が 50 個を超えたら、古い点（先頭）から落として 50 個にする'
check 'updater は書き換えるたびに updatedAt を取り直す' updater_says '書き換えるたびに `updatedAt` をその時刻にする'
check 'updater は回答の内容と時刻を残す' updater_says '回答の内容 `answer` と回答した時刻 `answeredAt` を足す'
check 'updater はパスがなければ推測しない' updater_says '何もせずに「パスが必要です」と返す'
check 'updater は構成を変えずに builder へ回す' updater_says '何も変えずに「構成の見直しが必要です」と理由を添えて返す'
check 'updater は JSON の確認をフックに任せる' updater_says '書き換えたあとの JSON は、フックが確かめる'
check 'updater はトークン量のファイルに触れない' updater_says '`.usage.js` を作らない、編集しない'
check 'updater は好みに触れない' updater_says '好みのスタイル（`prefs.data.js`）に触れない'
check 'updater は完了した作業の状態を done にする' updater_says '`status` を `done`（完了）にし'
check 'updater は途中で止めた作業を中断中にする' updater_says '`status` を `paused`（中断中）にする。完了にはしない'
check 'updater は再開した作業を進行中に戻す' updater_says '再開したと渡されたら、`status` を `active`（進行中）に戻す'
check 'updater は外すときに status を removed にする Edit を 1 回だけ行う' updater_says '`status` を `removed` にする Edit を 1 回だけ行う'
check 'updater は消すときも作業のファイルに触れない' updater_says 'ファイルは呼び出し元が消す'
check 'updater は PR / MR の追加と更新を既存の項目の更新として扱う' \
  updater_says '要素を足すことと、同じ `url` の要素の `state`、`title`、`at` を更新することは、既存の項目の更新として扱い、構成の見直しには回さない'
check 'updater は同じ url の要素の状態と題名と at を書き換える' updater_says '渡された PR / MR と同じ `url` の要素があれば、その `state`、`title`、`at` だけを書き換える'
check 'updater は同じ url の PR / MR を 2 つ作らない' updater_says '同じ `url` の要素を 2 つ作らない'
check 'updater は初めての PR / MR で reviews を作る' updater_says 'PR / MR を初めて載せるときは、`reviews` の配列を作る'
check 'updater も kind を provider に合わせる' updater_says '`kind` は、`github` なら `pr`、`gitlab` なら `mr`'
check 'updater も PR / MR の url を https:// に限る' updater_says '`url` は `https://` で始まるものだけを書ける'
check 'updater は PR / MR の上限を守る（20 件、題名 200 字、url 500 字）' updater_says '上限は 20 件、題名 200 字、`url` 500 字'
check 'updater は要素を初めて足すときに決まった形で書く' updater_says '要素を初めて足すときは、この形のとおりに書く。ここにない項目名と値は作らない'
check 'updater はまだない種類の要素も推測せずに書く' updater_says '今の JSON にまだない種類の要素（質問、止まっているもの、成果物、PR / MR など）を初めて足すときも、推測せずに「データの形」を見て書く'
check 'updater は呼び出し元の言葉を決まった語彙に直す' updater_says '決まった語彙（進行中なら `doing`）に直して書く'
check 'updater に作業のデータの項目を示す' \
  updater_says '`schema`（`1`）、`project`、`slug`、`title`、`summary`、`status`、`startedAt`、`updatedAt`、`tasks`、`questions`、`blockers`、`artifacts`、`panels` と、省略できる `reviews`'
check 'updater に作業の status の語彙を示す' updater_says '`status` は `active`（進行中）、`paused`（中断中）、`done`（完了）、`removed`（一覧から外す）'
check 'updater に手順の status の語彙を示す' updater_says '手順の `status` は `todo | doing | waiting | blocked | done`'
check 'updater は進行中を doing にする' updater_says '進行中は `doing` にし、`in_progress` などほかの言葉は使わない'
check 'updater の質問の形に proceeding を含める' updater_says '`proceeding`（既定の対応で進めているか。`true` か `false` で、省略しない）'
check 'updater の止まっているものの形は what、why、since、next' updater_says '`what`（何が）、`why`（理由）、`since`（止まった時刻）、`next`（次にすること）。4 つとも書く'
check 'updater の成果物の形は name、ref、at、note' updater_says '`name`、`ref`（パスまたは URL）、`at`、任意の `note`'
check 'updater に panel の state の語彙を示す' updater_says '`state` は `todo | doing | waiting | blocked | done | failed`'
check 'builder と updater の手順の status の語彙が同じ' body_has '手順の `status` は `todo | doing | waiting | blocked | done`'
check 'builder と updater のパネルの中身の表が同じ' python3 - "$agent" "$updater" <<'PY'
import re, sys
rows = [[line for line in open(p, encoding="utf-8").read().splitlines() if re.match(r"\| `[a-z]+` \|", line)] for p in sys.argv[1:]]
sys.exit(0 if len(rows[0]) == 7 and rows[0] == rows[1] else 1)
PY
check 'builder は既存の好みをそのまま使ったときは好みに触れない' \
  body_has '好みに触れるのは、好みを保存したときと変えたときだけにする。既存の `prefs.data.js` をそのまま使ったときは、好みについて書かない'

for file in agents/dashboard-builder.md agents/dashboard-updater.md; do
  # 見た目と動きは固定のクライアントが受け持つので、HTML / CSS / JavaScript の書き方を指示しない。
  check "${file} に HTML / CSS / JavaScript の書き方の指示がない" \
    fails grep -qE '<(html|head|body|script|meta|link|style|a )|CSS|JavaScript|favicon|viewport|innerHTML|textContent|location\.reload|sessionStorage|setInterval|white-space|fetch|XMLHttpRequest|"layout"' "$REPO/$file"
done
for file in agents/dashboard-builder.md agents/dashboard-updater.md hooks/dashboard-guard.sh hooks/dashboard-usage.py \
  hooks/dashboard-validate.py hooks/dashboard-page.py install.sh uninstall.sh claude-instructions.md \
  client/task.html client/index.html client/nuu.js client/nuu.css; do
  check "${file} に利用者固有のパスを書かない" fails grep -qE '/Users/|/home/|shimabox/github' "$REPO/$file"
done

echo '== CLAUDE.md に追記するルール =='

rules="$(cat "$REPO/claude-instructions.md")"

rules_have() {
  grep -qF -- "$1" <<<"$rules"
}

check 'dashboard-builder が使えるときだけ適用する' rules_have 'dashboard-builder` サブエージェントが使えるときに適用する'
check '5 ステップ超か 30 分超の作業で着手前に用意する' rules_have '5 ステップを超える作業、または 30 分を超えそうな作業では、着手前に'
check '対話なしの実行ではダッシュボードを用意しない' rules_have '`claude -p` のような対話なしの実行では、ダッシュボードを用意しない'
check '対話なしの実行では更新と完了も行わない' rules_have 'ダッシュボードを用意しない（Claude Code が `~/.claude` の下への書き込みを止めるため）。更新と完了も行わない'
check '好みを聞けないときの例に対話なしの実行を挙げない' fails rules_have '非対話の実行'
check '1 ステップごとに更新する' rules_have '1 ステップ終えるごとに'
check 'NEEDS_STYLE なら利用者に好みを聞く' rules_have 'NEEDS_STYLE` を返したら、AskUserQuestion で'
check '利用者の答えは「利用者の答え」として渡す' rules_have '答えを「利用者の答え」として渡して呼び直す'
check '聞けないときは好みを決めず、聞けないことを渡す' rules_have '好みを利用者に聞けないときは、好みを自分で決めて渡さない。「好みを聞けない」と `dashboard-builder` に渡す'
check '聞けないときは何も保存せず既定の見た目にする' rules_have '何も保存せず、ダッシュボードは既定の見た目で表示される'
check '「今回だけ」の好みはない' fails rules_have '今回だけ'
check '好みの変更はすべてのダッシュボードにすぐ届く' rules_have '変更は開いているページも含めたすべてのダッシュボードにすぐ届く'
check 'モデルは settings.json で指定できる' rules_have '`~/.claude/nuu/settings.json` で指定できる'
check 'モデルの値は決まった語に限る' rules_have '値は `sonnet | opus | haiku | fable`'
check '指定がなければ定義の既定を使う' rules_have 'エージェントの定義の既定（builder は opus、updater は sonnet）を使う'
check '指定があれば呼ぶたびに model に渡す' rules_have '指定があれば、そのエージェントを呼ぶたびに Agent ツールの `model` に渡す'
check '指定がなければ model を渡さない' rules_have '指定がなければ `model` を渡さない'
check 'モデルの変更は該当する値だけを書き換える' rules_have '`settings.json` の該当する名前の値だけを書き換える'
check '用意するときに作業ディレクトリを渡す' rules_have '用意するときは、作業ディレクトリ、'
check 'ダッシュボードのパスを覚えて更新のたびに渡す' rules_have '作業ごとのダッシュボードのパスは覚えておき、以後の更新と完了のたびに'
check '途中の更新と完了は updater に任せる' rules_have '途中の更新と完了は、軽量な `dashboard-updater` に任せる'
check '構成の見直しが必要なら builder に回す' rules_have '「構成の見直しが必要です」と返したら、同じパスと変化を `dashboard-builder` に渡して'
check '質問の追加は updater で行う' rules_have '`dashboard-updater` 経由で質問一覧に追加し'
check '完了の更新は updater で行う' rules_have '作業が終わったら、`dashboard-updater` で完了状態に更新し'
check '途中の更新は待たずに次の手順へ進む' rules_have '途中の更新はバックグラウンドで呼び、完了を待たずに次の手順へ進む'
check '用意は完了を待つ' rules_have '用意（setup）は返ってくるパスが必要なので、完了を待つ'
check '同じダッシュボードを同時に更新させない' rules_have '同じダッシュボードを同時に更新させない'
check '完了の更新は待ってから報告する' rules_have '終わるのを待ってから利用者に報告する'
check '好みの変更を求められたら dashboard-builder に渡す' rules_have '好み（テーマ、密度、アクセントカラー、タスクの表示）の変更を求めたら、新しい好みを「利用者の答え」として `dashboard-builder` に渡す'
check '判断待ちでは止まらず既定の対応で続ける' rules_have '止まって待たずに'
check '取り消せない操作は既定の対応で進めない' rules_have '取り消せない操作や外部に公開される操作'
check '作業は利用者が求めたときだけ消す' rules_have '利用者がダッシュボードの作業を消すよう求めたときだけ'
check '消す作業がはっきりしなければ確かめる' rules_have 'どの作業かはっきりしなければ、一覧のデータから候補を示して確かめる'
check '一覧から外してから作業のファイルを消す' rules_have '終わるのを待ってから、その作業の `.html`、`.data.js`、`.usage.js` を消す'
check '進行中の作業は消す前に確かめる' rules_have '進行中の作業は、別のセッションが更新している可能性があるので、消す前に利用者に確かめる'
check '途中で止めたら中断中にして報告する' rules_have '利用者が作業を途中で止めたら、`dashboard-updater` で中断中に更新し'
check '途中で止めた作業は完了にしない' rules_have '中断中に更新し、終わるのを待ってから利用者に報告する。完了にはしない'
check '再開したら進行中に戻す' rules_have '再開したら、進行中に戻してから続ける'
check 'PR / MR を作った、状態が変わった、見つけたときに載せる' \
  rules_have 'Merge Request（MR）を作ったとき、その状態が変わったとき（下書きから公開、マージ、閉じた）、作業に関係する既存の PR / MR を見つけたときは'
check 'PR / MR の provider、番号、題名、URL、状態を updater に渡す' \
  rules_have 'provider（github / gitlab）、番号、題名、URL、状態（draft / open / merged / closed）を `dashboard-updater` に渡して載せる'
check 'setup のときに分かっている PR / MR は builder に渡す' rules_have 'setup のときに分かっていれば `dashboard-builder` に渡す'
check 'updater に渡す手順の状態は決まった語彙で書く' \
  rules_have '`dashboard-updater` に渡す手順の状態は、todo / doing / waiting / blocked / done の言葉で書く（例: 進行中は doing）'
check 'builder がパスを返したら好みを聞き直さない' \
  rules_have '`dashboard-builder` が作業ごとのダッシュボードのパスを返したら、好みは聞き直さない'
check '好みを聞くのは NEEDS_STYLE のときだけ' \
  rules_have '好みを利用者に聞くのは、`dashboard-builder` が `NEEDS_STYLE` を返したときだけ'

echo '== ガード =='

mkdir -p "$(dirname "$GUARD_LINK")" "$DASH_DIR/project" "$MEMORY_DIR"
ln -s "$REPO/hooks/dashboard-guard.sh" "$GUARD_LINK"
ln -s "$REPO/client" "$DASH_DIR/_client"
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

expect_guard allow '作業のデータを書ける' Write "$(file_input "$DASH_DIR/project/2026-09-27-1043-task.data.js")"
expect_guard allow '作業のデータを ~ 付きのパスで編集できる' Edit "$(file_input '~/.claude/nuu/dashboards/project/2026-09-27-1043-task.data.js')"
expect_guard allow '好みを書ける' Write "$(file_input "$DASH_DIR/prefs.data.js")"
expect_guard allow '好みを ~ 付きのパスで編集できる' Edit "$(file_input '~/.claude/nuu/dashboards/prefs.data.js')"
expect_guard allow 'スタブを読める（できたかを確かめる）' Read "$(file_input "$DASH_DIR/project/2026-09-27-1043-task.html")"
expect_guard allow '一覧のデータを読める' Read "$(file_input "$DASH_DIR/index.data.js")"
expect_guard allow '好みを読める' Read "$(file_input '~/.claude/nuu/dashboards/prefs.data.js')"
expect_guard deny '作業のスタブ（.html）には書けない' Write "$(file_input "$DASH_DIR/project/2026-09-27-1043-task.html")"
expect_guard deny '一覧のスタブ（index.html）は編集できない' Edit "$(file_input '~/.claude/nuu/dashboards/index.html')"
expect_guard deny '一覧のデータには書けない' Write "$(file_input "$DASH_DIR/index.data.js")"
expect_guard deny '一覧のデータは編集できない' Edit "$(file_input "$DASH_DIR/index.data.js")"
expect_guard deny 'トークン量には書けない' Write "$(file_input "$DASH_DIR/project/2026-09-27-1043-task.usage.js")"
expect_guard deny 'トークン量は編集できない' Edit "$(file_input "$DASH_DIR/project/2026-09-27-1043-task.usage.js")"
expect_guard deny '一覧のロックには書けない' Write "$(file_input "$DASH_DIR/.index.lock")"
expect_guard deny 'ダッシュボードの直下に作業のデータは書けない' Write "$(file_input "$DASH_DIR/2026-09-27-1043-task.data.js")"
expect_guard deny 'プロジェクトの下のフォルダーには書けない' Write "$(file_input "$DASH_DIR/project/sub/2026-09-27-1043-task.data.js")"
expect_guard deny '隠しファイルのデータには書けない' Write "$(file_input "$DASH_DIR/project/.task.data.js")"
expect_guard deny '固定クライアントには書けない' Write "$(file_input "$DASH_DIR/_client/nuu.js")"
expect_guard deny '固定クライアントは読めない（リポジトリの中）' Read "$(file_input "$DASH_DIR/_client/nuu.js")"
expect_guard deny '_client の中に作業のデータは書けない' Write "$(file_input "$DASH_DIR/_client/2026-09-27-1043-task.data.js")"
rm "$DASH_DIR/_client"
mkdir -p "$DASH_DIR/_client"
expect_guard deny '_client が実体のフォルダーでも作業のデータは書けない' Write "$(file_input "$DASH_DIR/_client/2026-09-27-1043-task.data.js")"
rmdir "$DASH_DIR/_client"
expect_guard deny '自分のメモリは読めない（メモリは使わない）' Read "$(file_input "$MEMORY_DIR/MEMORY.md")"
expect_guard deny 'メモリには書けない' Write "$(file_input '~/.claude/agent-memory/dashboard-builder/style.md')"
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

# 応答 1 行を作る。同じ id の行は、書き出し途中の値と確定した値を表す。7 番目の引数はモデル（既定は claude-test）。
log_line() {
  jq -cn --arg ts "$1" --arg id "$2" --argjson input "$3" --argjson output "$4" \
    --argjson read "$5" --argjson write "$6" --arg model "${7:-claude-test}" \
    '{type: "assistant", timestamp: $ts, message: {id: $id, model: $model,
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

# 3 番目の引数は書いたエージェントの ID（既定は setup）。
run_usage() {
  jq -n --arg tool "$1" --arg path "$2" --arg log "$MAIN_LOG" --arg agent "${3:-setup}" \
    '{tool_name: $tool, transcript_path: $log, agent_id: $agent, session_id: "session", cwd: "/work/it'"'"'s here", tool_input: {file_path: $path}}' \
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

check '作業のデータを書いたら集計が成功する' run_usage Write "$DASH_DIR/project/task.data.js"
check '集計結果をデータと同じフォルダーに書く' test -f "$DASH_DIR/project/task.usage.js"
check 'データファイル用に別のトークン量は作らない' test ! -e "$DASH_DIR/project/task.data.usage.js"
check '作業ごとのキーで書く' grep -qF '["project/task"]' "$DASH_DIR/project/task.usage.js"
expect_usage '用意を始めた時刻から数える' '.since | todate' 2026-09-27T02:00:00Z
expect_usage '同じ応答は最大値で 1 回だけ数える' '.byCategory.main.total' 1160
expect_usage '用意より前の応答は数えない' '.byCategory.main.input' 10
expect_usage 'dashboard-builder の分を分けて数える' '.byCategory.dashboard.total' 509
expect_usage 'ほかのサブエージェントの分を分けて数える' '.byCategory.subagents.total' 33
expect_usage '合計を出す' '.totals.total' 1702
expect_usage '種類ごとに合計する' '[.totals.input, .totals.output, .totals.cacheRead, .totals.cacheWrite] | join(",")' 15,137,1500,50
expect_usage 'モデルごとに合計する' '.byModel["claude-test"]' 1702
expect_usage 'セッションの ID を書く' '.sessionId' session
expect_usage '作業ディレクトリを書く' '.cwd' "/work/it's here"
expect_usage '書いた builder のモデルを記録する' '.agentModels["dashboard-builder"] | join(",")' claude-test
expect_usage 'まだ書いていない updater のモデルは記録しない' '.agentModels | has("dashboard-updater")' false

log_line 2026-09-27T02:00:20.000Z main-2 5 5 0 0 >>"$MAIN_LOG"
rm "$SESSION/subagents/agent-setup.jsonl"
check '2 回目の集計が成功する' run_usage Edit "$DASH_DIR/project/task.data.js"
expect_usage '2 回目も用意を始めた時刻を保つ' '.since | todate' 2026-09-27T02:00:00Z
expect_usage '2 回目は増えた分を足す' '.byCategory.main.total' 1170
expect_usage '書いたエージェントの記録がなくても、前回までのモデルを残す' '.agentModels["dashboard-builder"] | join(",")' claude-test

check '一覧のデータを書いても成功する' run_usage Write "$DASH_DIR/index.data.js"
check '一覧のトークン量は作らない' test ! -e "$DASH_DIR/index.usage.js"
check '好みを書いても成功する' run_usage Write "$DASH_DIR/prefs.data.js"
check '好みのトークン量は作らない' test ! -e "$DASH_DIR/prefs.usage.js"
check '壊れた入力でも作業を止めない' bash -c '"$1" <<<"not json" 2>/dev/null' _ "$USAGE_LINK"

log_line 2026-09-27T02:00:30.000Z update-1 4 6 0 0 >"$SESSION/subagents/agent-updater.jsonl"
printf '{"agentType":"dashboard-updater"}\n' >"$SESSION/subagents/agent-updater.meta.json"
check 'updater の書き込みでも集計が成功する' run_usage Edit "$DASH_DIR/project/task.data.js" updater
expect_usage 'updater の分もダッシュボードに数える' '.byCategory.dashboard.total' 10

log_line 2026-09-27T02:00:40.000Z update-2 1 1 0 0 >>"$SESSION/subagents/agent-updater.jsonl"
check 'スタブ（.html）の書き込みでも失敗しない' run_usage Write "$DASH_DIR/project/task.html"
expect_usage 'スタブ（.html）の書き込みでは集計しない' '.byCategory.dashboard.total' 10
check 'もう一度データを書いたら集計が成功する' run_usage Edit "$DASH_DIR/project/task.data.js" updater
expect_usage 'データを書けば増えた分を数える' '.byCategory.dashboard.total' 12
expect_usage '書いた updater のモデルを記録する' '.agentModels["dashboard-updater"] | join(",")' claude-test
expect_usage 'updater が書いても builder のモデルを残す' '.agentModels["dashboard-builder"] | join(",")' claude-test

log_line 2026-09-27T02:00:50.000Z update-3 0 0 0 0 claude-other >>"$SESSION/subagents/agent-updater.jsonl"
run_usage Edit "$DASH_DIR/project/task.data.js" updater
expect_usage '別のモデルで書けば、最初に書いた順に足す' '.agentModels["dashboard-updater"] | join(",")' claude-test,claude-other
log_line 2026-09-27T02:00:55.000Z update-4 0 0 0 0 '<synthetic>' >>"$SESSION/subagents/agent-updater.jsonl"
run_usage Edit "$DASH_DIR/project/task.data.js" updater
expect_usage '合成された応答はモデルとして数えない' '.agentModels["dashboard-updater"] | join(",")' claude-test,claude-other
run_usage Edit "$DASH_DIR/project/task.data.js" other
expect_usage 'ダッシュボードのエージェント以外のモデルは記録しない' '.agentModels | keys | join(",")' dashboard-builder,dashboard-updater

echo '== データの確認 =='

# 正しい例と壊れた例は tests/fixtures に置き、ブラウザのテストと同じものを使う。
readonly FIXTURES="$ROOT/tests/fixtures"
ln -s "$REPO/hooks/dashboard-validate.py" "$VALIDATE_LINK"

run_validate() {
  jq -n --arg tool "${2:-Edit}" --arg path "$1" '{tool_name: $tool, tool_input: {file_path: $path}}' \
    | HOME="$TEST_HOME" "$VALIDATE_LINK"
}

expect_validate() {
  local got

  got="$(run_validate "$3" "${4:-Edit}" | jq -r '.decision')"
  [[ -n "$got" ]] || got=none
  if [[ "$got" == "$1" ]]; then
    pass "$2"
  else
    fail "${2}（期待: ${1}、結果: ${got}）"
  fi
}

# 止めた理由に、決めた文が入っているかを確かめる。
expect_reason() {
  local name="$1"
  local path="$2"
  local want="$3"
  local output reason

  output="$(run_validate "$path")"
  reason="$(jq -r '.reason // empty' <<<"$output")"
  if [[ "$(jq -r '.decision // empty' <<<"$output")" == block ]] && grep -qF -- "$want" <<<"$reason"; then
    pass "$name"
  else
    fail "${name}（期待する理由: ${want}、結果: ${reason:-止めなかった}）"
  fi
}

# 置き場所ごとに意味が決まるので、fixtures の相対パスのまま ~/.claude/nuu/dashboards/ へ写す。
place_fixture() {
  mkdir -p "$(dirname "$DASH_DIR/$2")"
  cp "$1" "$DASH_DIR/$2"
}

valid_count=0
while IFS= read -r file; do
  relative="${file#"$FIXTURES/valid/"}"
  place_fixture "$file" "$relative"
  expect_validate none "正しい例 ${relative} は通る" "$DASH_DIR/$relative" Write
  valid_count=$((valid_count + 1))
done < <(find "$FIXTURES/valid" -name '*.data.js' | sort)
check '正しい例がある' test "$valid_count" -gt 0

invalid_count=0
while IFS=$'\t' read -r file as reason what; do
  place_fixture "$FIXTURES/invalid/$file" "$as"
  expect_reason "壊れた例を理由付きで止める: ${what}（${file}）" "$DASH_DIR/$as" "$reason"
  invalid_count=$((invalid_count + 1))
done < <(jq -r '.[] | [.file, .as, .reason, .what] | @tsv' "$FIXTURES/invalid/cases.json")
check '壊れた例がある' test "$invalid_count" -gt 0
check '壊れた例のファイルをすべて cases.json に書いている' \
  test "$(find "$FIXTURES/invalid" -name '*.data.js' | wc -l | tr -d ' ')" -eq "$invalid_count"

readonly SAMPLE="sample-shop/2026-09-28-2252-search-filters.data.js"
data_file() {
  printf 'window.nuuDashboardData(\n%s\n);\n' "$1"
}

place_fixture "$FIXTURES/valid/$SAMPLE" "$SAMPLE"
sed 's/"status": "active"/"status": "running"/; s/"status": "done" },/"status": "finished" },/' \
  "$FIXTURES/valid/$SAMPLE" >"$DASH_DIR/sample-shop/2026-09-28-2252-two.data.js"
sed -i.bak 's/"slug": "2026-09-28-2252-search-filters"/"slug": "2026-09-28-2252-two"/' "$DASH_DIR/sample-shop/2026-09-28-2252-two.data.js"
expect_reason '壊れた箇所が複数あれば 1 回でまとめて返す（1 つ目）' "$DASH_DIR/sample-shop/2026-09-28-2252-two.data.js" 'status: "running"'
expect_reason '壊れた箇所が複数あれば 1 回でまとめて返す（2 つ目）' "$DASH_DIR/sample-shop/2026-09-28-2252-two.data.js" 'tasks[0].status: "finished"'
check '理由にどのファイルかを書く' grep -qF "$DASH_DIR/sample-shop/2026-09-28-2252-two.data.js" \
  <<<"$(run_validate "$DASH_DIR/sample-shop/2026-09-28-2252-two.data.js" | jq -r .reason)"
printf 'window.nuuDashboardData(\n{}\n);\n\n' >"$DASH_DIR/sample-shop/trail-blank.data.js"
expect_reason '最終行の後に空行があれば直させる' "$DASH_DIR/sample-shop/trail-blank.data.js" '最終行を );'

data_file '{"broken": [}' >"$WORK_DIR/other.data.js"
printf '<html><body>page</body></html>\n' >"$DASH_DIR/sample-shop/page.html"
printf 'broken(\n' >"$DASH_DIR/sample-shop/task.usage.js"
expect_validate none 'Write と Edit 以外は確かめない' "$DASH_DIR/bad/syntax.data.js" Read
expect_validate none 'ダッシュボード以外のデータファイルは確かめない' "$WORK_DIR/other.data.js"
expect_validate none 'HTML は確かめない（スタブはフックが置く）' "$DASH_DIR/sample-shop/page.html"
expect_validate none 'トークン量のファイルは確かめない' "$DASH_DIR/sample-shop/task.usage.js"
check '確認で壊れた入力でも作業を止めない' bash -c '"$1" <<<"not json" 2>/dev/null' _ "$VALIDATE_LINK"

# エージェント定義に載せたデータの例は、そのまま書いても validate を通る。
# コードブロックのうち、1 行目がデータか好みの呼び出しのものを例として取り出し、決まった置き場所に書く。
example_count=0
updater_examples=0
while IFS=$'\t' read -r name relative; do
  expect_validate none "エージェント定義の例は通る: ${name} → ${relative}" "$DASH_DIR/$relative" Write
  example_count=$((example_count + 1))
  [[ "$name" == dashboard-updater.md ]] && updater_examples=$((updater_examples + 1))
done < <(python3 - "$REPO/agents" "$DASH_DIR" <<'PY'
import json, os, re, sys, textwrap
agents, dash = sys.argv[1:]
for name in sorted(os.listdir(agents)):
    text = open(os.path.join(agents, name), encoding="utf-8").read()
    for block in re.findall(r"^( *)```[^\n]*\n(.*?)^\1```", text, re.S | re.M):
        body = textwrap.dedent(block[1])
        first = body.split("\n", 1)[0]
        if first == "window.nuuDashboardPrefs(":
            relative = "prefs.data.js"
        elif first == "window.nuuDashboardData(":
            data = json.loads("\n".join(body.rstrip("\n").split("\n")[1:-1]))
            relative = f"{data['project']}/{data['slug']}.data.js"
        else:
            continue
        os.makedirs(os.path.dirname(os.path.join(dash, relative)), exist_ok=True)
        with open(os.path.join(dash, relative), "w", encoding="utf-8") as f:
            f.write(body)
        print(f"{name}\t{relative}")
PY
)
check 'エージェント定義にデータと好みの例がある' test "$example_count" -ge 3
check 'updater の定義にもデータの例があり、validate を通る' test "$updater_examples" -eq 1
check 'builder の例にパネル 7 種がすべて入っている' python3 - "$REPO/agents/dashboard-builder.md" <<'PY'
import re, sys
text = open(sys.argv[1], encoding="utf-8").read()
found = set(re.findall(r'"type": "([a-z]+)"', text))
sys.exit(0 if {"progress", "grid", "table", "keyvalue", "text", "trend", "flow"} <= found else 1)
PY
# updater は要素を初めて足すときに例を見て書くので、要素の種類と任意の項目をすべて例に入れる。
check 'updater の例に要素の種類、任意の項目、パネル 7 種、手順の状態がすべて入っている' python3 - "$REPO/agents/dashboard-updater.md" <<'PY'
import json, re, sys
text = open(sys.argv[1], encoding="utf-8").read()
body = re.search(r"^```\nwindow\.nuuDashboardData\(\n(.*?)\n\);\n```", text, re.S | re.M).group(1)
data = json.loads(body)
keys = lambda name: set().union(*(item.keys() for item in data[name]))
ok = (
    keys("tasks") == {"id", "title", "status", "note"}
    and {t["status"] for t in data["tasks"]} == {"todo", "doing", "waiting", "blocked", "done"}
    and keys("questions") == {"id", "question", "default", "proceeding", "askedAt", "answer", "answeredAt"}
    and keys("blockers") == {"what", "why", "since", "next"}
    and keys("artifacts") == {"name", "ref", "at", "note"}
    and keys("reviews") == {"provider", "kind", "number", "title", "url", "state", "at"}
    and {p["type"] for p in data["panels"]} == {"progress", "grid", "table", "keyvalue", "text", "trend", "flow"}
)
sys.exit(0 if ok else 1)
PY

echo '== ページと一覧 =='

readonly INDEX_DATA="$DASH_DIR/index.data.js"
ln -s "$REPO/hooks/dashboard-page.py" "$PAGE_LINK"
rm -rf "$DASH_DIR"
mkdir -p "$DASH_DIR"

run_page() {
  jq -n --arg tool "${2:-Write}" --arg path "$1" '{tool_name: $tool, tool_input: {file_path: $path}}' \
    | HOME="$TEST_HOME" "$PAGE_LINK"
}

# 一覧のデータの JSON に jq の式を当てる。
index_of() {
  sed '1d;$d' "$INDEX_DATA" | jq -r "$1"
}

expect_index() {
  local got

  got="$(index_of "$2")"
  if [[ "$got" == "$3" ]]; then
    pass "$1"
  else
    fail "${1}（期待: ${3}、結果: ${got}）"
  fi
}

# fixtures の作業のデータだけを置く（スタブと一覧はフックが作る）。
place_fixture "$FIXTURES/valid/$SAMPLE" "$SAMPLE"
check '作業のデータを書いたら成功する' run_page "$DASH_DIR/$SAMPLE"
check '最初の書き込みで作業のスタブを置く' cmp -s "$REPO/client/task.html" "$DASH_DIR/${SAMPLE%.data.js}.html"
check '最初の書き込みで一覧のスタブを置く' cmp -s "$REPO/client/index.html" "$DASH_DIR/index.html"
check '最初の書き込みで一覧のデータを作る' test -f "$INDEX_DATA"
expect_validate none '作った一覧のデータは validate を通る' "$INDEX_DATA"
expect_index '一覧に書いた作業の行がある' '.items | map(.href) | join(",")' 'sample-shop/2026-09-28-2252-search-filters.html'

while IFS= read -r file; do
  relative="${file#"$FIXTURES/valid/"}"
  [[ "$relative" == */* ]] && place_fixture "$file" "$relative"
done < <(find "$FIXTURES/valid" -name '*.data.js' | sort)
check 'ほかの作業を書いても成功する' run_page "$DASH_DIR/sample-app/2026-09-28-1905-login-audit.data.js" Edit
expect_index '一覧はすべての作業のデータから作る' '.items | length' 5
check '一覧の行は fixtures の一覧と同じ値になる（数え方がずれない）' python3 - "$INDEX_DATA" "$FIXTURES/valid/index.data.js" <<'PY'
import json, sys
made, sample = ({i["href"]: i for i in json.loads("\n".join(open(p, encoding="utf-8").read().split("\n")[1:-2]))["items"]} for p in sys.argv[1:])
sys.exit(0 if made and all(sample.get(href) == row for href, row in made.items()) else 1)
PY
expect_validate none 'PR / MR を持つ一覧のデータも validate を通る' "$INDEX_DATA"
expect_index '一覧の行には PR / MR の札に要る項目だけを持たせる' \
  '.items[] | select(.project == "sample-shop") | .reviews[0] | keys_unsorted | join(",")' 'provider,kind,number,url,state'
expect_index '一覧の行の PR / MR は最終更新が新しい順' \
  '.items[] | select(.slug == "2026-09-26-0930-db-migration") | .reviews | map(.number) | join(",")' '305,87,301,298'
expect_index 'PR / MR のない作業の行には reviews を持たせない' '.items[] | select(.project == "sample-docs") | has("reviews")' false
check 'ほかの作業のスタブは置かない（書いた作業だけ）' test ! -e "$DASH_DIR/sample-docs/2026-09-27-1010-api-guide.html"

printf 'old\n' >"$DASH_DIR/${SAMPLE%.data.js}.html"
printf 'old\n' >"$DASH_DIR/index.html"
run_page "$DASH_DIR/$SAMPLE" Edit
check '雛形と違うスタブは置き直す' cmp -s "$REPO/client/task.html" "$DASH_DIR/${SAMPLE%.data.js}.html"
check '雛形と違う一覧のスタブも置き直す' cmp -s "$REPO/client/index.html" "$DASH_DIR/index.html"

readonly MIN="sample-min/2026-09-28-0900-empty.data.js"
sed -i.bak 's/"status": "active"/"status": "removed"/' "$DASH_DIR/$MIN"
rm -f "$DASH_DIR/$MIN.bak"
run_page "$DASH_DIR/$MIN" Edit
expect_index 'removed の作業は一覧から外す' '[.items[] | select(.project == "sample-min")] | length' 0
expect_index 'removed の作業を外してもほかの行は残る' '.items | length' 4

readonly APP="sample-app/2026-09-28-1905-login-audit.data.js"
app_row="$(index_of '.items[] | select(.project == "sample-app") | tojson')"
printf 'window.nuuDashboardData(\n{"broken": [}\n);\n' >"$DASH_DIR/$APP"
check '壊れたデータを書いても成功する' run_page "$DASH_DIR/$APP" Edit
expect_index '壊れたデータの作業は前の行が残る' '.items[] | select(.project == "sample-app") | tojson' "$app_row"
expect_index '壊れたデータの作業があってもほかの行は残る' '.items | length' 4
mkdir -p "$DASH_DIR/sample-new"
printf 'window.nuuDashboardData(\n{}\n);\n' >"$DASH_DIR/sample-new/2026-09-28-1000-new.data.js"
run_page "$DASH_DIR/sample-new/2026-09-28-1000-new.data.js"
expect_index '前の行がない壊れた作業は一覧に載せない' '[.items[] | select(.project == "sample-new")] | length' 0
check '壊れた作業でもスタブは置く' test -f "$DASH_DIR/sample-new/2026-09-28-1000-new.html"
rm -rf "$DASH_DIR/sample-new"
place_fixture "$FIXTURES/valid/$APP" "$APP"

rm -f "$DASH_DIR/index.html"
place_fixture "$FIXTURES/valid/prefs.data.js" prefs.data.js
check '好みを書いても成功する' run_page "$DASH_DIR/prefs.data.js"
check '好みを書いたら一覧のスタブを置く' cmp -s "$REPO/client/index.html" "$DASH_DIR/index.html"
check '好みのスタブ（prefs.html）は置かない' test ! -e "$DASH_DIR/prefs.html"

rm -f "$INDEX_DATA"
run_page "$DASH_DIR/$SAMPLE" Read
check 'Write と Edit 以外では何もしない' test ! -e "$INDEX_DATA"
run_page "$DASH_DIR/${SAMPLE%.data.js}.usage.js" Write
check 'トークン量のファイルでは何もしない' test ! -e "$INDEX_DATA"
run_page "$WORK_DIR/other.data.js"
check 'ダッシュボードの外のファイルでは何もしない' test ! -e "$INDEX_DATA"
check '壊れた入力でもページの用意で作業を止めない' bash -c '"$1" <<<"not json" 2>/dev/null' _ "$PAGE_LINK"

# _client は固定クライアントの置き場所なので、作業のフォルダーとして扱わない。
mkdir -p "$DASH_DIR/_client"
place_fixture "$FIXTURES/valid/$SAMPLE" "_client/2026-09-28-2252-search-filters.data.js"
run_page "$DASH_DIR/_client/2026-09-28-2252-search-filters.data.js"
check '_client の中にはスタブを置かない' test ! -e "$DASH_DIR/_client/2026-09-28-2252-search-filters.html"
check '_client の中のデータでは一覧を作らない' test ! -e "$INDEX_DATA"
run_page "$DASH_DIR/$SAMPLE"
expect_index '_client の中のデータは一覧に載せない' '[.items[] | select(.project == "_client")] | length' 0
rm -rf "$DASH_DIR/_client"

# ほかのフックがロックを持ったままなら、待つ上限のあと一覧を変えずに終わる。
readonly LOCK_READY="$TEST_ROOT/lock-ready"
python3 - "$DASH_DIR/.index.lock" "$LOCK_READY" <<'PY' &
import fcntl, sys, time
handle = open(sys.argv[1], "a")
fcntl.flock(handle, fcntl.LOCK_EX)
open(sys.argv[2], "w").close()
time.sleep(15)
PY
holder=$!
for _ in $(seq 100); do [[ -e "$LOCK_READY" ]] && break; sleep 0.1; done
sed -i.bak 's/"status": "active"/"status": "removed"/' "$DASH_DIR/$APP"
rm -f "$DASH_DIR/$APP.bak"
started=$SECONDS
check 'ロックを取れなくても成功する' run_page "$DASH_DIR/$APP" Edit
check 'ロックはフックの timeout（10 秒）より前にあきらめる' test $((SECONDS - started)) -lt 9
expect_index 'ロックを取れなければ一覧を変えない' '[.items[] | select(.project == "sample-app")] | length' 1
kill "$holder" 2>/dev/null || true
wait "$holder" 2>/dev/null || true

# 先に始まった走査（A）が、あとから始まった走査（B）より後に終わっても、removed にした作業が戻らない。
# A は走査のあと、テストが hold を消すまで待つ。ロックがなければ B が先に書き、A の古い結果で上書きされる。
readonly HOLD="$TEST_ROOT/page-hold"
place_fixture "$FIXTURES/valid/$APP" "$APP"
run_page "$DASH_DIR/$APP" Edit
touch "$HOLD"
jq -n --arg path "$DASH_DIR/$SAMPLE" '{tool_name: "Edit", tool_input: {file_path: $path}}' \
  | NUU_DASHBOARD_PAGE_TEST_HOLD="$HOLD" HOME="$TEST_HOME" "$PAGE_LINK" &
first=$!
for _ in $(seq 100); do [[ -e "$HOLD.scanned" ]] && break; sleep 0.1; done
check '先に始まったフックが、作業が進行中の間に走査した' test -e "$HOLD.scanned"
sed -i.bak 's/"status": "active"/"status": "removed"/' "$DASH_DIR/$APP"
rm -f "$DASH_DIR/$APP.bak"
jq -n --arg path "$DASH_DIR/$APP" '{tool_name: "Edit", tool_input: {file_path: $path}}' \
  | HOME="$TEST_HOME" "$PAGE_LINK" &
second=$!
sleep 1
rm -f "$HOLD"
wait "$first"
wait "$second"
expect_index '完了順が逆転しても removed にした作業は一覧に戻らない' '[.items[] | select(.project == "sample-app")] | length' 0
expect_index '並行して動いてもほかの行は残る' '.items | length' 3
check 'リポジトリの hooks/ に __pycache__ を作らない' test ! -e "$REPO/hooks/__pycache__"

echo '== install.sh =='

rm -rf "$TEST_HOME/.claude" "$REPO/vendor"
mkdir -p "$TEST_HOME/.claude"
printf 'keep\n' >"$TEST_HOME/.claude/CLAUDE.md"
: >"$GIT_LOG"

check 'インストールが成功する' run_install
check 'エージェント定義をリポジトリへのリンクにする' links_to "$AGENT_LINK" "$REPO/agents/dashboard-builder.md"
check '更新専用エージェントをリポジトリへのリンクにする' links_to "$UPDATER_LINK" "$REPO/agents/dashboard-updater.md"
check 'ガードをリポジトリへのリンクにする' links_to "$GUARD_LINK" "$REPO/hooks/dashboard-guard.sh"
check 'ページと一覧のフックをリポジトリへのリンクにする' links_to "$PAGE_LINK" "$REPO/hooks/dashboard-page.py"
check '集計スクリプトをリポジトリへのリンクにする' links_to "$USAGE_LINK" "$REPO/hooks/dashboard-usage.py"
check 'データの確認スクリプトをリポジトリへのリンクにする' links_to "$VALIDATE_LINK" "$REPO/hooks/dashboard-validate.py"
check 'ルールのファイルをリポジトリへのリンクにする' links_to "$RULES_LINK" "$REPO/claude-instructions.md"
check '固定クライアントを dashboards/_client へのリンクにする' links_to "$CLIENT_LINK" "$REPO/client"
check 'git を呼ばない' test ! -s "$GIT_LOG"
check 'impeccable を取得しない' test ! -e "$REPO/vendor"
check 'impeccable へのリンクを作らない' test ! -e "$TEST_HOME/.claude/nuu/impeccable"
check '2 回目も成功する' run_install
check '2 回目も git を呼ばない' test ! -s "$GIT_LOG"
check 'CLAUDE.md にルールを読み込む 1 行を足す' grep -qxF "$IMPORT_LINE" "$CLAUDE_MD"
check 'CLAUDE.md のほかの内容は残す' grep -qxF keep "$CLAUDE_MD"
check '2 回目は読み込みの 1 行を重ねて足さない' test "$(grep -cxF "$IMPORT_LINE" "$CLAUDE_MD")" -eq 1

# インストールしたフックが置いたスタブから、リンク越しに固定クライアントを読める。
place_fixture "$FIXTURES/valid/$SAMPLE" "$SAMPLE"
check 'インストールしたフックでスタブを置ける' run_page "$DASH_DIR/$SAMPLE"
check 'スタブが読む ../_client/nuu.js がある' test -f "$(dirname "$DASH_DIR/$SAMPLE")/../_client/nuu.js"
check 'スタブが読む ../_client/nuu.css がある' test -f "$(dirname "$DASH_DIR/$SAMPLE")/../_client/nuu.css"
check '一覧のスタブが読む _client/nuu.js がある' test -f "$DASH_DIR/_client/nuu.js"
printf '\n// 新しい版\n' >>"$REPO/client/nuu.js"
check 'リポジトリの client/ を書き換えると、リンク越しにすぐ新しい中身になる' cmp -s "$REPO/client/nuu.js" "$CLIENT_LINK/nuu.js"
cp "$ROOT/client/nuu.js" "$REPO/client/nuu.js"

rm "$AGENT_LINK"
printf 'mine\n' >"$AGENT_LINK"
check '既存のファイルがあれば失敗する' fails run_install
check '既存のファイルは上書きしない' grep -qxF mine "$AGENT_LINK"
rm "$AGENT_LINK"
rm "$CLIENT_LINK"
mkdir -p "$CLIENT_LINK"
printf 'mine\n' >"$CLIENT_LINK/nuu.js"
check '_client が別のフォルダーなら失敗する' fails run_install
check '別のフォルダーの _client は上書きしない' grep -qxF mine "$CLIENT_LINK/nuu.js"
rm -rf "$CLIENT_LINK"
rm -rf "$DASH_DIR"
run_install

echo '== uninstall.sh =='

check 'アンインストールが成功する' run_uninstall
check 'エージェント定義のリンクを外す' test ! -e "$AGENT_LINK"
check '更新専用エージェントのリンクを外す' test ! -e "$UPDATER_LINK"
check 'ガードのリンクを外す' test ! -e "$GUARD_LINK"
check 'ページと一覧のフックのリンクを外す' test ! -e "$PAGE_LINK"
check '集計スクリプトのリンクを外す' test ! -e "$USAGE_LINK"
check 'データの確認スクリプトのリンクを外す' test ! -e "$VALIDATE_LINK"
check 'ルールのファイルのリンクを外す' test ! -e "$RULES_LINK"
check '固定クライアントのリンクを外す' test ! -L "$CLIENT_LINK"
check 'リポジトリの client/ は残す' test -f "$REPO/client/nuu.js"
check '空になった dashboards と ~/.claude/nuu を消す' test ! -e "$TEST_HOME/.claude/nuu"
check 'CLAUDE.md の読み込みの 1 行を外す' fails grep -qxF "$IMPORT_LINE" "$CLAUDE_MD"
check 'CLAUDE.md のほかの内容は残す（アンインストール）' grep -qxF keep "$CLAUDE_MD"
check 'リンクがなくても成功する' run_uninstall

run_install
mkdir -p "$DASH_DIR/project"
printf 'board\n' >"$DASH_DIR/project/task.data.js"
printf 'prefs\n' >"$DASH_DIR/prefs.data.js"
printf '{}\n' >"$TEST_HOME/.claude/nuu/settings.json"
check 'ダッシュボードがあってもアンインストールが成功する' run_uninstall
check 'ダッシュボードは残す' test -f "$DASH_DIR/project/task.data.js"
check '好みのスタイルは残す' test -f "$DASH_DIR/prefs.data.js"
check 'モデルの指定は残す' test -f "$TEST_HOME/.claude/nuu/settings.json"
check 'ダッシュボードがあっても固定クライアントのリンクは外す' test ! -L "$CLIENT_LINK"

run_install
printf '{}\n' >"$TEST_HOME/.claude/nuu/settings.json"
check '--purge が成功する' run_uninstall --purge
check '--purge でダッシュボードを消す' test ! -e "$DASH_DIR"
check '--purge で好みのスタイルも消す' test ! -e "$DASH_DIR/prefs.data.js"
check '--purge でモデルの指定も消す' test ! -e "$TEST_HOME/.claude/nuu/settings.json"
check '--purge で空になった ~/.claude/nuu を消す' test ! -e "$TEST_HOME/.claude/nuu"
check '--purge でリンクを外す' test ! -e "$AGENT_LINK"
check '--purge でもリポジトリの client/ は残す' test -f "$REPO/client/nuu.js"
check '--purge でもリポジトリは残す' test -f "$REPO/agents/dashboard-builder.md"

printf 'mine\n' >"$AGENT_LINK"
mkdir -p "$CLIENT_LINK"
printf 'mine\n' >"$CLIENT_LINK/nuu.js"
check '別のファイルがあっても成功する' run_uninstall
check '別のファイルは消さない' grep -qxF mine "$AGENT_LINK"
check '別のフォルダーの _client は消さない' grep -qxF mine "$CLIENT_LINK/nuu.js"
rm -rf "$DASH_DIR"

set +e
run_uninstall --unknown
status=$?
set -e
check '知らない引数は終了コード 2 で止まる' test "$status" -eq 2

echo '== CLAUDE.md の読み込み =='

rm -f "$AGENT_LINK"

rm -f "$CLAUDE_MD"
check 'CLAUDE.md がなくてもインストールが成功する' run_install
check 'CLAUDE.md がなければ読み込みの 1 行だけで作る' test "$(cat "$CLAUDE_MD")" = "$IMPORT_LINE"
run_uninstall

mkdir -p "$TEST_ROOT/dotfiles"
printf 'shared\n' >"$TEST_ROOT/dotfiles/instructions.md"
rm -f "$CLAUDE_MD"
ln -s "$TEST_ROOT/dotfiles/instructions.md" "$CLAUDE_MD"
check 'CLAUDE.md がリンクでもインストールが成功する' run_install
check 'CLAUDE.md のリンクを壊さない' links_to "$CLAUDE_MD" "$TEST_ROOT/dotfiles/instructions.md"
check 'リンク先の実体に読み込みの 1 行を足す' grep -qxF "$IMPORT_LINE" "$TEST_ROOT/dotfiles/instructions.md"
check 'CLAUDE.md がリンクでもアンインストールが成功する' run_uninstall
check 'アンインストールでも CLAUDE.md のリンクを壊さない' links_to "$CLAUDE_MD" "$TEST_ROOT/dotfiles/instructions.md"
check 'リンク先の実体から読み込みの 1 行を外す' fails grep -qxF "$IMPORT_LINE" "$TEST_ROOT/dotfiles/instructions.md"
check 'リンク先の実体のほかの内容は残す' grep -qxF shared "$TEST_ROOT/dotfiles/instructions.md"

rm -f "$CLAUDE_MD"
printf 'keep\n\n## 長い作業の進捗ダッシュボード\n\n- 古いコピー\n' >"$CLAUDE_MD"
output="$(install_output)"
check 'ルールのコピーがあれば読み込みの 1 行を足さない' fails grep -qxF "$IMPORT_LINE" "$CLAUDE_MD"
check 'ルールのコピーがあれば置き換えを案内する' grep -qF 'ルールのコピーがあります' <<<"$output"
output="$(uninstall_output)"
check 'アンインストールでもコピーの節が残っていれば案内する' grep -qF '節が残っています' <<<"$output"

printf 'keep\n' >"$CLAUDE_MD"
output="$(install_output --no-claude-md)"
check '--no-claude-md なら CLAUDE.md に触れない' test "$(cat "$CLAUDE_MD")" = keep
check '--no-claude-md なら足す 1 行を案内する' grep -qxF "       $IMPORT_LINE" <<<"$output"
check '--no-claude-md でもルールのファイルはリンクする' links_to "$RULES_LINK" "$REPO/claude-instructions.md"
run_uninstall

set +e
run_install --unknown
status=$?
set -e
check 'インストールでも知らない引数は終了コード 2 で止まる' test "$status" -eq 2
check '知らない引数では何もリンクしない' test ! -e "$AGENT_LINK"

echo '== README と説明ページ =='

check '説明ページの画像の width と height が実際の大きさと合う' python3 - "$ROOT/docs" <<'PY'
import os, re, struct, sys
docs = sys.argv[1]
html = open(os.path.join(docs, "index.html"), encoding="utf-8").read()
found = re.findall(r'<img src="(images/[^"]+\.png)" width="(\d+)" height="(\d+)"', html)
sizes = {}
for src, width, height in found:
    with open(os.path.join(docs, src), "rb") as f:
        sizes[src] = struct.unpack(">II", f.read(24)[16:24]) == (int(width), int(height))
sys.exit(0 if len(sizes) == 4 and all(sizes.values()) else 1)
PY
check '作業ごとの画像はページ全体でなく上部だけを切り取る' python3 - "$ROOT/docs/images" <<'PY'
import os, struct, sys
images = sys.argv[1]
def size(name):
    with open(os.path.join(images, name), "rb") as f:
        return struct.unpack(">II", f.read(24)[16:24])
width, height = size("dashboard-desktop.png")
# 上端から手順のカンバンの終わりまで。作業の様子のパネルやセッションの欄までは入れない。
sys.exit(0 if width == 1280 and 1100 <= height <= 1400 and size("dashboard-mobile.png") == (390, 1000) else 1)
PY
for image in dashboard-desktop.png dashboard-mobile.png index-desktop.png dashboard-session.png; do
  check "README に ${image} を載せる" grep -qF "docs/images/${image}" "$ROOT/README.md"
done
for file in README.md docs/index.html; do
  check "${file} に取得しなくなった impeccable を書かない" fails grep -qi impeccable "$ROOT/$file"
done

echo
if ((failures > 0)); then
  printf '%d 件失敗しました。\n' "$failures"
  exit 1
fi
echo 'すべて成功しました。'
