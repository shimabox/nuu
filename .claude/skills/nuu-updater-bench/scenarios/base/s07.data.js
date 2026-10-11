window.nuuDashboardData(
{
  "schema": 1,
  "project": "zbench-s07",
  "slug": "2026-10-11-1152-fix-failing-tests",
  "title": "落ちているテストを直す",
  "summary": "落ちているテストの原因を調べて直し、全 50 件を通す。開始時点で 30 件が通過している。",
  "status": "active",
  "startedAt": 1791687155,
  "updatedAt": 1791687155,
  "tasks": [
    { "id": 1, "title": "原因を調べる", "status": "todo" },
    { "id": 2, "title": "直す", "status": "todo" },
    { "id": 3, "title": "全部通す", "status": "todo" }
  ],
  "questions": [],
  "blockers": [],
  "artifacts": [],
  "panels": [
    { "id": "passing-trend", "type": "trend", "title": "通ったテストの数の推移", "unit": "件", "wide": true, "note": "全 50 件。50 件に届けば全部通過。", "series": [{ "label": "通過", "points": [{ "at": 1791687155, "value": 30 }] }] },
    { "id": "passing-now", "type": "progress", "title": "全 50 件のうち通っているテスト", "items": [{ "label": "通過したテスト", "value": 30, "total": 50, "unit": "件" }] }
  ]
}
);
