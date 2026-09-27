# nuu

Claude Code で長い作業をするときに、進み具合を 1 枚の HTML で見られるようにするサブエージェント `dashboard-builder` です。

## 名前の由来

「ぬー」は沖縄の言葉で「何」という意味です。「ぬーそーが？（何してるの？）」のように使います。

長い作業の途中で「今なにしてる？」と気になったとき、このダッシュボードを開けば答えがわかる。その問いかけの一言を名前にしました。

## できること

- 作業ディレクトリの `.claude-progress/index.html` に、タスクと状態、利用者への質問と既定の対応、最新の成果物、止まっているものを表示する
- ダブルクリックで開けて、10 秒ごとに自動で再読み込みする
- 時刻はすべて実際の時計から取る
- 初回に好みのスタイル（テーマ、密度、アクセントカラー）を聞き、以降はその好みで作る
- 作業中に判断が必要になっても止まらず、質問と既定の対応をダッシュボードに載せて作業を続ける

ダッシュボードとエージェントへの指示は日本語です。

## 必要なもの

- macOS または Linux（Windows には対応していません）
- Claude Code。サブエージェント定義の `effort`、`memory`、`skills`、`hooks` を使います。2.1.283 で動作を確認しています
- bash、git、jq、python3

### 推奨プラグイン

次のプラグインがあれば、デザインの指針としてサブエージェントに読み込みます。なくても動きます。

```text
/plugin install frontend-design@claude-plugins-official
/plugin marketplace add plannotator/effective-html
/plugin install plannotator-effective-html@effective-html
```

## セットアップ

1. 好きな場所に clone して、`install.sh` を実行します。

   ```sh
   git clone https://github.com/shimabox/nuu.git
   cd nuu
   ./install.sh
   ```

   次のリンクを作ります。既存のファイルがある場合は上書きせずに止まります。

   - `~/.claude/agents/dashboard-builder.md`
   - `~/.claude/hooks/dashboard-guard.sh`
   - `~/.claude/nuu/impeccable`

2. `claude-instructions.md` の内容を `~/.claude/CLAUDE.md` に追記します。長い作業で `dashboard-builder` を使うよう、Claude Code に指示するルールです。

   ```sh
   cat claude-instructions.md >> ~/.claude/CLAUDE.md
   ```

3. 必要なら、`.claude-progress/` をグローバルの gitignore に追加します。追加しないと、Git リポジトリで作業するたびに `git status` に表示されます。

   ```sh
   echo '.claude-progress/' >> ~/.config/git/ignore
   ```

## 使い方

5 ステップを超える作業や、30 分を超えそうな作業を Claude Code に頼むと、作業の前にダッシュボードが作られます。初回だけ、テーマ（dark / light）、密度（dense / airy）、アクセントカラーを聞かれます。答えは `~/.claude/agent-memory/dashboard-builder/` に保存され、次からはその好みで作られます。

作業ディレクトリの `.claude-progress/index.html` をダブルクリックで開くと、進み具合を確認できます。

## 構成

- `agents/dashboard-builder.md`: サブエージェントの定義
- `hooks/dashboard-guard.sh`: 読み書きできる場所を `.claude-progress/` と自身のメモリに限り、Bash を `date` だけに限るガード
- `claude-instructions.md`: `~/.claude/CLAUDE.md` に追記するルール
- `install.sh`: `~/.claude` へのリンク作成と impeccable の取得
- `uninstall.sh`: リンクを外して `dashboard-builder` を使えなくする
- `tests/run.sh`: 仕様を確認するテスト
- `vendor/impeccable/`: デザインの指針として読み取り専用で使う [impeccable](https://github.com/pbakaus/impeccable) のスキル部分。`install.sh` が取得し、Git の管理対象外

impeccable はプラグインやグローバルなスキルとしては入れません。`dashboard-builder` だけが読み、ほかのセッションには影響しません。上流の変更で動きが変わらないよう、取得する版を `install.sh` の `IMPECCABLE_REF` で固定しています。

## アンインストール

```sh
./uninstall.sh          # リンクだけ外す。好みのスタイルと impeccable は残す
./uninstall.sh --purge  # 好みのスタイルと vendor/impeccable も消す
```

このリポジトリへのリンクだけを外します。別のファイルに置き換わっていれば残します。`./install.sh` を実行すれば元に戻せます。

`~/.claude/CLAUDE.md` のルール、gitignore の `.claude-progress/` の行、各作業ディレクトリの `.claude-progress/` は自動では消しません。ルールは `dashboard-builder` がなければ適用されない条件付きなので、残しても動作には影響しません。

## テスト

```sh
tests/run.sh
```

エージェント定義、ガード、`install.sh`、`uninstall.sh` が仕様どおりかを確かめます。一時ディレクトリにリポジトリを複製し、一時 HOME と偽の git で実行するので、実際の `~/.claude` やネットワークには触れません。

GitHub Actions では、push と pull request のたびに shellcheck と、ubuntu と macOS でのテストを実行します。

## ライセンス

MIT License です。詳しくは [LICENSE](LICENSE) を見てください。

`install.sh` が取得する impeccable は Apache License 2.0 です。このリポジトリには含めていません。
