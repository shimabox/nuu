window.nuuDashboardData(
{
  "schema": 1,
  "project": "sample-docs",
  "slug": "2026-09-27-1010-api-guide",
  "title": "API の利用ガイドを書き直す",
  "summary": "公開 API の利用ガイドを、認証、ページ送り、エラーの順に書き直す。",
  "status": "paused",
  "startedAt": 1790471400,
  "updatedAt": 1790485000,
  "tasks": [
    { "id": 1, "title": "目次の見直し", "status": "done" },
    { "id": 2, "title": "認証の節", "status": "done" },
    { "id": 3, "title": "ページ送りの節", "status": "doing" },
    { "id": 4, "title": "エラーの節", "status": "todo" }
  ],
  "questions": [
    {
      "id": 1,
      "question": "古い版の API の説明は残しますか？",
      "default": "付録に移して残す",
      "proceeding": false,
      "askedAt": 1790484000
    }
  ],
  "blockers": [],
  "artifacts": [
    { "name": "認証の節", "ref": "guide/auth.md", "at": 1790480000 }
  ],
  "panels": [
    {
      "id": "sections",
      "type": "progress",
      "title": "書き直した節",
      "items": [{ "label": "節", "value": 2, "total": 4, "unit": "節" }]
    }
  ]
}
);
