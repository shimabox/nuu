# セットアップ

[README](../README.md) に戻る

## 必要なもの

- macOS または Linux（Windows には対応していません）
- Claude Code。サブエージェント定義の `effort`、`hooks` を使います。2.1.283 で動作を確認しています
- bash、jq、python3（clone に git）

### 使える環境

nuu は、`~/.claude` に置いたサブエージェント、フック、ルールで動き、ダッシュボードを `~/.claude/nuu/dashboards/` に作ります。そのため、Claude Code を手元で動かすときだけ使えます。

| 環境 | 使えるか |
|---|---|
| Claude Code CLI | 使える |
| デスクトップアプリで開く Code（ローカル） | 使える |
| クラウド（ブラウザで開く claude.ai/code、デスクトップアプリで選んだクラウド） | 使えない。手元にある `~/.claude` を読まず、ファイルもクラウド側に作られるため |
| Cowork（デスクトップアプリ） | 使えない。`~/.claude/agents/` に置いたサブエージェントを読み込まないため |

## インストール

1. 好きな場所に clone して、`install.sh` を実行します。

   ```sh
   git clone https://github.com/shimabox/nuu.git
   cd nuu
   ./install.sh
   ```

   次のリンクを作ります。既存のファイルがある場合は上書きせずに止まります。`install.sh` は git やネットワークを使いません。

   - `~/.claude/agents/dashboard-builder.md`
   - `~/.claude/agents/dashboard-updater.md`
   - `~/.claude/hooks/dashboard-guard.sh`
   - `~/.claude/hooks/dashboard-validate.py`
   - `~/.claude/hooks/dashboard-page.py`
   - `~/.claude/hooks/dashboard-usage.py`
   - `~/.claude/nuu/claude-instructions.md`
   - `~/.claude/nuu/dashboards/_client`（リポジトリの `client/` へのリンク）
   - `~/.claude/nuu/mod`（リポジトリの `mod/` へのリンク）

2. `install.sh` は、`~/.claude/CLAUDE.md` の末尾に次の 1 行を足します。長い作業で `dashboard-builder` を使うよう Claude Code に指示するルール（`claude-instructions.md`）を読み込む行です。ルールの本文はコピーしないので、リポジトリを更新すればルールも最新になります。

   ```text
   @~/.claude/nuu/claude-instructions.md
   ```

   `CLAUDE.md` を書き換えたくないときは、`./install.sh --no-claude-md` を実行し、上の 1 行を自分で足します。以前の手順でルールの本文を追記している場合は、`install.sh` は 1 行を足さずに知らせるので、その節を消して 1 行に置き換えてください。

3. `install.sh` は、`~/.claude/settings.json` の `env.CLAUDE_CODE_PLUGIN_DIRS` に `~/.claude/nuu/mod` を足します。Claude Code の起動時に mod を読み込ませ、`/nuu` を使えるようにするためです。ほかのパスがすでにあれば残し、`:` でつなぎます。

   ```json
   { "env": { "CLAUDE_CODE_PLUGIN_DIRS": "~/.claude/nuu/mod" } }
   ```

   `settings.json` を書き換えたくないときは、`./install.sh --no-mod` を実行し、上の値を自分で足します。足したあとに起動したセッションから使えます。

リポジトリを `git pull` で更新すると、エージェントの定義、フック、ルール、ページの見た目と動きが、すべてリンク越しに新しくなります。開いたままのページは今の動きのままで、開き直すか再読み込みしたときに新しくなります。

## 注意

- ガードは、`dashboard-builder` と `dashboard-updater` が `~/.claude/nuu/dashboards/` を読むときと、作業のデータと好みを書くときに、確認なしで許可します。それ以外の場所の読み書き、`.html`・一覧のデータ・トークン量への書き込み、`date` 以外のコマンドは拒否します
- `claude -p` のような対話なしの実行では、ダッシュボードを作れません。ガードが許可しても、Claude Code が `~/.claude` の下への書き込みを止めるためです
- ガードが許可しても、auto モード以外（既定のモードなど）の対話のセッションでは、ダッシュボードへの書き込みのたびに確認が出ます。auto モードで使うと、確認なしで進みます
- ダッシュボードには、作業の概要、質問、成果物のパスなどが、そのままデータファイルに残ります。スマホなどから見るために外部へ公開するときは、その中身ごと見えることに注意してください。公開の仕組みは nuu には含まれていないので、利用者の環境に合わせて用意します
- 外部へ公開するときは、`dashboards/` の中の `_client` がリポジトリの `client/` へのリンクであることに注意してください。公開先でリンクをたどれないと、ページが表示されません
- 作業ディレクトリの名前が `_client` のときは、ページの置き場所と重ならないよう、プロジェクト名を `_client-project` にします
- `install.sh` は `~/.claude/CLAUDE.md` に 1 行を書き込みます。`CLAUDE.md` をシンボリックリンクで管理している場合（dotfiles など）は、リンク先の実体に書き込みます。書き換えたくないときは `--no-claude-md` を付けて実行してください。`uninstall.sh` は、その 1 行だけを消します
- `install.sh` は `~/.claude/settings.json` の `env.CLAUDE_CODE_PLUGIN_DIRS` に mod のパスを足します。シンボリックリンクの場合はリンク先の実体に書き込みます。書き換えたくないときは `--no-mod` を付けて実行してください。`uninstall.sh` は、そのパスだけを外します

## アンインストール

```sh
./uninstall.sh          # リンクだけ外す。ダッシュボードと好みのスタイルは残す
./uninstall.sh --purge  # ダッシュボード、好みのスタイル、モデルの指定も消す
```

このリポジトリへのリンクだけを外します。別のファイルに置き換わっていれば残します。`./install.sh` を実行すれば元に戻せます。

`~/.claude/CLAUDE.md` からは、`install.sh` が足した読み込みの 1 行だけを消します。ほかの内容には触れません。以前の手順でルールの本文を追記している場合は、自動では消さないので、不要なら手で消してください。

`~/.claude/settings.json` からは、`env.CLAUDE_CODE_PLUGIN_DIRS` の mod のパスだけを外します。ほかのパスと設定は残します。
