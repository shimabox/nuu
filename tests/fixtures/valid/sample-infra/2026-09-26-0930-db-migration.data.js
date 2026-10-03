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
    { "id": 3, "title": "古い版を止める", "status": "done" },
    { "id": 4, "title": "古い表を消す", "status": "skipped", "note": "PR #305 を下書きのまま、次の作業に回した" }
  ],
  "questions": [],
  "blockers": [],
  "artifacts": [
    { "name": "移行の記録", "ref": "runbooks/db-migration.md", "at": 1790397000 }
  ],
  "reviews": [
    { "provider": "github", "kind": "pr", "number": 301, "title": "移行スクリプトを追加する", "url": "https://github.com/example-infra/platform/pull/301", "state": "merged", "at": 1790389800 },
    { "provider": "github", "kind": "pr", "number": 298, "title": "旧版との互換モードを残す", "url": "https://github.com/example-infra/platform/pull/298", "state": "closed", "at": 1790386200 },
    { "provider": "gitlab", "kind": "mr", "number": 87, "title": "本番の移行手順書", "url": "https://gitlab.com/example-infra/runbooks/-/merge_requests/87", "state": "merged", "at": 1790396400 },
    { "provider": "github", "kind": "pr", "number": 305, "title": "移行後に古い表を消す", "url": "https://github.com/example-infra/platform/pull/305", "state": "draft", "at": 1790397600 }
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
    },
    {
      "id": "checks",
      "type": "grid",
      "title": "移行後の確認",
      "items": [
        { "label": "件数の突き合わせ", "state": "done" },
        { "label": "応答時間", "state": "done" },
        { "label": "古い表の削除", "state": "skipped", "note": "次の作業に回した" }
      ]
    }
  ]
}
);
