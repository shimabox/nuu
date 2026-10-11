window.nuuDashboardData(
{
  "schema": 1,
  "project": "zbench-s03",
  "slug": "2026-10-11-1152-add-db-index",
  "title": "本番データベースに索引を足す",
  "summary": "遅いクエリを調べ、索引を設計して、本番データベースに入れる。",
  "status": "active",
  "startedAt": 1791687155,
  "updatedAt": 1791687155,
  "tasks": [
    { "id": 1, "title": "遅いクエリを調べる", "status": "todo" },
    { "id": 2, "title": "索引を設計する", "status": "todo" },
    { "id": 3, "title": "索引を本番に入れる", "status": "todo" }
  ],
  "questions": [],
  "blockers": [],
  "artifacts": [],
  "panels": [
    {
      "id": "slow-queries",
      "type": "table",
      "title": "遅いクエリと足す索引",
      "wide": true,
      "note": "調査が進むと、クエリごとに行が増える。",
      "columns": [{ "label": "遅いクエリ" }, { "label": "対象のテーブル" }, { "label": "足す索引" }, { "label": "本番への反映" }],
      "rows": []
    },
    {
      "id": "production-state",
      "type": "keyvalue",
      "title": "本番データベースの状態",
      "items": [
        { "label": "見つけた遅いクエリ", "value": "未調査", "state": "todo" },
        { "label": "設計した索引", "value": "未設計", "state": "todo" },
        { "label": "本番への反映", "value": "未実施", "state": "todo" }
      ]
    }
  ]
}
);
