#!/usr/bin/env python3
"""作業のデータか好みを書いた直後に、ページのスタブを置き、一覧のデータを作り直す。

対象は ~/.claude/nuu/dashboards/ の下の次の書き込み。
- <プロジェクト名>/<開始日時>-<作業名>.data.js: その作業のスタブ（.html）と一覧のスタブを置く
- prefs.data.js: 一覧のスタブを置く

スタブはリポジトリの client/ にある雛形の複製で、中身が違えば置き直す。モデルは HTML を書かない。
一覧のデータ（index.data.js）は、毎回すべての作業のデータから作り直す。status が removed の作業は載せない。
データが壊れて読めない作業だけは、前の一覧にその作業の行があれば、その行を残す。

フックは並行して動くことがあるので、前の一覧の読み込みから置き換えまでを排他ロックで直列化する。
ロックを取れなければ一覧を変えずに終わり、次の書き込みで作り直す。
失敗してもエージェントの作業は止めない。依存は標準ライブラリだけ。
"""

import fcntl
import importlib.util
import json
import os
import sys
import tempfile
import time

DASHBOARDS = os.path.realpath(os.path.expanduser("~/.claude/nuu/dashboards"))
# リンク元ではなく、このスクリプトの実体があるリポジトリから雛形の場所を求める。
HOOKS_DIR = os.path.dirname(os.path.realpath(__file__))
CLIENT = os.path.join(os.path.dirname(HOOKS_DIR), "client")
# install.sh が張る固定クライアントへのリンク。作業のフォルダーとしては扱わない。
CLIENT_LINK = "_client"
DATA_SUFFIX = ".data.js"
TASK_CALLBACK = "window.nuuDashboardData("
INDEX_NAME = "index" + DATA_SUFFIX
PREFS_NAME = "prefs" + DATA_SUFFIX
LOCK_NAME = ".index.lock"
# ロックを待つ上限（秒）。エージェント定義のフックの timeout（10 秒）より短くする。
LOCK_WAIT = 5.0
# 一覧の行に持たせる GitHub / GitLab の項目。PR / MR / Issue は番号で、リリースとリポジトリは題名で札にする。
# 時刻と、番号で表す項目の題名は作業のページで見る。
REVIEW_FIELDS = ("provider", "kind", "number", "url", "state")
TITLED_KINDS = ("release", "repo")


