# 仕組み

[README](../README.md) に戻る

## エージェントの分担

| エージェント | モデル | 受け持つこと |
|---|---|---|
| `dashboard-builder` | `opus`（effort low） | ダッシュボードの用意（作業に合わせたパネルの選択）、好みのスタイルの変更、構成の見直し |
| `dashboard-updater` | `sonnet`（effort low） | 途中の更新と完了、中断と再開、一覧から作業を外すこと。パネルの構成は変えず、作業のデータファイル（`.data.js`）の JSON だけを書き換える |

エージェントの定義では、builder を `opus`、updater を `sonnet` の別名で指定し、どちらも effort を `low` にしています。Claude Code がその時点のモデルに割り当てます。モデルは[モデルを変える](usage.md#モデルを変える)の手順で変えられます。

builder を `opus` にしているのは、パネルを作業の中身から組み立てる判断を受け持つからです。同じ 3 つの作業で `sonnet` と比べたところ、`opus` は作業が進むと変わる値を推移のグラフにするなど、作業に合わせたパネルを多く選び、手順のカンバンと重なるパネルも少なくなりました。

`dashboard-builder` は HTML を書かず、データの形とパネルの選び方だけを読んで、作業のデータを書きます。途中の更新は回数が多いので、`dashboard-updater` は変わった箇所だけを書き換えて短く済ませます。書き換えたあとに読み直さず、データが決まった形かはフックのスクリプトが確かめます。今のパネルに収まらない変化は `dashboard-builder` に回します。

## 構成

- `agents/dashboard-builder.md`: ダッシュボードを用意するサブエージェントの定義
- `agents/dashboard-updater.md`: 途中の更新と完了を行うサブエージェントの定義
- `mod/`: Claude Code の中で見せる mod（`/nuu` のペインとプロンプトの上の帯）。`~/.claude/nuu/mod` からリンクで読む
- `client/`: ページの見た目と動き（`task.html`、`index.html`、`nuu.css`、`nuu.js`）。`~/.claude/nuu/dashboards/_client` からリンクで読む
- `hooks/dashboard-validate.py`: データを書いた直後に、決まった形か（必須の項目、状態の語彙、時刻、パネルの形、件数と長さの上限など）を確かめ、壊れていれば理由を返して直させるスクリプト
- `hooks/dashboard-page.py`: 作業のデータを書いた直後に、作業ごとの `.html` と一覧の `index.html` を置き、すべての作業のデータから一覧のデータを作り直すスクリプト
- `hooks/dashboard-usage.py`: 作業のトークン量を会話の記録から集計し、セッションの ID と作業ディレクトリと一緒に、データと同じフォルダーの `.usage.js` に書くスクリプト
- `hooks/dashboard-guard.sh`: 読める場所を `~/.claude/nuu/dashboards/` に、書ける場所を作業のデータと好みに限り、Bash を `date` だけに限るガード
- `claude-instructions.md`: `~/.claude/CLAUDE.md` から読み込むルール
- `install.sh`: `~/.claude` へのリンク作成
- `uninstall.sh`: リンクを外して、nuu のサブエージェントを使えなくする
- `tests/run.sh`: 仕様を確認するテスト
- `tests/client/`: `client/` をブラウザで確かめるテスト（Playwright）
- `tests/fixtures/`: テストで使う架空の作業のデータ。データの確認とブラウザのテストの両方が使う

## 料金の目安

ダッシュボードの用意と更新にも、作業そのものとは別にトークンを使います。

| 場面 | 担当 | 1 回あたりの目安 |
|---|---|---|
| ダッシュボードの用意 | `dashboard-builder`（`opus`） | 約 $0.2〜0.3、25 秒前後 |
| 途中の更新と完了 | `dashboard-updater`（`sonnet`） | 約 $0.02〜0.03、10〜20 秒前後 |

用意の目安は、Claude Code 2.1.285 で性質の違う 3 つの作業を 1 回ずつ用意したときの値です。幅は、キャッシュの保持時間（5 分か 1 時間）でキャッシュへの書き込みの単価が変わるためです。同じ測り方で、`sonnet` の builder は約 $0.1〜0.17、20 秒前後でした。料金を抑えたいときは、builder を `sonnet` に変えられます（[モデルを変える](usage.md#モデルを変える)を参照）。`dashboard-builder` は HTML を書かず、データだけを書くので、用意を短く済ませられます。

途中の更新と完了の目安は、10 通りの作業の流れで 1 回ずつ測った実測です。料金は会話の記録のトークンから推計したもので、記録の都合で少なめに出ることがあります。途中の更新はバックグラウンドで行うので、作業はその時間を待ちません。

金額は API の単価で計算した目安です。契約の形態によっては、料金ではなく使用量の上限に数えられます。

作業ごとの実際の量は、ダッシュボードの「トークン量」で確かめられます。

## テスト

```sh
tests/run.sh
```

エージェント定義、ガード、データの確認、ページと一覧のフック、トークン量の集計、`install.sh`、`uninstall.sh` が仕様どおりかを確かめます。一時ディレクトリにリポジトリを複製し、一時 HOME で実行するので、実際の `~/.claude` やネットワークには触れません。

`claude` コマンドがあれば、mod も `claude plugin validate` と `claude plugin test` で確かめます。mod のテスト（`mod/tests/`）は、ファイルの読み込みを架空のデータに置き換え、terminal とデスクトップの両方の描き方でペインと帯を確かめます。`claude` がない環境では飛ばします。

ページの表示と動きは、Playwright でブラウザを動かして確かめます。Node と npm が要ります（使うだけなら要りません）。

```sh
npm ci
npx playwright install chromium
npx playwright test --project=chromium
```

`fixtures` の架空の作業を一時ディレクトリに置き、`file://` で開いて、データの読み直し、警告、コピー、スマホの幅などを確かめます。WebKit と Firefox も入れれば、`npx playwright test` で 3 つのブラウザで確かめられます。

GitHub Actions では、push と pull request のたびに、shellcheck、ubuntu と macOS での `tests/run.sh`、ubuntu の Chromium でのブラウザのテストを実行します。

説明ページ、README、使い方の文書の画像は、次のコマンドで `fixtures` の見本の作業から撮り直せます。

```sh
NUU_DOCS_IMAGES=1 npx playwright test screenshots --project=chromium
```

## 参考

[@Voxyz_ai の投稿](https://x.com/Voxyz_ai/status/2103946635831050740)の考え方をもとにしています。長い作業の前に、ダッシュボードだけを作るサブエージェント `dashboard-builder` に HTML のダッシュボードを作らせ、初回に聞いた好みのスタイルをメモリに覚えさせる。ダッシュボードには、タスクの進み具合、止まっているもの、回答待ちの質問、答えがないときの既定の対応を載せ、判断が必要になっても止まらずに既定の対応で進める、という形です。

nuu では、これに次を足しています。

- ページの見た目と動きを固定のクライアントにし、サブエージェントはデータだけを書く。作業に合わせて選ぶのは、7 種類のパネルの種類、並び、中身
- 途中の更新と完了を、更新だけを受け持つ `dashboard-updater` に分ける
- ダッシュボードを作業ディレクトリではなく `~/.claude/nuu/dashboards/` にまとめ、全プロジェクトの作業の一覧を作る
- フックで読み書きできる場所を絞り、データの形を確かめ、一覧を作り、トークン量の目安を集計する
- ページを再読み込みせず、データだけを読み直す
