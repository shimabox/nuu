#!/usr/bin/env bash
# dashboard-builder サブエージェント専用のガード。
# 作業ディレクトリの .claude-progress/ と自分のメモリだけを読み書きでき、
# このリポジトリの vendor/ にある impeccable だけを読み取りできる。Bash は date だけを許可する。
# ほかのツールはエージェント定義の tools で使えなくしている。結果の報告など Claude Code
# 内部のツールを止めないよう、このフックはファイル操作と Bash にだけ掛ける。

set -euo pipefail

input="$(cat)"
tool="$(jq -r '.tool_name // ""' <<<"$input")"
cwd="$(jq -r '.cwd // ""' <<<"$input")"

deny() {
  jq -n --arg reason "$1" '{hookSpecificOutput:{hookEventName:"PreToolUse",permissionDecision:"deny",permissionDecisionReason:$reason}}'
  exit 0
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
    [[ "$command_value" =~ $date_only ]] && exit 0
    deny "dashboard-builder が実行できる Bash は date だけです。"
    ;;
  Read|Write|Edit)
    [ -n "$cwd" ] || deny "作業ディレクトリを判定できません。"
    path="$(jq -r '.tool_input.file_path // ""' <<<"$input")"
    [ -n "$path" ] || deny "対象パスがありません。"
    target="$(realpath_of "$path")"
    if is_under "$target" "$(realpath_of .claude-progress)" \
      || is_under "$target" "$(realpath_of "$HOME/.claude/agent-memory/dashboard-builder")"; then
      exit 0
    fi
    # リンク元ではなく、このスクリプトの実体があるリポジトリから impeccable の場所を求める。
    repo_dir="$(dirname "$(dirname "$(realpath_of "${BASH_SOURCE[0]}")")")"
    if [[ "$tool" == Read ]] \
      && is_under "$target" "$repo_dir/vendor/impeccable/plugin/skills/impeccable"; then
      exit 0
    fi
    deny "dashboard-builder は .claude-progress/ と自分のメモリ以外を読み書きできません: $path"
    ;;
esac
