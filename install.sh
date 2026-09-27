#!/usr/bin/env bash
# dashboard-builder を ~/.claude へリンクし、impeccable のスキル部分を vendor/ へ取得する。
# ~/.claude/CLAUDE.md には、リンクしたルールを読み込む 1 行を足す。--no-claude-md を付けると足さない。
# 何度実行してもよい。既存のリンクと読み込みの 1 行はそのままにし、impeccable は IMPECCABLE_REF の版にそろえる。

set -euo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_DIR
readonly IMPECCABLE_URL="https://github.com/pbakaus/impeccable.git"
# 上流の変更で動きが変わらないよう、取得する版を固定する。
readonly IMPECCABLE_REF="skill-v4.3.1"
IMPECCABLE_DIR="$REPO_DIR/vendor/impeccable"
readonly IMPECCABLE_DIR
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
link_one "$REPO_DIR/hooks/dashboard-usage.py" "$HOME/.claude/hooks/dashboard-usage.py"
link_one "$REPO_DIR/hooks/dashboard-validate.py" "$HOME/.claude/hooks/dashboard-validate.py"
link_one "$REPO_DIR/claude-instructions.md" "$HOME/.claude/nuu/claude-instructions.md"

if [[ -d "$IMPECCABLE_DIR/.git" ]]; then
  git -C "$IMPECCABLE_DIR" fetch --quiet origin tag "$IMPECCABLE_REF"
else
  git clone --quiet --filter=blob:none --sparse --no-checkout "$IMPECCABLE_URL" "$IMPECCABLE_DIR"
fi
# リポジトリ直下の CLAUDE.md などを取り出さないよう、スキルのフォルダーだけを指定する。
git -C "$IMPECCABLE_DIR" sparse-checkout set --no-cone /plugin/skills/impeccable/
git -C "$IMPECCABLE_DIR" -c advice.detachedHead=false checkout --quiet "$IMPECCABLE_REF"
printf 'OK     impeccable %s\n' "$IMPECCABLE_REF"

# エージェント定義からは、clone した場所に関係なくこのリンクで impeccable を読む。
link_one "$IMPECCABLE_DIR/plugin/skills/impeccable" "$HOME/.claude/nuu/impeccable"

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
