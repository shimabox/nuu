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
cp -R "$ROOT/agents" "$ROOT/client" "$ROOT/hooks" "$ROOT/install.sh" "$ROOT/uninstall.sh" "$ROOT/claude-instructions.md" "$REPO/"

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
check 'トークン量のデータの形を項目名まで示す' body_has '"byCategory": {'
check '合計は totals.total で読む' body_has '合計 `totals.total`'
check '内訳は byCategory で読む' body_has '作業本体 `byCategory.main.total`'
check 'トークン量は上部に合計だけを出す' body_has '上部: 進み具合などの要約の項目の 1 つとして、合計だけを出す'
check '上部の合計はほかの項目と同じく値を先に出す' body_has '値を大きく（例: 「19.1 万」）、その後ろに薄いラベル「トークン」と下向きの矢印を置く'
check '上部の合計は項目全体を 1 つのリンクにする' body_has '上部の項目全体を、下部の詳しい表示への 1 つのページ内リンク（`<a href="#usage">`）にする。下線は付けない'
check '詳しいトークン量はページの一番下に置く' body_has '下部: ページの一番下に `id="usage"` の見出し付きの場所を置き'
check 'トークン量は目安と注記する' body_has '目安です。サブエージェントの出力トークンは少なめに出ることがあります'
check '一覧には目安の注記を付けない' body_has '上部と一覧には注記を付けない'
check '一覧でも作業ごとの合計を表示する' body_has '一覧では、各作業の `.usage.js` を script 要素で読み込み'
check 'セッションの ID と作業ディレクトリのデータの形を示す' body_has '"sessionId": "'
check 'セッションの値は .usage.js からだけ取る' body_has '値は `.usage.js` からだけ取る。データファイルに書かない、推測しない'
check 'セッションはトークン量の直前に置く' body_has '`id="usage"` の場所の直前に、`id="session"` の見出し付きの場所を置き'
check '再開のコマンドは作業ディレクトリに移ってから実行する' body_has '`cd <作業ディレクトリ> && claude --resume <セッションの ID>`'
check '作業ディレクトリは単一引用符で囲む' body_has "作業ディレクトリは単一引用符で囲み、中の \`'\` は \`'\\''\` に置き換える"
check 'セッションの ID と再開のコマンドをコピーできる' body_has 'それぞれにコピーのボタンを付ける'
check 'コピーに成功したときだけコピーしたと示す' body_has '`navigator.clipboard.writeText` が成功したときだけ「コピーしました」と短く示す'
check '更新が止まっている警告から再開のコマンドへ移れる' body_has '警告の中に再開のコマンドへのページ内リンク（`<a href="#session">`）を'
check '一覧ではセッションの ID を短く出す' body_has 'セッションの ID の先頭 8 文字を目立たない色で出す'
check '全体の一覧を更新する' body_has '全体の一覧 `~/.claude/nuu/dashboards/index.html` を、setup、update、finish のたびに更新する'
check '一覧ではこの作業の行だけを変える' body_has 'この作業の行だけを追加・更新する。ほかの作業の行は変えない'
check '一覧では更新が止まった作業を目立たせる' body_has '進行中なのに 15 分以上更新がない作業は'
check '一覧は進行中、中断中、完了の順に分ける' body_has '進行中、中断中、完了の順に分けて並べ'
check '一覧では中断中と完了の作業に止まった警告を出さない' body_has '中断中と完了の作業には出さない'
check '作業全体の状態は進行中、中断中、完了の 3 つで持つ' body_has '`status` に `active`（進行中）、`paused`（中断中）、`done`（完了）のどれかで持つ'
check '作業全体の状態は色と文字の両方で見分けられるようにする' body_has '3 つを色と文字の両方で見分けられるように表示し'
check '知らない状態は進行中として扱う' body_has '知らない値は進行中として扱う'
check '作業ごとのページでも中断中と完了には止まった警告を出さない' body_has '作業が進行中で、15 分以上更新がなければ目立つ警告を出す。中断中と完了のときは出さない'
check 'ダッシュボードと一覧に favicon を入れる' body_has '`<head>` に、次の favicon の 1 行を一字も変えずに入れる'
check 'favicon は説明ページのロゴと同じ' python3 - "$ROOT/agents/dashboard-builder.md" "$ROOT/docs/favicon.svg" <<'PY'
import re, sys, urllib.parse
spec, logo = (open(path, encoding="utf-8").read() for path in sys.argv[1:])
found = re.search(r'<link rel="icon" href="data:image/svg\+xml,([^"]+)">', spec)
sys.exit(0 if found and urllib.parse.unquote(found.group(1)) == logo.strip().replace('"', "'") else 1)
PY
check 'setup の返答でダッシュボードのパスを返す' body_has '以後の update と finish でこのパスを渡す'
check '作業ディレクトリにはダッシュボードを作らない' fails grep -q 'claude-progress' <<<"$body"
check 'データは HTML と同じフォルダーのデータファイルに置く' body_has '`<HTML のファイル名から .html を除いたもの>.data.js` に置く'
check '一覧のデータも別のファイルに置く' body_has '`~/.claude/nuu/dashboards/index.data.js` に置く'
check 'データファイルは決まった呼び出しの間に JSON だけを書く' body_has '1 行目を `window.nuuDashboardData(`、最終行を `);` にし、その間に JSON だけを書く'
check '定期的なページの再読み込みはしない' body_has '定期的なページの再読み込みはしない。`<meta http-equiv="refresh">` は使わない'
check '10 秒ごとにデータファイルだけを読み直す' body_has 'その後は 10 秒ごとに、データファイルを読む script 要素を作って'
check 'file:// でも読めるよう fetch を使わない' body_has '`fetch` や XMLHttpRequest は使わない'
check '1 回読めなかっただけでは警告を出さない' body_has '1 回読めなかっただけでは警告を出さない。3 回続けて読めなかったときだけ警告を出し、読めたら消す'
check '警告の文に「隣の」のような位置の言い方を使わない' body_has '「隣の」のような位置の言い方は使わず'
check '同じデータなら描き直さない' body_has '前回と同じデータ（`JSON.stringify` の結果が同じ）なら描き直さない'
check 'データに構成の版を持たせる' body_has 'データの一番上に、構成の版 `"layout": <UNIX 秒>` を置く'
check 'HTML を書き終えてからデータファイルを書く' body_has 'HTML を書き終えてから、この値を入れたデータファイルを書く'
check '構成が変わったときだけページを読み直す' body_has '読み直したデータの `layout` がそれと違えば、構成が変わったので `location.reload()` で 1 回だけ読み直す'
check '構成の変化で読み直すときもスクロール位置を保つ' body_has '再読み込みの前にスクロール位置を sessionStorage に保存し、読み込んだあとに戻す'
check 'トークン量も 10 秒ごとに読み直す' body_has '`<作業名>.usage.js` をデータファイルと同じ方法で、開いたときと 10 秒ごとに読み直し'
check '開いたときは script 要素の src でデータファイルを読む' body_has '`<script src="<データファイル名>"></script>` を置いて読む'
check 'ページの再読み込みの指定を書かない' fails body_has '<meta http-equiv="refresh" content="10">'
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
check 'カードやパネルの中身を枠からはみ出させない' body_has 'カードやパネルの中身は、枠からはみ出させない'
check '入りきらないラベルと値は縦に積む' body_has 'ラベルと値が横に入りきらないときは縦に積む'
check '下部のトークン量はラベルの下に値を置く' body_has '下部の各項目は、ラベルの下に値を置く'
check '狭い画面では表を使わずカードにする' body_has '狭い画面では表を使わない。'
check '時刻や件数を途中で折り返さない' body_has '時刻、件数、進み具合（3 / 8 など）は途中で折り返さない'
check 'テンプレートを使い回さない' body_has 'テンプレートを使い回さない'
for section in 'タスクと状態' '利用者への質問' '最新の成果物' '止まっているもの'; do
  check "必ず載せる内容に「${section}」がある" body_has "$section"