def load_validate():
    """作業のデータが壊れているかは、dashboard-validate.py と同じ検査で決める。"""
    # リポジトリの hooks/ に __pycache__ を作らない。
    sys.dont_write_bytecode = True
    spec =importlib.util.spec_from_file_location("dashboard_validate", os.path.join(HOOKS_DIR, "dashboard-validate.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def write_atomic(path, content):
    """書き込み途中のファイルをブラウザに読ませないよう、一時ファイルに書いてから置き換える。"""
    handle, temporary = tempfile.mkstemp(prefix=".nuu-", dir=os.path.dirname(path))
    try:
        with os.fdopen(handle, "wb") as f:
            f.write(content)
        os.chmod(temporary, 0o644)
        os.replace(temporary, path)
    except BaseException:
        if os.path.exists(temporary):
            os.remove(temporary)
        raise


def read_bytes(path):
    try:
        with open(path, "rb") as f:
            return f.read()
    except OSError:
        return None


def place_stub(template, target):
    content = read_bytes(os.path.join(CLIENT, template))
    if content is None:
        print(f"dashboard-page: 雛形 {os.path.join(CLIENT, template)} を読めません", file=sys.stderr)
        return
    if read_bytes(target) != content:
        write_atomic(target, content)


def task_files():
    """すべての作業のデータファイルを (プロジェクト名, 作業名, パス) で返す。"""
    try:
        projects = sorted(os.listdir(DASHBOARDS))
    except OSError:
        return
    for project in projects:
        folder = os.path.join(DASHBOARDS, project)
        if project == CLIENT_LINK or project.startswith(".") or os.path.islink(folder) or not os.path.isdir(folder):
            continue
        for name in sorted(os.listdir(folder)):
            path = os.path.join(folder, name)
            if name.endswith(DATA_SUFFIX) and not name.startswith(".") and os.path.isfile(path):
                yield project, name[: -len(DATA_SUFFIX)], path


def task_row(validate, project, slug, path):
    """作業のデータから一覧の行を作る。壊れていれば None。removed なら False。"""
    c = validate.Checker()
    try:
        with open(path, encoding="utf-8") as f:
            data = validate.parse(path, f.read(), TASK_CALLBACK, c)
    except (OSError, UnicodeDecodeError):
        return None
    if data is None:
        return None
    validate.check_task_data(c, data, project, slug)
    if c.errors:
        return None
    if data["status"] == "removed":
        return False
    row = {
        "project": project,
        "slug": slug,
        "title": data["title"],
        "status": data["status"],
        "done": sum(1 for task in data["tasks"] if task["status"] == "done"),
        # 見送った手順は、やる手順の数に入れない。
        "total": sum(1 for task in data["tasks"] if task["status"] != "skipped"),
        "questions": sum(1 for question in data["questions"] if not question.get("answer")),
        "blockers": len(data["blockers"]),
        "startedAt": data["startedAt"],
        "updatedAt": data["updatedAt"],
        "href": f"{project}/{slug}.html",
    }
    # GitHub / GitLab の項目は、一覧の札に要る項目だけを、最終更新（at）が新しい順に持たせる。
    reviews = sorted(data.get("reviews", []), key=lambda review: review["at"], reverse=True)
    if reviews:
        row["reviews"] = [index_review(review) for review in reviews]
    return row


def index_review(review):
    item = {key: review[key] for key in REVIEW_FIELDS if key in review}
    if review["kind"] in TITLED_KINDS:
        item["title"] = review["title"]
    return item


def previous_rows(path):
    """前の一覧の行を href ごとに返す。読めなければ空にする。"""
    text = read_bytes(path)
    if text is None:
        return {}
    try:
        lines = text.decode("utf-8").split("\n")
        if lines and lines[-1] == "":
            lines.pop()
        if len(lines) < 3 or lines[0] != TASK_CALLBACK or lines[-1] != ");":
            return {}
        items = json.loads("\n".join(lines[1:-1])).get("items")
    except (UnicodeDecodeError, ValueError, AttributeError):
        return {}
    if not isinstance(items, list):
        return {}
    return {item["href"]: item for item in items if isinstance(item, dict) and isinstance(item.get("href"), str)}


def build_index(validate, index_path):
    previous = previous_rows(index_path)
    items = []
    for project, slug, path in task_files():
        row = task_row(validate, project, slug, path)
        if row is None:
            row = previous.get(f"{project}/{slug}.html")
        if row:
            items.append(row)
    body = json.dumps({"schema": 1, "items": items}, ensure_ascii=False, indent=2)
    return f"{TASK_CALLBACK}\n{body}\n);\n".encode("utf-8")


def pause_for_test():
    """並行して動いたときの順序を確かめるテストのためだけの待ち。環境変数がなければ何もしない。"""
    hold = os.environ.get("NUU_DASHBOARD_PAGE_TEST_HOLD")
    if not hold:
        return
    with open(hold + ".scanned", "w", encoding="utf-8"):
        pass
    deadline = time.monotonic() + LOCK_WAIT
    while os.path.exists(hold) and time.monotonic() < deadline:
        time.sleep(0.02)


def lock(handle):
    deadline = time.monotonic() + LOCK_WAIT
    while True:
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
            return True
        except BlockingIOError:
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.05)


def update_index():
    index_path = os.path.join(DASHBOARDS, INDEX_NAME)
    validate = load_validate()
    with open(os.path.join(DASHBOARDS, LOCK_NAME), "a", encoding="utf-8") as handle:
        if not lock(handle):
            print("dashboard-page: ほかの更新が終わらないため、一覧は次の書き込みで作り直します", file=sys.stderr)
            return
        # 前の一覧の読み込みと全作業の走査から置き換えまでをロックの中で行い、古い走査の結果で上書きしない。
        content = build_index(validate, index_path)
        pause_for_test()
        if read_bytes(index_path) != content:
            write_atomic(index_path, content)


def main():
    payload = json.load(sys.stdin)
    if payload.get("tool_name") not in ("Write", "Edit"):
        return
    target = os.path.realpath(os.path.expanduser((payload.get("tool_input") or {}).get("file_path") or ""))
    if not target.startswith(DASHBOARDS + os.sep) or not target.endswith(DATA_SUFFIX):
        return
    parts = os.path.relpath(target, DASHBOARDS).split(os.sep)
    if parts == [PREFS_NAME]:
        pass
    elif len(parts) == 2 and parts[0] != CLIENT_LINK and not parts[0].startswith("."):
        place_stub("task.html", target[: -len(DATA_SUFFIX)] + ".html")
    else:
        return
    place_stub("index.html", os.path.join(DASHBOARDS, "index.html"))
    update_index()


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # スタブや一覧を作れなくても、エージェントを止めない。
        print(f"dashboard-page: {error}", file=sys.stderr)
    sys.exit(0)
