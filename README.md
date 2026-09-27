<h1>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="docs/images/logo-dark.svg">
    <img src="docs/images/logo-light.svg" alt="nuu" width="172" height="60">
  </picture>
</h1>

Claude Code で長い作業をするときに、進み具合を 1 枚の HTML で見られるようにするサブエージェントです。ダッシュボードを用意する `dashboard-builder` と、途中の更新と完了を行う `dashboard-updater` の 2 つで動きます。

> [!NOTE]
> 実験的なツールです。動作は macOS と Claude Code 2.1.283 で確認しています。Claude Code の更新によって、動きが変わったり、一部の表示が出なくなったりすることがあります。

<table>
  <tr>
    <th width="75%">作業ごとのダッシュボード</th>
    <th width="25%">スマホで見たとき</th>
  </tr>
  <tr>
    <td valign="top"><img src="docs/images/dashboard-desktop.png" alt="作業ごとのダッシュボード。上部に要約、その下に利用者への質問、止まっているもの、手順のカンバンが並ぶ"></td>
    <td valign="top"><img src="docs/images/dashboard-mobile.png" alt="スマホの幅で表示した作業ごとのダッシュボード"></td>
  </tr>
  <tr>
    <th colspan="2">全体の一覧</th>
  </tr>
  <tr>
    <td colspan="2"><img src="docs/images/index-desktop.png" alt="全プロジェクトの作業を並べた一覧"></td>
  </tr>
</table>

画像は、架空の通販サイトの作業で作った見本です。見た目やパネルの構成は、作業ごとに変わります。

## 仕組み

https://shimabox.github.io/nuu/

## 名前の由来

「ぬー」は沖縄の言葉で「何」という意味です。「ぬーやが？（なに？）」のように使います。

長い作業の途中で「今なにしてる？」と気になったとき、このダッシュボードを開けば答えがわかる。その問いかけの一言を名前にしました。

## できること

- 作業ごとに 1 枚のダッシュボードを作り、タスクと状態、利用者への質問と既定の対応、最新の成果物、止まっているものを表示する
- 全プロジェクトの作業を並べた一覧を作る。進行中の作業が上に並び、更新が止まっている作業は目立たせる
- ダッシュボードは `~/.claude/nuu/dashboards/` にまとめ、作業ディレクトリには何も作らない
- ブラウザで開くだけで見られる。サーバーもツールも要らず、10 秒ごとに自分で再読み込みする
- 時刻はすべて実際の時計から取る
- 初回に好みのスタイル（テーマ、密度、アクセントカラー）を聞き、以降はその好みで作る
- タスクはカンバン（状態ごとの列）で表示する。頼めばリストにも変えられる
- スマホの幅でも読めるように表示する。狭い画面では、カンバンの列を縦に積む
- 作業で使ったトークン量の目安を表示する
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
   - `~/.claude/agents/dashboard-updater.md`
   - `~/.claude/hooks/dashboard-guard.sh`
   - `~/.claude/hooks/dashboard-validate.py`
   - `~/.claude/hooks/dashboard-usage.py`
   - `~/.claude/nuu/claude-instructions.md`
   - `~/.claude/nuu/impeccable`

2. `install.sh` は、`~/.claude/CLAUDE.md` の末尾に次の 1 行を足します。長い作業で `dashboard-builder` を使うよう Claude Code に指示するルール（`claude-instructions.md`）を読み込む行です。ルールの本文はコピーしないので、リポジトリを更新すればルールも最新になります。

   ```text
   @~/.claude/nuu/claude-instructions.md
   ```

   `CLAUDE.md` を書き換えたくないときは、`./install.sh --no-claude-md` を実行し、上の 1 行を自分で足します。以前の手順でルールの本文を追記している場合は、`install.sh` は 1 行を足さずに知らせるので、その節を消して 1 行に置き換えてください。

## 使い方

5 ステップを超える作業や、30 分を超えそうな作業を Claude Code に頼むと、作業の前にダッシュボードが作られます。初回だけ、テーマ（dark / light）、密度（dense / airy）、アクセントカラーを聞かれます。答えは `~/.claude/agent-memory/dashboard-builder/` に保存され、次からはその好みで作られます。

