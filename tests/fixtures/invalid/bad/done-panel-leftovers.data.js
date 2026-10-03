window.nuuDashboardData(
{
  "schema": 1,
  "project": "bad",
  "slug": "done-panel-leftovers",
  "title": "壊れた例",
  "summary": "",
  "status": "done",
  "startedAt": 1790603523,
  "updatedAt": 1790607123,
  "tasks": [
    { "id": 1, "title": "直す", "status": "done" }
  ],
  "questions": [],
  "blockers": [],
  "artifacts": [],
  "panels": [
    { "id": "files", "type": "table", "title": "保存で更新するファイル", "columns": [{ "label": "ファイル" }, { "label": "更新" }], "rows": [["meta.json", { "text": "未実装", "state": "todo" }], ["job.json", { "text": "対応済み", "state": "done" }]] },
    { "id": "checks", "type": "grid", "title": "確認", "items": [{ "label": "Chrome", "state": "waiting" }, { "label": "Safari", "state": "skipped" }] },
    { "id": "stages", "type": "flow", "title": "流れ", "steps": [{ "label": "公開", "state": "doing" }] },
    { "id": "gates", "type": "keyvalue", "title": "ゲート", "items": [{ "label": "単体テスト", "value": "失敗 2 件", "state": "failed" }, { "label": "E2E", "value": "未実行", "state": "blocked" }] }
  ]
}
);
