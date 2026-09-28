window.nuuDashboardData(
{
  "schema": 1,
  "project": "sample-infra",
  "slug": "2026-09-26-0930-db-migration",
  "title": "データベースを新しい版へ移す",
  "summary": "検証環境と本番のデータベースを新しい版へ移し、古い版を止める。",
  "status": "done",
  "startedAt": 1790382600,
  "updatedAt": 1790398000,
  "tasks": [
    { "id": 1, "title": "検証環境で移行", "status": "done" },
    { "id": 2, "title": "本番で移行", "status": "done" },
    { "id": 3, "title": "古い版を止める", "status": "done" }
  ],
  "questions": [],
  "blockers": [],
  "artifacts": [
    { "name": "移行の記録", "ref": "runbooks/db-migration.md", "at": 1790397000 }
  ],
  "panels": [
    {
      "id": "stages",
      "type": "flow",
      "title": "移行の段階",
      "steps": [
        { "label": "検証環境", "state": "done" },
        { "label": "本番", "state": "done" },
        { "label": "停止", "state": "done" }
      ]
    }
  ]
}
);