`claude -p` のように好みを聞けない実行では、仮の好みをその回だけ使い、保存しません。次に対話で使うときに聞かれます。

ダッシュボードを作るかどうかは Claude Code が作業の大きさから判断するので、小さい作業とみなされると作られません。確実に使いたいときは、依頼と一緒に「ダッシュボードを用意してから進めて」と頼みます。作業の途中で頼むこともできます。

ダッシュボードは次の場所に作られます。作業を始めるときに、Claude がパスを伝えます。

```text
~/.claude/nuu/dashboards/
├── index.html                               全プロジェクトの作業の一覧
└── <プロジェクト名>/
    └── <開始日時>-<作業名>.html            作業ごとのダッシュボード
```

一覧を開いておけば、どのプロジェクトで何が進んでいるかをまとめて確認できます。一覧から作業ごとのダッシュボードに移れます。同じリポジトリで複数のセッションを並行させても、作業ごとに別のファイルになるので混ざりません。

ダッシュボードの途中の更新はバックグラウンドで行うので、作業はその完了を待たずに進みます。用意と完了のときだけ、ダッシュボードができるのを待ちます。

```sh
open ~/.claude/nuu/dashboards/index.html
```

### エージェントの分担

| エージェント | モデル | 受け持つこと |
|---|---|---|
| `dashboard-builder` | Opus 5.5 | ダッシュボードの用意、好みのスタイルの変更、構成の見直し |
| `dashboard-updater` | Haiku 4.5 | 途中の更新と完了。ページの見た目や構成は変えず、埋め込まれたデータ（`dashboard-data` の JSON）だけを書き換える |

エージェントの定義では、モデルを `opus` と `haiku` の別名で指定しています。Claude Code がその時点のモデルに割り当てるもので、表のモデルは 2026 年 9 月時点で確かめたものです。

途中の更新は回数が多いので、軽いモデルに任せて料金を抑えます。同じ 3 回の更新で比べたところ、1 回あたりの料金の目安は Opus 5.5 の約 5 分の 1 でした。`dashboard-updater` は書き換えたあとに読み直さず、JSON が正しいかはフックのスクリプトが確かめます。今の構成に収まらない変化は `dashboard-builder` に回します。

### トークン量

作業ごとのダッシュボードと一覧に、作業で使ったトークン量を表示します。`dashboard-builder` か `dashboard-updater` がダッシュボードを書くたびに、フックのスクリプトが Claude Code の会話の記録（`~/.claude/projects/`）から集計します。数えるのは、ダッシュボードを用意し始めてからの分です。

- 内訳: 作業本体、ほかのサブエージェント、ダッシュボードの作成と更新
- 種類: 入力、出力、キャッシュの読み込み、キャッシュの書き込み

目安として使ってください。会話の記録には、サブエージェントの応答の確定した出力トークンが残らないことがあり、その分は少なめに出ます。また、会話の記録の形は Claude Code の公開された仕様ではないため、Claude Code の更新で集計できなくなることがあります。その場合は「集計前」と表示され、ほかの表示には影響しません。

### 好みを変える

Claude Code に「ダッシュボードを light、airy、teal に変えて」のように頼みます。新しい好みが保存され、次からはその好みで作られます。

タスクの表示は、最初はカンバンです。「ダッシュボードのタスクをリストで表示して」と頼むとリストに変わり、その好みも保存されます。

最初から選び直したいときは、保存した好みを消します。次の作業のときに、もう一度聞かれます。

```sh
rm ~/.claude/agent-memory/dashboard-builder/style.md
```

## 構成

