window.nuuDashboardData(
{
  "schema": 1,
  "project": "zbench-s10",
  "slug": "2026-10-11-1152-image-compress-speedup",
  "title": "画像の圧縮を速くする",
  "summary": "画像の圧縮で遅い箇所を測り、そこを直して速くする。",
  "status": "active",
  "startedAt": 1791687155,
  "updatedAt": 1791687155,
  "tasks": [
    { "id": 1, "title": "遅い箇所を測る", "status": "todo" },
    { "id": 2, "title": "直す", "status": "todo" }
  ],
  "questions": [],
  "blockers": [],
  "artifacts": [],
  "panels": [
    { "id": "compress-time", "type": "keyvalue", "title": "圧縮にかかる時間（直す前と後）", "wide": true, "note": "計測したら値を入れる。", "items": [
      { "label": "直す前", "value": "未計測", "state": "todo" },
      { "label": "直した後", "value": "未計測", "state": "todo" }
    ] },
    { "id": "hotspots", "type": "text", "title": "計測で見つけた遅い箇所", "body": "まだ計測していない。" }
  ]
}
);
