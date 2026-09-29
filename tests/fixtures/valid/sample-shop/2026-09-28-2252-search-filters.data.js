window.nuuDashboardData(
{
  "schema": 1,
  "project": "sample-shop",
  "slug": "2026-09-28-2252-search-filters",
  "title": "商品検索に価格・在庫・評価の絞り込みを追加する",
  "summary": "通販サイトの商品検索に、価格・在庫・評価の絞り込みを追加する。検索 API と画面の両方を直し、既存の並べ替えと組み合わせても速さを保つ。",
  "status": "active",
  "startedAt": 1790603523,
  "updatedAt": 1790607123,
  "tasks": [
    { "id": 1, "title": "現状の検索 API の調査", "status": "done" },
    { "id": 2, "title": "絞り込み条件の設計", "status": "done" },
    { "id": 3, "title": "検索 API への条件追加", "status": "done", "note": "価格と在庫は対応済み" },
    { "id": 4, "title": "インデックスの追加", "status": "blocked", "note": "本番データベースへの適用に承認が必要" },
    { "id": 5, "title": "画面の絞り込みパネル", "status": "doing", "note": "スマホの幅で折りたたむ" },
    { "id": 6, "title": "URL への条件の保存", "status": "waiting", "note": "評価の持ち方の回答待ち" },
    { "id": 7, "title": "テストの追加", "status": "todo" },
    { "id": 8, "title": "ドキュメントの更新", "status": "todo" }
  ],
  "questions": [
    {
      "id": 2,
      "question": "評価の絞り込みは星 4 以上の固定にしますか、それとも星の数を選べるようにしますか？",
      "default": "星の数を 1〜5 から選べるようにする",
      "proceeding": true,
      "askedAt": 1790606400
    },
    {
      "id": 1,
      "question": "在庫なしの商品は、絞り込みの既定で隠しますか？",
      "default": "隠さず、在庫なしと表示する",
      "proceeding": true,
      "askedAt": 1790604600,
      "answer": "既定では隠す。切り替えで表示できるようにする",
      "answeredAt": 1790605200
    }
  ],
  "blockers": [
    {
      "what": "インデックスの追加",
      "why": "本番データベースへの適用に承認が必要",
      "since": 1790606700,
      "next": "適用手順と所要時間をまとめて、承認を依頼する"
    }
  ],
  "artifacts": [
    { "name": "検索 API の変更", "ref": "api/search/filters.ts", "at": 1790605800, "note": "価格と在庫の条件" },
    { "name": "絞り込み条件の設計メモ", "ref": "docs/search-filters.md", "at": 1790604900 },
    { "name": "画面の確認用のプレビュー", "ref": "https://preview.example.com/search?price=1000-5000", "at": 1790606900, "note": "スマホの幅でも確かめる" }
  ],
  "reviews": [
    { "provider": "github", "kind": "pr", "number": 128, "title": "検索 API に価格と在庫の絞り込みを追加する", "url": "https://github.com/example-shop/storefront/pull/128", "state": "open", "at": 1790606100 }
  ],
  "panels": [
    {
      "id": "release-flow",
      "type": "flow",
      "title": "公開までの流れ",
      "wide": true,
      "steps": [
        { "label": "調査", "state": "done" },
        { "label": "設計", "state": "done" },
        { "label": "API", "state": "done", "note": "価格・在庫" },
        { "label": "画面", "state": "doing", "note": "スマホの幅" },
        { "label": "インデックス", "state": "blocked", "note": "承認待ち" },
        { "label": "検証", "state": "todo" },
        { "label": "公開", "state": "todo" }
      ]
    },
    {
      "id": "coverage",
      "type": "progress",
      "title": "対応済みの条件",
      "items": [
        { "label": "検索 API の条件", "value": 3, "total": 5, "unit": "条件" },
        { "label": "画面の部品", "value": 2, "total": 6, "unit": "部品" },
        { "label": "テスト", "value": 18, "total": 40, "unit": "件" }
      ]
    },
    {
      "id": "latency",
      "type": "trend",
      "title": "検索 API の応答時間",
      "unit": "ms",
      "note": "絞り込みを 3 つ重ねたときの値",
      "series": [
        {
          "label": "p95",
          "points": [
            { "at": 1790603700, "value": 420 },
            { "at": 1790604120, "value": 460 },
            { "at": 1790604540, "value": 610 },
            { "at": 1790604960, "value": 580 },
            { "at": 1790605380, "value": 390 },
            { "at": 1790605800, "value": 350 },
            { "at": 1790606220, "value": 330 },
            { "at": 1790606640, "value": 310 }
          ]
        },
        {
          "label": "p50",
          "points": [
            { "at": 1790603700, "value": 180 },
            { "at": 1790604120, "value": 190 },
            { "at": 1790604540, "value": 240 },
            { "at": 1790604960, "value": 230 },
            { "at": 1790605380, "value": 170 },
            { "at": 1790605800, "value": 150 },
            { "at": 1790606220, "value": 140 },
            { "at": 1790606640, "value": 135 }
          ]
        }
      ]
    },
    {
      "id": "conditions",
      "type": "table",
      "title": "絞り込みの条件",
      "wide": true,
      "columns": [{ "label": "条件" }, { "label": "API" }, { "label": "画面" }, { "label": "件数の目安" }, { "label": "メモ" }],
      "rows": [
        ["価格の下限と上限", { "text": "対応済み", "state": "done" }, { "text": "作業中", "state": "doing" }, 12400, "税込みで比べる"],
        ["在庫あり", { "text": "対応済み", "state": "done" }, { "text": "作業中", "state": "doing" }, 8300, ""],
        ["評価", { "text": "回答待ち", "state": "waiting" }, { "text": "未着手", "state": "todo" }, 5100, "星の数の持ち方を確認中"],
        ["送料無料", { "text": "未着手", "state": "todo" }, { "text": "未着手", "state": "todo" }, 2900, "次の段階で検討"]
      ]
    },
    {
      "id": "browsers",
      "type": "grid",
      "title": "ブラウザでの確認",
      "items": [
        { "label": "Chrome", "state": "done" },
        { "label": "Firefox", "state": "done" },
        { "label": "Safari", "state": "doing" },
        { "label": "Edge", "state": "todo" },
        { "label": "iOS Safari", "state": "failed", "note": "価格の入力欄がずれる" },
        { "label": "Android Chrome", "state": "waiting", "note": "実機の手配待ち" }
      ]
    },
    {
      "id": "gates",
      "type": "keyvalue",
      "title": "品質のゲート",
      "items": [
        { "label": "型チェック", "value": "通過", "state": "done" },
        { "label": "単体テスト", "value": "142 / 142", "state": "done" },
        { "label": "E2E テスト", "value": "2 件失敗", "state": "failed" },
        { "label": "検索の速さ（p95）", "value": "310 ms", "state": "doing" },
        { "label": "アクセシビリティ", "value": "未計測", "state": "todo" }
      ]
    },
    {
      "id": "notes",
      "type": "text",
      "title": "決めたこと",
      "body": "絞り込みの条件は URL の検索パラメーターに持たせ、共有したリンクで同じ結果を開けるようにする。\n\n価格は税込みで比べる。表示の単位と合わせるため、API でも税込みの値で受け取る。\n在庫なしの商品は既定で隠し、切り替えで表示する。"
    }
  ]
}
);