- `agents/dashboard-builder.md`: ダッシュボードを用意するサブエージェントの定義
- `agents/dashboard-updater.md`: 途中の更新と完了を行うサブエージェントの定義
- `hooks/dashboard-validate.py`: ダッシュボードを書いた直後に、埋め込んだデータが JSON として正しいかを確かめるスクリプト
- `hooks/dashboard-usage.py`: 作業のトークン量を会話の記録から集計し、ダッシュボードの隣の `.usage.js` に書くスクリプト
- `hooks/dashboard-guard.sh`: 読み書きできる場所を `~/.claude/nuu/dashboards/` と自身のメモリに限り、Bash を `date` だけに限るガード
- `claude-instructions.md`: `~/.claude/CLAUDE.md` から読み込むルール
- `install.sh`: `~/.claude` へのリンク作成と impeccable の取得
- `uninstall.sh`: リンクを外して、nuu のサブエージェントを使えなくする
- `tests/run.sh`: 仕様を確認するテスト
- `vendor/impeccable/`: デザインの指針として読み取り専用で使う [impeccable](https://github.com/pbakaus/impeccable) のスキル部分。`install.sh` が取得し、Git の管理対象外

impeccable はプラグインやグローバルなスキルとしては入れません。`dashboard-builder` だけが読み、ほかのセッションには影響しません。上流の変更で動きが変わらないよう、取得する版を `install.sh` の `IMPECCABLE_REF` で固定しています。

## 料金の目安

ダッシュボードの用意と更新にも、作業そのものとは別にトークンを使います。

| 場面 | 担当 | 1 回あたりの目安 |
|---|---|---|
| ダッシュボードの用意 | `dashboard-builder`（Opus 5.5） | 約 $0.50、2〜3 分 |
| 途中の更新と完了 | `dashboard-updater`（Haiku 4.5） | 約 $0.06、30 秒〜1 分 |

たとえば 8 手順の作業で、途中の更新が 8 回あれば、ダッシュボードにかかる料金は合わせて約 $1 です。途中の更新はバックグラウンドで行うので、作業はその時間を待ちません。

金額は、2026 年 9 月時点の API の単価（Opus 5.5 と Haiku 4.5）で見本の作業を計算した目安です。契約の形態によっては、料金ではなく使用量の上限に数えられます。

作業ごとの実際の量は、ダッシュボードの「トークン量」で確かめられます。

## 注意

- ガードは、`dashboard-builder` と `dashboard-updater` が `~/.claude/nuu/dashboards/` と自身のメモリを読み書きするときに、確認なしで許可します。それ以外の場所の読み書きと、`date` 以外のコマンドは拒否します
- ダッシュボードには、作業の概要、質問、成果物のパスなどが、そのまま HTML に残ります。スマホなどから見るために外部へ公開するときは、その中身ごと見えることに注意してください。公開の仕組みは nuu には含まれていないので、利用者の環境に合わせて用意します
- ダッシュボードは Claude Code の指示に従ってモデルが作るため、見た目やパネルの構成は作業ごとに変わります
- `install.sh` は `~/.claude/CLAUDE.md` に 1 行を書き込みます。`CLAUDE.md` をシンボリックリンクで管理している場合（dotfiles など）は、リンク先の実体に書き込みます。書き換えたくないときは `--no-claude-md` を付けて実行してください。`uninstall.sh` は、その 1 行だけを消します

## アンインストール

```sh
./uninstall.sh          # リンクだけ外す。好みのスタイル、ダッシュボード、impeccable は残す
./uninstall.sh --purge  # 好みのスタイル、ダッシュボード、vendor/impeccable も消す
```

このリポジトリへのリンクだけを外します。別のファイルに置き換わっていれば残します。`./install.sh` を実行すれば元に戻せます。

`~/.claude/CLAUDE.md` からは、`install.sh` が足した読み込みの 1 行だけを消します。ほかの内容には触れません。以前の手順でルールの本文を追記している場合は、自動では消さないので、不要なら手で消してください。

## テスト

```sh
tests/run.sh
```

エージェント定義、ガード、`install.sh`、`uninstall.sh` が仕様どおりかを確かめます。一時ディレクトリにリポジトリを複製し、一時 HOME と偽の git で実行するので、実際の `~/.claude` やネットワークには触れません。

GitHub Actions では、push と pull request のたびに shellcheck と、ubuntu と macOS でのテストを実行します。

## TODO

[docs/TODO.md](docs/TODO.md)

## ライセンス

MIT License です。詳しくは [LICENSE](LICENSE) を見てください。

`install.sh` が取得する impeccable は Apache License 2.0 です。このリポジトリには含めていません。
