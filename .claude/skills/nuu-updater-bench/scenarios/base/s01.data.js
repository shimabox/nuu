window.nuuDashboardData(
{
  "schema": 1,
  "project": "zbench-s01",
  "slug": "2026-10-11-1152-login-audit-log",
  "title": "ログインの監査ログを残す",
  "summary": "ログインの監査ログを残す。ログの項目を決め、記録の処理とテストを足す。",
  "status": "active",
  "startedAt": 1791687155,
  "updatedAt": 1791687155,
  "tasks": [
    { "id": 1, "title": "ログの項目を決める", "status": "todo" },
    { "id": 2, "title": "記録の処理を足す", "status": "todo" },
    { "id": 3, "title": "テストを足す", "status": "todo" }
  ],
  "questions": [],
  "blockers": [],
  "artifacts": [],
  "panels": [
    { "id": "audit-spec", "type": "keyvalue", "title": "監査ログの仕様で決まったこと", "wide": true, "note": "項目が決まったら、ここに記録する項目を並べる。", "items": [
      { "label": "記録する項目", "value": "未定", "state": "todo" },
      { "label": "記録するタイミング", "value": "未定", "state": "todo" }
    ] },
    { "id": "audit-checks", "type": "keyvalue", "title": "監査ログの確認", "items": [
      { "label": "記録の処理", "value": "未実装", "state": "todo" },
      { "label": "テスト", "value": "未実行", "state": "todo" }
    ] }
  ]
}
);
