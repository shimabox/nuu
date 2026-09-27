#!/usr/bin/env bash
# install.sh で作ったリンクと、~/.claude/CLAUDE.md の読み込みの 1 行を外し、nuu のサブエージェントを使えなくする。
# --purge を付けると、保存した好みのスタイル（エージェントのメモリ）、ダッシュボード、
# vendor/impeccable も消す。リポジトリ自体は消さない。

set -euo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_DIR
readonly CLAUDE_MD="$HOME/.claude/CLAUDE.md"
readonly IMPORT_LINE='@~/.claude/nuu/claude-instructions.md'
readonly RULE_HEADING='## 長い作業の進捗ダッシュボード'

purge=false
case "${1:-}" in
  "") ;;
  --purge) purge=true ;;
  *)
    printf 'Usage: %s [--purge]\n' "$0" >&2
    exit 2
    ;;
esac

unlink_one() {
  local source="$1"
  local target="$2"

  if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
    rm "$target"
    printf 'UNLINK %s\n' "$target"
  elif [[ -e "$target" || -L "$target" ]]; then
    printf 'SKIP   %s（このリポジトリへのリンクではないので残します）\n' "$target" >&2
  else
    printf 'OK     %s（リンクはありません）\n' "$target"
  fi
}

remove_dir() {
  local dir="$1"

  if [[ -d "$dir" ]]; then
    rm -rf "$dir"
    printf 'REMOVE %s\n' "$dir"
  else
    printf 'OK     %s（ありません）\n' "$dir"
  fi
}

unlink_one "$REPO_DIR/agents/dashboard-builder.md" "$HOME/.claude/agents/dashboard-builder.md"
unlink_one "$REPO_DIR/agents/dashboard-updater.md" "$HOME/.claude/agents/dashboard-updater.md"
unlink_one "$REPO_DIR/hooks/dashboard-guard.sh" "$HOME/.claude/hooks/dashboard-guard.sh"
unlink_one "$REPO_DIR/hooks/dashboard-usage.py" "$HOME/.claude/hooks/dashboard-usage.py"
unlink_one "$REPO_DIR/hooks/dashboard-validate.py" "$HOME/.claude/hooks/dashboard-validate.py"
unlink_one "$REPO_DIR/vendor/impeccable/plugin/skills/impeccable" "$HOME/.claude/nuu/impeccable"
unlink_one "$REPO_DIR/claude-instructions.md" "$HOME/.claude/nuu/claude-instructions.md"

if [[ -f "$CLAUDE_MD" ]] && grep -qxF "$IMPORT_LINE" "$CLAUDE_MD"; then
  # 読み込みの 1 行だけを消す。シンボリックリンクでも実体へ書き戻す。
  tmp="$(mktemp)"
  grep -vxF "$IMPORT_LINE" "$CLAUDE_MD" >"$tmp" || true
  cat "$tmp" >"$CLAUDE_MD"
  rm -f "$tmp"
  printf 'REMOVE %s の %s\n' "$CLAUDE_MD" "$IMPORT_LINE"
else
  printf 'OK     %s（読み込みの 1 行はありません）\n' "$CLAUDE_MD"
fi

if [[ "$purge" == true ]]; then
  remove_dir "$HOME/.claude/agent-memory/dashboard-builder"
  remove_dir "$HOME/.claude/nuu/dashboards"
  remove_dir "$REPO_DIR/vendor/impeccable"
fi
rmdir "$HOME/.claude/nuu" 2>/dev/null || true

if [[ -f "$CLAUDE_MD" ]] && grep -qxF "$RULE_HEADING" "$CLAUDE_MD"; then
  printf '\n%s に、ルールをコピーした「%s」の節が残っています。不要なら手で消してください。\n' "$CLAUDE_MD" "$RULE_HEADING"
fi
if [[ "$purge" != true ]]; then
  printf '\n~/.claude/nuu/dashboards/ のダッシュボードは残しています（--purge を付けると消します）。\n'
fi
