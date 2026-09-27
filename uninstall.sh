#!/usr/bin/env bash
# install.sh で作ったリンクを外し、dashboard-builder を使えなくする。
# --purge を付けると、保存した好みのスタイル（エージェントのメモリ）、ダッシュボード、
# vendor/impeccable も消す。リポジトリ自体は消さない。

set -euo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_DIR

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
unlink_one "$REPO_DIR/hooks/dashboard-guard.sh" "$HOME/.claude/hooks/dashboard-guard.sh"
unlink_one "$REPO_DIR/vendor/impeccable/plugin/skills/impeccable" "$HOME/.claude/nuu/impeccable"

if [[ "$purge" == true ]]; then
  remove_dir "$HOME/.claude/agent-memory/dashboard-builder"
  remove_dir "$HOME/.claude/nuu/dashboards"
  remove_dir "$REPO_DIR/vendor/impeccable"
fi
rmdir "$HOME/.claude/nuu" 2>/dev/null || true

cat <<'EOF'

次のものは自動では消しません。不要なら手で消してください。
- ~/.claude/CLAUDE.md の「長い作業の進捗ダッシュボード」の節
  （dashboard-builder がなければ適用されない条件付きのルールです）
EOF

if [[ "$purge" != true ]]; then
  echo '- ~/.claude/nuu/dashboards/ のダッシュボード（--purge を付けると消します）'
fi
