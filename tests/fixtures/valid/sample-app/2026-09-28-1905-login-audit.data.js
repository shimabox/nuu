window.nuuDashboardData(
{
  "schema": 1,
  "project": "sample-app",
  "slug": "2026-09-28-1905-login-audit",
  "title": "ログインの監査ログを残す",
  "summary": "ログインの成功と失敗を監査ログに残し、管理画面から検索できるようにする。",
  "status": "active",
  "startedAt": 1790589900,
  "updatedAt": 1790601000,
  "tasks": [
    { "id": 1, "title": "記録する項目の整理", "status": "done" },
    { "id": 2, "title": "監査ログの書き込み", "status": "doing" },
    { "id": 3, "title": "管理画面の検索", "status": "todo" }
  ],
  "questions": [],
  "blockers": [],
  "artifacts": [],
  "reviews": [
    { "provider": "gitlab", "kind": "mr", "number": 42, "title": "ログインの成功と失敗を監査ログに書き込む", "url": "https://gitlab.com/example-app/auth/-/merge_requests/42", "state": "draft", "at": 1790600400 }
  ],
  "panels": [
    {
      "id": "events",
      "type": "keyvalue",
      "title": "記録するできごと",
      "items": [
        { "label": "ログインの成功", "value": "対応済み", "state": "done" },
        { "label": "ログインの失敗", "value": "作業中", "state": "doing" },
        { "label": "パスワードの変更", "value": "未着手", "state": "todo" }
      ]
    }
  ]
}
);