done
check 'impeccable のランチャーは実行しない' body_has 'ランチャー（`scripts/impeccable`）は実行しない'
check 'impeccable は clone した場所に関係なく ~/.claude/nuu/impeccable から読む' body_has '`~/.claude/nuu/impeccable/`'
for file in agents/dashboard-builder.md agents/dashboard-updater.md hooks/dashboard-guard.sh hooks/dashboard-usage.py \
  hooks/dashboard-validate.py install.sh uninstall.sh claude-instructions.md; do
  check "${file} に利用者固有のパスを書かない" fails grep -qE '/Users/|/home/|shimabox/github' "$REPO/$file"
done

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

check 'builder は途中の更新と完了を updater に任せる' has_line 'description: 長い作業の進捗ダッシュボード（~/.claude/nuu/dashboards/ の作業ごとの HTML と、全体の一覧）を用意する専用エージェント。5 ステップを超える作業や 30 分を超えそうな作業の着手前、好みのスタイルの変更、構成の見直しに使う。途中の更新と完了は dashboard-updater が行う。'
check 'builder は表示に使うデータをすべて JSON に入れる' body_has '表示に使うデータはすべてデータファイル（`.data.js`）の JSON に入れ、HTML に直接書かない'
check 'builder も書いたあとに JSON を確かめる' has_line "          command: \"\\\"\$HOME/.claude/hooks/dashboard-validate.py\\\"\""
check 'updater の名前は dashboard-updater' updater_line 'name: dashboard-updater'
check 'updater のモデルは haiku' updater_line 'model: haiku'
check 'updater は Write を使えない' updater_line 'tools: Read, Edit, Bash'
check 'updater はデザインのスキルを読み込まない' fails grep -q '^skills:' <<<"$updater_frontmatter"
check 'updater もガードを通す' updater_line '    - matcher: "Read|Write|Edit|Bash"'
check 'updater は書いたあとに JSON を確かめる' updater_line "          command: \"\\\"\$HOME/.claude/hooks/dashboard-validate.py\\\"\""
check 'updater の分もトークン量を集計する' updater_line "          command: \"\\\"\$HOME/.claude/hooks/dashboard-usage.py\\\"\""
check 'updater はデータファイルの JSON だけを書き換える' updater_says 'データファイルの `window.nuuDashboardData(` と `);` の間にある JSON だけを Edit で書き換える'
check 'updater は HTML を読まない' updater_says 'HTML は読まない'
check 'updater は構成の版を変えない' updater_says '構成の版 `layout` は変えない'
check 'updater は一覧のデータファイルを更新する' updater_says '全体の一覧のデータ（`~/.claude/nuu/dashboards/index.data.js`）のうち'
check 'updater は最初に 1 回ずつ読み、読み直さない' updater_says '最初に 1 回ずつ Read する。読み直さない'
check 'updater は JSON の確認をフックに任せる' updater_says '書き換えたあとの JSON は、フックが確かめる'
check 'updater は回答の内容と時刻を残す' updater_says '回答の内容 `answer` と回答した時刻 `answeredAt` を残す'
check 'updater は一覧のこの作業の行だけを変える' updater_says 'この作業の行（`href` がこのダッシュボードを指す行）だけを更新する'
check 'updater はパスがなければ推測しない' updater_says '何もせずに「パスが必要です」と返す'
check 'updater は構成を変えずに builder へ回す' updater_says '何も変えずに「構成の見直しが必要です」と理由を添えて返す'
check 'updater はトークン量のファイルに触れない' updater_says '`.usage.js` を作らない、編集しない'
check 'updater は好みやメモリに触れない' updater_says '好みのスタイルやメモリに触れない'
check 'updater は完了した作業の状態を done にする' updater_says '作業全体の状態 `status` を `done`（完了）にし'
check 'updater は完了で一覧の行の状態もそろえる' updater_says '一覧のこの作業の行の状態も `done` にそろえる'
check 'updater は消す作業の行だけを一覧から外す' updater_says 'この作業の行（`href` がこのダッシュボードを指す行）だけを消す。ほかの行は変えない'
check 'updater は外すときに通常の更新手順を行わない' updater_says 'この操作では、上の「更新のしかた」の手順は行わない。作業のデータファイルは読まず、一覧のデータだけを 1 回 Read し'
check 'updater は一覧に行がなければ何も変えない' updater_says '一覧にこの作業の行がなければ、何も変えずに「一覧に行がありません」と返す'
check 'updater は消すときも作業のファイルに触れない' updater_says 'ファイルは呼び出し元が消す'
check 'updater は途中で止めた作業を中断中にする' updater_says '作業全体の状態 `status` を `paused`（中断中）にする。完了にはしない'
check 'updater は再開した作業を進行中に戻す' updater_says '再開したと渡されたら、`status` を `active`（進行中）に戻す'
check 'updater は中断と再開で一覧の行の状態もそろえる' updater_says '一覧のこの作業の行の状態を同じ値にそろえる'

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
    '{tool_name: $tool, transcript_path: $log, agent_id: "setup", session_id: "session", cwd: "/work/it'"'"'s here", tool_input: {file_path: $path}}' \
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

