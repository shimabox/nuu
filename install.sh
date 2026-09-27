#!/usr/bin/env bash
# dashboard-builder を ~/.claude へリンクし、impeccable のスキル部分を vendor/ へ取得する。
# 何度実行してもよい。既存のリンクはそのままにし、impeccable は IMPECCABLE_REF の版にそろえる。

set -euo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_DIR
readonly IMPECCABLE_URL="https://github.com/pbakaus/impeccable.git"
# 上流の変更で動きが変わらないよう、取得する版を固定する。
readonly IMPECCABLE_REF="skill-v4.3.1"
IMPECCABLE_DIR="$REPO_DIR/vendor/impeccable"
readonly IMPECCABLE_DIR

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
