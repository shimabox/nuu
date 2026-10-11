window.nuuDashboardData(
{
  "schema": 1,
  "project": "zbench-s12",
  "slug": "2026-10-11-1152-search-api-speedup",
  "title": "検索 API の応答を速くする",
  "summary": "検索 API の遅い箇所を測り、キャッシュを足して、応答が速くなったかを確かめる。",
  "status": "active",
  "startedAt": 1791687155,
  "updatedAt": 1791687155,
  "tasks": [
    { "id": 1, "title": "遅い箇所を測る", "status": "todo" },
    { "id": 2, "title": "キャッシュを足す", "status": "todo" },
    { "id": 3, "title": "効果を確かめる", "status": "todo" }
  ],
  "questions": [],
  "blockers": [],
  "artifacts": [],
  "panels": [
    { "id": "measurements", "type": "keyvalue", "title": "計測の結果", "items": [
      { "label": "p95 の応答時間", "value": "820 ms" },
      { "label": "キャッシュのヒット率", "value": "0%" }
    ] }
  ]
}
);
