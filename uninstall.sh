#!/usr/bin/env bash
# install.sh で作ったリンクと、~/.claude/CLAUDE.md の読み込みの 1 行を外し、nuu のサブエージェントを使えなくする。
# --purge を付けると、~/.claude/nuu/dashboards/ のダッシュボードと好みのスタイル、~/.claude/nuu/settings.json のモデルの指定も消す。リポジトリ自体は消さない。

set -euo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_DIR
readonly CLAUDE_MD="$HOME/.claude/CLAUDE.md"
readonly IMPORT_LINE='@~/.claude/nuu/claude-instructions.md'
readonly RULE_HEADING='## 長い作業の進捗ダッシュボード'
readonly DASHBOARDS="$HOME/.claude/nuu/dashboards"
readonly SETTINGS="$HOME/.claude/nuu/settings.json"

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

unlink_one "$REPO_DIR/agents/dashboard-builder.md" "$HOME/.claude/agents/dashboard-builder.md"
unlink_one "$REPO_DIR/agents/dashboard-updater.md" "$HOME/.claude/agents/dashboard-updater.md"
unlink_one "$REPO_DIR/hooks/dashboard-guard.sh" "$HOME/.claude/hooks/dashboard-guard.sh"
unlink_one "$REPO_DIR/hooks/dashboard-page.py" "$HOME/.claude/hooks/dashboard-page.py"
unlink_one "$REPO_DIR/hooks/dashboard-usage.py" "$HOME/.claude/hooks/dashboard-usage.py"
unlink_one "$REPO_DIR/hooks/dashboard-validate.py" "$HOME/.claude/hooks/dashboard-validate.py"
unlink_one "$REPO_DIR/claude-instructions.md" "$HOME/.claude/nuu/claude-instructions.md"
# 固定クライアントへのリンクを先に外す。--purge で消すときも、リンクの先のリポジトリには触れない。
unlink_one "$REPO_DIR/client" "$DASHBOARDS/_client"

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
  if [[ -d "$DASHBOARDS" ]]; then
    rm -rf "$DASHBOARDS"
    printf 'REMOVE %s\n' "$DASHBOARDS"
  else
    printf 'OK     %s（ありません）\n' "$DASHBOARDS"
  fi
  if [[ -f "$SETTINGS" ]]; then
    rm -f "$SETTINGS"
    printf 'REMOVE %s\n' "$SETTINGS"
  fi
fi
# 空になったフォルダーだけを消す。ダッシュボードが残っていれば消さない。
rmdir "$DASHBOARDS" 2>/dev/null || true
rmdir "$HOME/.claude/nuu" 2>/dev/null || true

if [[ -f "$CLAUDE_MD" ]] && grep -qxF "$RULE_HEADING" "$CLAUDE_MD"; then
  printf '\n%s に、ルールをコピーした「%s」の節が残っています。不要なら手で消してください。\n' "$CLAUDE_MD" "$RULE_HEADING"
fi
if [[ -d "$DASHBOARDS" ]]; then
  printf '\n%s のダッシュボードと好みのスタイルは残しています（--purge を付けると消します）。\n' "$DASHBOARDS"
fi
if [[ -f "$SETTINGS" ]]; then
  printf '\n%s のモデルの指定は残しています（--purge を付けると消します）。\n' "$SETTINGS"
fi
