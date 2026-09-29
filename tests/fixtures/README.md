# テスト用のデータ

`hooks/dashboard-validate.py` の確認（`tests/run.sh`）と、固定クライアントのブラウザでの確認（`tests/client/`）が、同じデータを使う。検査と描画がずれないようにするため。

データはすべて架空の作業で、個人の環境のパスや情報は入れない。

## valid/

`~/.claude/nuu/dashboards/` と同じ置き方にしている。どれも validate を通る。

- `prefs.data.js`: 好みのスタイル
- `index.data.js`: 一覧のデータ（本番ではフックが作る）
- `<プロジェクト名>/<開始日時>-<作業名>.data.js`: 作業のデータ
- `<プロジェクト名>/<開始日時>-<作業名>.usage.js`: トークン量とセッション（本番ではフックが書く）

`sample-shop/2026-09-28-2252-search-filters.data.js` は見本の作業で、型付きパネル 7 種と、GitHub の PR 1 件が入っている。画面の画像もこのデータから撮る。

PR / MR（`reviews`）は、`sample-app` に GitLab の MR（下書き）、`sample-infra` の `db-migration` に GitHub と GitLab の 4 件（マージ済み、閉じた、下書き）を入れている。見本の PR（レビュー中）と合わせて、4 つの状態がそろう。一覧で「ほか n 件」になるのは `db-migration` の行。

## invalid/

どれも validate が理由付きで止める。`cases.json` の各行は次の意味。

- `file`: このフォルダーの中のファイル
- `as`: `~/.claude/nuu/dashboards/` の下のどこに置いて確かめるか
- `reason`: 止めた理由に含まれるはずの文
- `what`: 何が壊れているか

壊れた例を足したら、`cases.json` にも 1 行足す（`tests/run.sh` が、ファイルの数と行の数が合うかを確かめる）。
