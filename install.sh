#!/usr/bin/env bash
# nuu のサブエージェント、フック、ルールを ~/.claude へリンクし、固定クライアント（client/）を
# ~/.claude/nuu/dashboards/_client へリンクする。git やネットワークは使わない。
# ~/.claude/CLAUDE.md には、リンクしたルールを読み込む 1 行を足す。--no-claude-md を付けると足さない。
# Claude Code の mod（mod/）は ~/.claude/nuu/mod へリンクし、~/.claude/settings.json の
# env.CLAUDE_CODE_PLUGIN_DIRS に足して読み込ませる。--no-mod を付けると settings.json に足さない。
# 何度実行してもよい。既存のリンクと読み込みの 1 行はそのままにする。

set -euo pipefail

REPO_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
readonly REPO_DIR
readonly CLAUDE_MD="$HOME/.claude/CLAUDE.md"
# CLAUDE.md に足す 1 行。ルールの本文をコピーせず、リンクしたファイルを読み込ませる。
readonly IMPORT_LINE='@~/.claude/nuu/claude-instructions.md'
# claude-instructions.md の見出し。これがあれば、ルールの本文をコピーして追記してある。
readonly RULE_HEADING='## 長い作業の進捗ダッシュボード'
readonly SETTINGS_JSON="$HOME/.claude/settings.json"
# CLAUDE_CODE_PLUGIN_DIRS に足すパス。Claude Code は先頭の ~ を展開する。
# shellcheck disable=SC2088 # 展開せずに settings.json へ書く。
readonly MOD_DIR_ENTRY='~/.claude/nuu/mod'

edit_claude_md=true
edit_settings=true
for arg in "$@"; do
  case "$arg" in
    --no-claude-md) edit_claude_md=false ;;
    --no-mod) edit_settings=false ;;
    *)
      printf 'Usage: %s [--no-claude-md] [--no-mod]\n' "$0" >&2
      exit 2
      ;;
  esac
done

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
# mod もリンク越しに読むので、git pull すれば次に起動したセッションから新しい動きになる。
link_one "$REPO_DIR/mod" "$HOME/.claude/nuu/mod"

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

# settings.json の env.CLAUDE_CODE_PLUGIN_DIRS に mod のパスを足す。ほかのパスは残し、: でつなぐ。
if [[ "$edit_settings" != true ]]; then
  printf 'SKIP   %s（/nuu を使うには、env.CLAUDE_CODE_PLUGIN_DIRS に %s を足してください）\n' "$SETTINGS_JSON" "$MOD_DIR_ENTRY"
elif [[ -f "$SETTINGS_JSON" ]] && ! jq -e 'type == "object"' "$SETTINGS_JSON" >/dev/null 2>&1; then
  printf 'WARN   %s を JSON として読めないので変えません。env.CLAUDE_CODE_PLUGIN_DIRS に %s を足してください。\n' "$SETTINGS_JSON" "$MOD_DIR_ENTRY" >&2
else
  current=""
  [[ -f "$SETTINGS_JSON" ]] && current="$(jq -r '.env.CLAUDE_CODE_PLUGIN_DIRS // ""' "$SETTINGS_JSON")"
  if [[ ":$current:" == *":$MOD_DIR_ENTRY:"* || ":$current:" == *":$HOME/.claude/nuu/mod:"* ]]; then
    printf 'OK     %s\n' "$SETTINGS_JSON"
  else
    mkdir -p "$(dirname "$SETTINGS_JSON")"
    [[ -f "$SETTINGS_JSON" ]] || printf '{}\n' >"$SETTINGS_JSON"
    tmp="$(mktemp)"
    jq --arg entry "$MOD_DIR_ENTRY" \
      '.env = ((.env // {}) | .CLAUDE_CODE_PLUGIN_DIRS = ([(.CLAUDE_CODE_PLUGIN_DIRS // "" | select(. != "")), $entry] | join(":")))' \
      "$SETTINGS_JSON" >"$tmp"
    # settings.json がシンボリックリンクでも、リンクを壊さずに実体へ書き戻す。
    cat "$tmp" >"$SETTINGS_JSON"
    rm -f "$tmp"
    printf 'ADD    %s の env.CLAUDE_CODE_PLUGIN_DIRS に %s\n' "$SETTINGS_JSON" "$MOD_DIR_ENTRY"
  fi
fi
