#!/usr/bin/env bash
# dashboard-builder と dashboard-updater 専用のガード。
# 読めるのは ~/.claude/nuu/dashboards/ の下だけ。書けるのは、作業のデータファイル
# （<プロジェクト名>/<開始日時>-<作業名>.data.js）と好み（prefs.data.js）だけ。Bash は date だけを許可する。
# スタブ（.html）、一覧のデータ（index.data.js）、トークン量（.usage.js）はフックが書くので、モデルには書かせない。
# _client は固定クライアント（リポジトリの client/）へのリンクなので、読み書きさせない。
# 許可した操作は、作業ディレクトリの外でも確認なしで通るよう、明示的に allow を返す。
# ほかのツールはエージェント定義の tools で使えなくしている。結果の報告など Claude Code
# 内部のツールを止めないよう、このフックはファイル操作と Bash にだけ掛ける。

set -euo pipefail

input="$(cat)"
tool="$(jq -r '.tool_name // ""' <<<"$input")"
cwd="$(jq -r '.cwd // ""' <<<"$input")"

decide() {
  jq -n --arg decision "$1" --arg reason "$2" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:$decision,permissionDecisionReason:$reason}}'
  exit 0
}

allow() {
  decide allow "$1"
}

deny() {
  decide deny "$1"
}

# シンボリックリンクや ../ を解決した絶対パスを返す。存在しないファイルにも使える。
realpath_of() {
  python3 -c 'import os, sys; print(os.path.realpath(os.path.join(sys.argv[1], os.path.expanduser(sys.argv[2]))))' "$cwd" "$1"
}

is_under() {
  [[ "$1" == "$2" || "$1" == "$2"/* ]]
}

case "$tool" in
  Bash)
    command_value="$(jq -r '.tool_input.command // ""' <<<"$input")"
    # 現在時刻の取得だけを許可する（例: date +%s）。; | & $ ` などは通さない。
    date_only='^date( [-+%A-Za-z0-9:_.]+)*$'
    [[ "$command_value" =~ $date_only ]] && allow "ダッシュボードの時刻取得"
    deny "ダッシュボードのエージェントが実行できる Bash は date だけです。"
    ;;
  Read|Write|Edit)
    [ -n "$cwd" ] || deny "作業ディレクトリを判定できません。"
    path="$(jq -r '.tool_input.file_path // ""' <<<"$input")"
    [ -n "$path" ] || deny "対象パスがありません。"
    target="$(realpath_of "$path")"
    dashboards="$(realpath_of "$HOME/.claude/nuu/dashboards")"
    is_under "$target" "$dashboards" \
      || deny "ダッシュボードのエージェントは ~/.claude/nuu/dashboards/ 以外を読み書きできません: $path"
    relative="${target#"$dashboards"/}"
    [[ "$relative" == _client || "$relative" == _client/* ]] \
      && deny "_client は固定クライアントの置き場所なので、読み書きできません: $path"
    [[ "$tool" == Read ]] && allow "ダッシュボードの読み取り"
    [[ "$relative" == prefs.data.js ]] && allow "好みのスタイルの書き込み"
    task_data='^[^/.][^/]*/[^/.][^/]*\.data\.js$'
    [[ "$relative" =~ $task_data ]] && allow "作業のデータの書き込み"
    deny "書けるのは、作業のデータ（~/.claude/nuu/dashboards/<プロジェクト名>/<開始日時>-<作業名>.data.js）と好み（~/.claude/nuu/dashboards/prefs.data.js）だけです。スタブ（.html）、一覧のデータ（index.data.js）、トークン量（.usage.js）はフックが書きます: $path"
    ;;
esac