log_line 2026-09-27T02:00:20.000Z main-2 5 5 0 0 >>"$MAIN_LOG"
rm "$SESSION/subagents/agent-setup.jsonl"
check '2 回目の集計が成功する' run_usage Edit "$DASH_DIR/project/task.data.js"
expect_usage '2 回目も用意を始めた時刻を保つ' '.since | todate' 2026-09-27T02:00:00Z
expect_usage '2 回目は増えた分を足す' '.byCategory.main.total' 1170

check '一覧のデータを書いても成功する' run_usage Write "$DASH_DIR/index.data.js"
check '一覧のトークン量は作らない' test ! -e "$DASH_DIR/index.usage.js"
check '好みを書いても成功する' run_usage Write "$DASH_DIR/prefs.data.js"
check '好みのトークン量は作らない' test ! -e "$DASH_DIR/prefs.usage.js"
check '壊れた入力でも作業を止めない' bash -c '"$1" <<<"not json" 2>/dev/null' _ "$USAGE_LINK"

log_line 2026-09-27T02:00:30.000Z update-1 4 6 0 0 >"$SESSION/subagents/agent-updater.jsonl"
printf '{"agentType":"dashboard-updater"}\n' >"$SESSION/subagents/agent-updater.meta.json"
check 'updater の書き込みでも集計が成功する' run_usage Edit "$DASH_DIR/project/task.data.js"
expect_usage 'updater の分もダッシュボードに数える' '.byCategory.dashboard.total' 10

