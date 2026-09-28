#!/usr/bin/env bash
# nuu のサブエージェント、フック、ルールを ~/.claude へリンクし、固定クライアント（client/）を
# ~/.claude/nuu/dashboards/_client へリンクする。git やネットワークは使わない。
# ~/.claude/CLAUDE.md には、リンクしたルールを読み込む 1 行を足す。--no-claude-md を付けると足さない。
# 何度実行してもよい。既存のリンクと読み込みの 1 行はそのままにする。

set -euo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_DIR
readonly CLAUDE_MD="$HOME/.claude/CLAUDE.md"
# CLAUDE.md に足す 1 行。ルールの本文をコピーせず、リンクしたファイルを読み込ませる。
readonly IMPORT_LINE='@~/.claude/nuu/claude-instructions.md'
# claude-instructions.md の見出し。これがあれば、ルールの本文をコピーして追記してある。
readonly RULE_HEADING='## 長い作業の進捗ダッシュボード'

edit_claude_md=true
case "${1:-}" in
  "") ;;
  --no-claude-md) edit_claude_md=false ;;
  *)
    printf 'Usage: %s [--no-claude-md]\n' "$0" >&2
    exit 2
    ;;
esac

link_one() {
  local source="$1"
  local target="$2"

  if [[ -L "$target" && "$(readlink "$target")" == "$source" ]]; then
    printf 'OK     %s\n' "$target"
    return
  fi
  if [[ -e "$target" || -L "$target" ]]; then
    printf 'ERROR  %s は既に存在します。確認してから削除してください。\n' "$target" >&2
    exit 1
  fi

  mkdir -p "$(dirname "$target")"
  ln -s "$source" "$target"
  printf 'LINK   %s -> %s\n' "$target" "$source"
}

link_one "$REPO_DIR/agents/dashboard-builder.md" "$HOME/.claude/agents/dashboard-builder.md"
link_one "$REPO_DIR/agents/dashboard-updater.md" "$HOME/.claude/agents/dashboard-updater.md"
link_one "$REPO_DIR/hooks/dashboard-guard.sh" "$HOME/.claude/hooks/dashboard-guard.sh"
link_one "$REPO_DIR/hooks/dashboard-page.py" "$HOME/.claude/hooks/dashboard-page.py"
link_one "$REPO_DIR/hooks/dashboard-usage.py" "$HOME/.claude/hooks/dashboard-usage.py"
link_one "$REPO_DIR/hooks/dashboard-validate.py" "$HOME/.claude/hooks/dashboard-validate.py"
link_one "$REPO_DIR/claude-instructions.md" "$HOME/.claude/nuu/claude-instructions.md"
# すべての作業のページがこのリンク越しに同じ CSS と JavaScript を読むので、git pull だけで新しい動きになる。
link_one "$REPO_DIR/client" "$HOME/.claude/nuu/dashboards/_client"

has_import=false
has_copy=false
if [[ -f "$CLAUDE_MD" ]]; then
  grep -qxF "$IMPORT_LINE" "$CLAUDE_MD" && has_import=true
  grep -qxF "$RULE_HEADING" "$CLAUDE_MD" && has_copy=true
fi

if [[ "$edit_claude_md" != true ]]; then
  printf 'SKIP   %s（長い作業で使うには、次の 1 行を足してください）\n       %s\n' "$CLAUDE_MD" "$IMPORT_LINE"
elif [[ "$has_copy" == true && "$has_import" == true ]]; then
  printf 'WARN   %s に、読み込みの 1 行とルールのコピーの両方があります。「%s」の節を消してください。\n' "$CLAUDE_MD" "$RULE_HEADING" >&2
elif [[ "$has_copy" == true ]]; then
  printf 'WARN   %s にルールのコピーがあります。「%s」の節を消して、次の 1 行に置き換えてください。\n       %s\n' "$CLAUDE_MD" "$RULE_HEADING" "$IMPORT_LINE" >&2
elif [[ "$has_import" == true ]]; then
  printf 'OK     %s\n' "$CLAUDE_MD"
else
  # CLAUDE.md がシンボリックリンクでも、リンクを壊さずに実体へ追記する。
  mkdir -p "$(dirname "$CLAUDE_MD")"
  separator=""
  [[ -s "$CLAUDE_MD" ]] && separator=$'\n'
  printf '%s%s\n' "$separator" "$IMPORT_LINE" >>"$CLAUDE_MD"
  printf 'ADD    %s に %s\n' "$CLAUDE_MD" "$IMPORT_LINE"
fi