log_line 2026-09-27T02:00:40.000Z update-2 1 1 0 0 >>"$SESSION/subagents/agent-updater.jsonl"
check 'スタブ（.html）の書き込みでも失敗しない' run_usage Write "$DASH_DIR/project/task.html"
expect_usage 'スタブ（.html）の書き込みでは集計しない' '.byCategory.dashboard.total' 10
check 'もう一度データを書いたら集計が成功する' run_usage Edit "$DASH_DIR/project/task.data.js"
expect_usage 'データを書けば増えた分を数える' '.byCategory.dashboard.total' 12

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

echo '== ページと一覧 =='

readonly PAGE_LINK="$TEST_HOME/.claude/hooks/dashboard-page.py"
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

echo '== install.sh =='

rm -rf "$TEST_HOME/.claude" "$REPO/vendor"
mkdir -p "$TEST_HOME/.claude"
printf 'keep\n' >"$TEST_HOME/.claude/CLAUDE.md"

check 'インストールが成功する' run_install
check 'エージェント定義をリポジトリへのリンクにする' links_to "$AGENT_LINK" "$REPO/agents/dashboard-builder.md"
check 'ガードをリポジトリへのリンクにする' links_to "$GUARD_LINK" "$REPO/hooks/dashboard-guard.sh"
check '集計スクリプトをリポジトリへのリンクにする' links_to "$USAGE_LINK" "$REPO/hooks/dashboard-usage.py"
check 'JSON の確認スクリプトをリポジトリへのリンクにする' links_to "$VALIDATE_LINK" "$REPO/hooks/dashboard-validate.py"
check '更新専用エージェントをリポジトリへのリンクにする' links_to "$UPDATER_LINK" "$REPO/agents/dashboard-updater.md"
check 'impeccable を sparse clone で取得する' \
  grep -qxF "clone --quiet --filter=blob:none --sparse --no-checkout https://github.com/pbakaus/impeccable.git $REPO/vendor/impeccable" "$GIT_LOG"
check 'impeccable はスキル部分だけを取り出す' \
  grep -qxF -- "-C $REPO/vendor/impeccable sparse-checkout set --no-cone /plugin/skills/impeccable/" "$GIT_LOG"
check 'impeccable は固定した版を使う' \
  grep -qxF -- "-C $REPO/vendor/impeccable -c advice.detachedHead=false checkout --quiet skill-v4.3.1" "$GIT_LOG"
check 'impeccable を ~/.claude/nuu/impeccable にリンクする' links_to "$IMPECCABLE_LINK" "$IMPECCABLE_DIR"
check '2 回目も成功する' run_install
check '2 回目は固定した版だけを取得する' grep -qxF -- "-C $REPO/vendor/impeccable fetch --quiet origin tag skill-v4.3.1" "$GIT_LOG"
check 'ルールのファイルをリポジトリへのリンクにする' links_to "$RULES_LINK" "$REPO/claude-instructions.md"
check 'CLAUDE.md にルールを読み込む 1 行を足す' grep -qxF "$IMPORT_LINE" "$CLAUDE_MD"
check 'CLAUDE.md のほかの内容は残す' grep -qxF keep "$CLAUDE_MD"
check '2 回目は読み込みの 1 行を重ねて足さない' test "$(grep -cxF "$IMPORT_LINE" "$CLAUDE_MD")" -eq 1

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
check 'JSON の確認スクリプトのリンクを外す' test ! -e "$VALIDATE_LINK"
check '更新専用エージェントのリンクを外す' test ! -e "$UPDATER_LINK"
check '好みのスタイルは残す' test -f "$MEMORY_DIR/style.md"
check 'impeccable へのリンクを外す' test ! -e "$IMPECCABLE_LINK"
check '空になった ~/.claude/nuu を消す' test ! -e "$TEST_HOME/.claude/nuu"
check 'impeccable は残す' test -d "$REPO/vendor/impeccable"
check 'ルールのファイルのリンクを外す' test ! -e "$RULES_LINK"
check 'CLAUDE.md の読み込みの 1 行を外す' fails grep -qxF "$IMPORT_LINE" "$CLAUDE_MD"
check 'CLAUDE.md のほかの内容は残す（アンインストール）' grep -qxF keep "$CLAUDE_MD"
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

echo
if ((failures > 0)); then
  printf '%d 件失敗しました。\n' "$failures"
  exit 1
fi
echo 'すべて成功しました。'
