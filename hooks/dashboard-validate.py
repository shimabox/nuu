#!/usr/bin/env python3
"""ダッシュボードのデータファイルを書いた直後に、データの形が決まりどおりかを確かめる。

対象は ~/.claude/nuu/dashboards/ の下の次のファイル。
- <プロジェクト名>/<開始日時>-<作業名>.data.js: 作業のデータ
- prefs.data.js: 好みのスタイル
- index.data.js: 一覧のデータ（フックが作る。形のずれを見つけるため、同じ検査を持つ）

見た目は固定のクライアント（client/）が描くので、ここではデータだけを確かめる。
エージェントに書き込み後の読み直しをさせずに済むよう、壊れているときだけ、
どの項目がなぜだめで、何が書けるかを返して直させる。
正しいときは何も出力しない。確かめられないときも、エージェントの作業は止めない。
依存は標準ライブラリだけ。
"""

import json
import math
import os
import re
import sys

DASHBOARDS = os.path.realpath(os.path.expanduser("~/.claude/nuu/dashboards"))
DATA_SUFFIX = ".data.js"
TASK_CALLBACK = "window.nuuDashboardData("
PREFS_CALLBACK = "window.nuuDashboardPrefs("

# 件数と長さの上限。書き直しの往復を減らすため、画面に収まる量で決めている。
MAX_TITLE = 120  # 作業のタイトル、パネルのタイトル
MAX_SUMMARY = 600  # 作業の要約
MAX_LABEL = 200  # 手順の名前、項目名、セルなどの短い文
MAX_NOTE = 1000  # 補足、質問、既定の対応、理由など
MAX_BODY = 4000  # text パネルの本文
MAX_TASKS = 60
MAX_QUESTIONS = 30
MAX_BLOCKERS = 20
MAX_ARTIFACTS = 50
MAX_PANELS = 12
MAX_ITEMS = 60  # progress、keyvalue の項目
MAX_GRID = 100  # grid のマス
MAX_COLUMNS = 8
MAX_ROWS = 100
MAX_SERIES = 4  # trend の系列
MAX_POINTS = 50  # trend の 1 系列あたりの点
MAX_STEPS = 12  # flow の段階
MAX_INDEX_ITEMS = 1000
MAX_ERRORS = 8  # 1 回に返す理由の数

STATUSES = ("active", "paused", "done", "removed")
INDEX_STATUSES = ("active", "paused", "done")
TASK_STATES = ("todo", "doing", "waiting", "blocked", "done")
STATES = ("todo", "doing", "waiting", "blocked", "done", "failed")
PANEL_TYPES = ("progress", "grid", "table", "keyvalue", "text", "trend", "flow")
THEMES = ("dark", "light")
DENSITIES = ("dense", "airy")
TASK_VIEWS = ("kanban", "list")
PANEL_ID = re.compile(r"\A[a-z0-9][a-z0-9-]{0,39}\Z")
ACCENT = re.compile(r"\A#[0-9A-Fa-f]{6}\Z")
# UNIX 秒の範囲。ミリ秒で書いた値を見分けるため、上限を 10 桁にする。
MIN_TIME = 1_000_000_000
MAX_TIME = 9_999_999_999


def block(reason):
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


def kind(value):
    if value is None:
        return "null"
    if isinstance(value, bool):
        return "真偽値"
    if isinstance(value, (int, float)):
        return "数値"
    if isinstance(value, str):
        return "文字列"
    if isinstance(value, list):
        return "配列"
    return "オブジェクト"


def choices(values):
    return " / ".join(values)


class Checker:
    """理由を集めながら確かめる。1 回で直せるよう、止めずに最後まで見る。"""

    def __init__(self):
        self.errors = []

    def error(self, where, message):
        self.errors.append(f"{where}: {message}")

    # 値ごとの検査。問題がなければ True を返す。

    def text(self, where, value, limit, allow_empty=False):
        if not isinstance(value, str):
            self.error(where, f"文字列にしてください（今は{kind(value)}）")
            return False
        if not allow_empty and not value.strip():
            self.error(where, "空にできません")
            return False
        if len(value) > limit:
            self.error(where, f"{limit} 文字以内にしてください（今は {len(value)} 文字）")
            return False
        return True

    def number(self, where, value):
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
            self.error(where, f"数値にしてください（今は{kind(value)}）")
            return False
        return True

    def count(self, where, value):
        if isinstance(value, bool) or not isinstance(value, int) or value < 0:
            self.error(where, f"0 以上の整数にしてください（今は {json.dumps(value, ensure_ascii=False)}）")
            return False
        return True

    def ident(self, where, value):
        if isinstance(value, bool) or not isinstance(value, int) or value < 1:
            self.error(where, f"1 以上の整数にしてください（今は {json.dumps(value, ensure_ascii=False)}）")
            return False
        return True

    def time(self, where, value):
        if isinstance(value, bool) or not isinstance(value, int):
            self.error(where, f"UNIX 秒の整数（date +%s の値）にしてください（今は{kind(value)}）")
            return False
        if value > MAX_TIME:
            self.error(where, f"{value} はミリ秒のようです。UNIX 秒（10 桁、date +%s の値）にしてください")
            return False
        if value < MIN_TIME:
            self.error(where, f"{value} は UNIX 秒として小さすぎます。date +%s で取った値にしてください")
            return False
        return True

    def boolean(self, where, value):
        if not isinstance(value, bool):
            self.error(where, f"true か false にしてください（今は{kind(value)}）")
            return False
        return True

    def enum(self, where, value, values):
        if value not in values:
            self.error(where, f"{json.dumps(value, ensure_ascii=False)} は使えません。{choices(values)} のどれかにしてください")
            return False
        return True

    def array(self, where, value, limit, hint=""):
        if not isinstance(value, list):
            self.error(where, f"配列にしてください（今は{kind(value)}）。なければ [] にします")
            return False
        if len(value) > limit:
            self.error(where, f"{limit} 件以内にしてください（今は {len(value)} 件）{hint}")
            return False
        return True

    def record(self, where, value, required, optional=()):
        """オブジェクトで、必須の項目がそろい、知らない項目がないかを確かめる。"""
        if not isinstance(value, dict):
            self.error(where, f"オブジェクトにしてください（今は{kind(value)}）")
            return False
        allowed = tuple(required) + tuple(optional)
        ok = True
        for key in value:
            if key not in allowed:
                self.error(where, f"知らない項目 {json.dumps(key, ensure_ascii=False)} があります。書ける項目は {', '.join(allowed)} です")
                ok = False
        for key in required:
            if key not in value:
                self.error(where, f"項目 {key} がありません")
                ok = False
        return ok

    def unique(self, where, values, name):
        seen = set()
        for value in values:
            if isinstance(value, (int, str)) and not isinstance(value, bool):
                if value in seen:
                    self.error(where, f"{name} {json.dumps(value, ensure_ascii=False)} が重複しています。作業の中で重ならない値にしてください")
                seen.add(value)


def at(where, key):
    return f"{where}.{key}" if where else key


def check_state(c, where, item, key, states=STATES):
    if key in item:
        c.enum(at(where, key), item[key], states)


def check_task_data(c, data, project, slug):
    required = ("schema", "project", "slug", "title", "summary", "status", "startedAt", "updatedAt",
                "tasks", "questions", "blockers", "artifacts", "panels")
    if not c.record("データ", data, required):
        if not isinstance(data, dict):
            return
    if "schema" in data and data["schema"] != 1:
        c.error("schema", f"1 にしてください（今は {json.dumps(data['schema'], ensure_ascii=False)}）")
    if "project" in data and c.text("project", data["project"], MAX_LABEL) and data["project"] != project:
        c.error("project", f"ファイルのあるフォルダーの名前 {json.dumps(project, ensure_ascii=False)} と同じにしてください")
    if "slug" in data and c.text("slug", data["slug"], MAX_LABEL) and data["slug"] != slug:
        c.error("slug", f"ファイル名から .data.js を除いた {json.dumps(slug, ensure_ascii=False)} と同じにしてください")
    if "title" in data:
        c.text("title", data["title"], MAX_TITLE)
    if "summary" in data:
        c.text("summary", data["summary"], MAX_SUMMARY, allow_empty=True)
    if "status" in data:
        c.enum("status", data["status"], STATUSES)
    times_ok = all(key in data and c.time(key, data[key]) for key in ("startedAt", "updatedAt"))
    if times_ok and data["updatedAt"] < data["startedAt"]:
        c.error("updatedAt", "startedAt より前にできません。更新した時刻を date +%s で取り直してください")

    if "tasks" in data and c.array("tasks", data["tasks"], MAX_TASKS):
        for i, task in enumerate(data["tasks"]):
            where = f"tasks[{i}]"
            if c.record(where, task, ("id", "title", "status"), ("note",)):
                c.ident(at(where, "id"), task["id"])
                c.text(at(where, "title"), task["title"], MAX_LABEL)
                c.enum(at(where, "status"), task["status"], TASK_STATES)
            if isinstance(task, dict) and "note" in task:
                c.text(at(where, "note"), task["note"], MAX_NOTE, allow_empty=True)
        c.unique("tasks", [t.get("id") for t in data["tasks"] if isinstance(t, dict)], "id")

    if "questions" in data and c.array("questions", data["questions"], MAX_QUESTIONS):
        for i, question in enumerate(data["questions"]):
            where = f"questions[{i}]"
            required = ("id", "question", "default", "proceeding", "askedAt")
            if c.record(where, question, required, ("answer", "answeredAt")):
                c.ident(at(where, "id"), question["id"])
                c.text(at(where, "question"), question["question"], MAX_NOTE)
                c.text(at(where, "default"), question["default"], MAX_NOTE)
                c.boolean(at(where, "proceeding"), question["proceeding"])
                c.time(at(where, "askedAt"), question["askedAt"])
            if not isinstance(question, dict):
                continue
            if "answer" in question:
                c.text(at(where, "answer"), question["answer"], MAX_NOTE)
            if "answeredAt" in question:
                if "answer" not in question:
                    c.error(at(where, "answeredAt"), "answer と一緒に書いてください。回答がまだなら answeredAt を消します")
                else:
                    c.time(at(where, "answeredAt"), question["answeredAt"])
        c.unique("questions", [q.get("id") for q in data["questions"] if isinstance(q, dict)], "id")

    if "blockers" in data and c.array("blockers", data["blockers"], MAX_BLOCKERS):
        for i, blocker in enumerate(data["blockers"]):
            where = f"blockers[{i}]"
            if c.record(where, blocker, ("what", "why", "since", "next")):
                c.text(at(where, "what"), blocker["what"], MAX_LABEL)
                c.text(at(where, "why"), blocker["why"], MAX_NOTE)
                c.time(at(where, "since"), blocker["since"])
                c.text(at(where, "next"), blocker["next"], MAX_NOTE)

    if "artifacts" in data and c.array("artifacts", data["artifacts"], MAX_ARTIFACTS):
        for i, artifact in enumerate(data["artifacts"]):
            where = f"artifacts[{i}]"
            if c.record(where, artifact, ("name", "ref", "at"), ("note",)):
                c.text(at(where, "name"), artifact["name"], MAX_LABEL)
                c.text(at(where, "ref"), artifact["ref"], MAX_NOTE)
                c.time(at(where, "at"), artifact["at"])
                if "note" in artifact:
                    c.text(at(where, "note"), artifact["note"], MAX_NOTE, allow_empty=True)

    if "panels" in data and c.array("panels", data["panels"], MAX_PANELS):
        for i, panel in enumerate(data["panels"]):
            check_panel(c, f"panels[{i}]", panel)
        c.unique("panels", [p.get("id") for p in data["panels"] if isinstance(p, dict)], "id")


PANEL_FIELDS = {
    "progress": ("items",),
    "grid": ("items",),
    "table": ("columns", "rows"),
    "keyvalue": ("items",),
    "text": ("body",),
    "trend": ("series",),
    "flow": ("steps",),
}
PANEL_OPTIONAL = {"trend": ("unit",)}


def check_panel(c, where, panel):
    if not isinstance(panel, dict):
        c.error(where, f"オブジェクトにしてください（今は{kind(panel)}）")
        return
    kind_of = panel.get("type")
    if kind_of not in PANEL_TYPES:
        c.error(at(where, "type"), f"{json.dumps(kind_of, ensure_ascii=False)} は使えません。{choices(PANEL_TYPES)} のどれかにしてください。"
                "収まらない内容は table か text で表します")
        return
    required = ("id", "type", "title") + PANEL_FIELDS[kind_of]
    optional = ("note", "wide") + PANEL_OPTIONAL.get(kind_of, ())
    if not c.record(where, panel, required, optional):
        return
    if isinstance(panel["id"], str):
        if not PANEL_ID.match(panel["id"]):
            c.error(at(where, "id"), "英小文字、数字、- だけの 40 文字以内にしてください（例: files、test-trend）")
    else:
        c.error(at(where, "id"), f"文字列にしてください（今は{kind(panel['id'])}）")
    c.text(at(where, "title"), panel["title"], MAX_TITLE)
    if "note" in panel:
        c.text(at(where, "note"), panel["note"], MAX_NOTE, allow_empty=True)
    if "wide" in panel:
        c.boolean(at(where, "wide"), panel["wide"])
    PANEL_CHECKS[kind_of](c, where, panel)


def check_progress(c, where, panel):
    if not c.array(at(where, "items"), panel["items"], MAX_ITEMS):
        return
    for i, item in enumerate(panel["items"]):
        item_where = f"{where}.items[{i}]"
        if not c.record(item_where, item, ("label", "value", "total"), ("unit",)):
            continue
        c.text(at(item_where, "label"), item["label"], MAX_LABEL)
        if "unit" in item:
            c.text(at(item_where, "unit"), item["unit"], 20)
        value_ok = c.number(at(item_where, "value"), item["value"])
        total_ok = c.number(at(item_where, "total"), item["total"])
        if value_ok and total_ok and not 0 <= item["value"] <= item["total"]:
            c.error(item_where, f"value は 0 以上 total 以下にしてください（今は value {item['value']}、total {item['total']}）")


def check_grid(c, where, panel):
    if not c.array(at(where, "items"), panel["items"], MAX_GRID):
        return
    for i, item in enumerate(panel["items"]):
        item_where = f"{where}.items[{i}]"
        if c.record(item_where, item, ("label", "state"), ("note",)):
            c.text(at(item_where, "label"), item["label"], MAX_LABEL)
            c.enum(at(item_where, "state"), item["state"], STATES)
            if "note" in item:
                c.text(at(item_where, "note"), item["note"], MAX_NOTE, allow_empty=True)


def check_table(c, where, panel):
    columns_ok = c.array(at(where, "columns"), panel["columns"], MAX_COLUMNS)
    if columns_ok:
        if not panel["columns"]:
            c.error(at(where, "columns"), "列を 1 つ以上書いてください")
        for i, column in enumerate(panel["columns"]):
            column_where = f"{where}.columns[{i}]"
            if c.record(column_where, column, ("label",)):
                c.text(at(column_where, "label"), column["label"], MAX_LABEL)
    if not c.array(at(where, "rows"), panel["rows"], MAX_ROWS):
        return
    for i, row in enumerate(panel["rows"]):
        row_where = f"{where}.rows[{i}]"
        if not isinstance(row, list):
            c.error(row_where, f"セルの配列にしてください（今は{kind(row)}）")
            continue
        if columns_ok and len(row) != len(panel["columns"]):
            c.error(row_where, f"セルの数を列の数 {len(panel['columns'])} とそろえてください（今は {len(row)}）。空のセルは \"\" にします")
        for j, cell in enumerate(row):
            cell_where = f"{row_where}[{j}]"
            if isinstance(cell, str):
                c.text(cell_where, cell, MAX_LABEL, allow_empty=True)
            elif isinstance(cell, (int, float)) and not isinstance(cell, bool):
                c.number(cell_where, cell)
            elif isinstance(cell, dict):
                if c.record(cell_where, cell, ("text", "state")):
                    c.text(at(cell_where, "text"), cell["text"], MAX_LABEL, allow_empty=True)
                    c.enum(at(cell_where, "state"), cell["state"], STATES)
            else:
                c.error(cell_where, f"文字列、数値、{{ \"text\": …, \"state\": … }} のどれかにしてください（今は{kind(cell)}）")


def check_keyvalue(c, where, panel):
    if not c.array(at(where, "items"), panel["items"], MAX_ITEMS):
        return
    for i, item in enumerate(panel["items"]):
        item_where = f"{where}.items[{i}]"
        if not c.record(item_where, item, ("label", "value"), ("state",)):
            continue
        c.text(at(item_where, "label"), item["label"], MAX_LABEL)
        if isinstance(item["value"], str):
            c.text(at(item_where, "value"), item["value"], MAX_NOTE, allow_empty=True)
        else:
            c.number(at(item_where, "value"), item["value"])
        check_state(c, item_where, item, "state")


def check_text(c, where, panel):
    c.text(at(where, "body"), panel["body"], MAX_BODY)


def check_trend(c, where, panel):
    if "unit" in panel:
        c.text(at(where, "unit"), panel["unit"], 20)
    if not c.array(at(where, "series"), panel["series"], MAX_SERIES):
        return
    if not panel["series"]:
        c.error(at(where, "series"), "系列を 1 つ以上書いてください")
    for i, series in enumerate(panel["series"]):
        series_where = f"{where}.series[{i}]"
        if not c.record(series_where, series, ("label", "points")):
            continue
        c.text(at(series_where, "label"), series["label"], MAX_LABEL)
        points_where = at(series_where, "points")
        if not c.array(points_where, series["points"], MAX_POINTS, "。古い点から落としてください"):
            continue
        previous = None
        for j, point in enumerate(series["points"]):
            point_where = f"{points_where}[{j}]"
            if not c.record(point_where, point, ("at", "value")):
                continue
            c.number(at(point_where, "value"), point["value"])
            if c.time(at(point_where, "at"), point["at"]):
                if previous is not None and point["at"] < previous:
                    c.error(at(point_where, "at"), "前の点より前の時刻です。点は at の昇順（古い順）に並べてください")
                previous = point["at"]


def check_flow(c, where, panel):
    if not c.array(at(where, "steps"), panel["steps"], MAX_STEPS):
        return
    for i, step in enumerate(panel["steps"]):
        step_where = f"{where}.steps[{i}]"
        if c.record(step_where, step, ("label", "state"), ("note",)):
            c.text(at(step_where, "label"), step["label"], MAX_LABEL)
            c.enum(at(step_where, "state"), step["state"], STATES)
            if "note" in step:
                c.text(at(step_where, "note"), step["note"], MAX_NOTE, allow_empty=True)


PANEL_CHECKS = {
    "progress": check_progress,
    "grid": check_grid,
    "table": check_table,
    "keyvalue": check_keyvalue,
    "text": check_text,
    "trend": check_trend,
    "flow": check_flow,
}


def check_prefs(c, data):
    if not c.record("好み", data, ("schema", "theme", "density", "accent", "taskView")):
        if not isinstance(data, dict):
            return
    if "schema" in data and data["schema"] != 1:
        c.error("schema", f"1 にしてください（今は {json.dumps(data['schema'], ensure_ascii=False)}）")
    if "theme" in data:
        c.enum("theme", data["theme"], THEMES)
    if "density" in data:
        c.enum("density", data["density"], DENSITIES)
    if "taskView" in data:
        c.enum("taskView", data["taskView"], TASK_VIEWS)
    if "accent" in data:
        accent = data["accent"]
        if not isinstance(accent, str) or not ACCENT.match(accent):
            c.error("accent", f"{json.dumps(accent, ensure_ascii=False)} は使えません。# と 16 進 6 桁で書いてください（例: #0EA5E9）。"
                    "色の名前（teal など）は近い 16 進の値に直します")


def check_index(c, data):
    if not c.record("一覧", data, ("schema", "items")):
        if not isinstance(data, dict):
            return
    if "schema" in data and data["schema"] != 1:
        c.error("schema", f"1 にしてください（今は {json.dumps(data['schema'], ensure_ascii=False)}）")
    if "items" not in data or not c.array("items", data["items"], MAX_INDEX_ITEMS):
        return
    fields = ("project", "slug", "title", "status", "done", "total", "questions", "blockers",
              "startedAt", "updatedAt", "href")
    for i, item in enumerate(data["items"]):
        where = f"items[{i}]"
        if not c.record(where, item, fields):
            continue
        texts_ok = all(c.text(at(where, key), item[key], MAX_LABEL if key != "title" else MAX_TITLE)
                       for key in ("project", "slug", "title"))
        c.enum(at(where, "status"), item["status"], INDEX_STATUSES)
        counts_ok = all([c.count(at(where, key), item[key]) for key in ("done", "total", "questions", "blockers")])
        if counts_ok and item["done"] > item["total"]:
            c.error(at(where, "done"), "total より大きくできません")
        if all([c.time(at(where, key), item[key]) for key in ("startedAt", "updatedAt")]) and item["updatedAt"] < item["startedAt"]:
            c.error(at(where, "updatedAt"), "startedAt より前にできません")
        if texts_ok and item["href"] != f"{item['project']}/{item['slug']}.html":
            c.error(at(where, "href"), f"{json.dumps(item['project'] + '/' + item['slug'] + '.html', ensure_ascii=False)} にしてください")


def parse(path, text, callback, c):
    """包み（1 行目の呼び出しと最終行の ); ）を外し、JSON として読む。読めなければ None。"""
    lines = text.split("\n")
    if lines and lines[-1] == "":
        lines.pop()
    if len(lines) < 3 or lines[0] != callback or lines[-1] != ");":
        c.error("ファイルの形", f"1 行目を {callback} 、最終行を ); にし、その間に JSON だけを書いてください。前後に空行や文字を置きません")
        return None
    body = "\n".join(lines[1:-1])
    try:
        return json.loads(body)
    except json.JSONDecodeError as error:
        body_lines = body.splitlines()
        line = body_lines[error.lineno - 1] if 0 < error.lineno <= len(body_lines) else ""
        c.error("JSON", f"{error.msg}（JSON の {error.lineno} 行目 {error.colno} 文字目: {line.strip()[:80]}）。"
                "JSON として正しくなるよう直してください")
        return None


def report(path, c):
    if not c.errors:
        return
    shown = c.errors[:MAX_ERRORS]
    rest = len(c.errors) - len(shown)
    lines = [f"{path} のデータを直してください。"] + [f"- {error}" for error in shown]
    if rest > 0:
        lines.append(f"- ほかに {rest} 件あります。上を直してから、もう一度確かめます")
    block("\n".join(lines))


def main():
    payload = json.load(sys.stdin)
    if payload.get("tool_name") not in ("Write", "Edit"):
        return
    path = os.path.realpath(os.path.expanduser((payload.get("tool_input") or {}).get("file_path") or ""))
    if not path.endswith(DATA_SUFFIX) or not path.startswith(DASHBOARDS + os.sep):
        return
    relative = os.path.relpath(path, DASHBOARDS)
    parts = relative.split(os.sep)
    with open(path, encoding="utf-8") as f:
        text = f.read()
    c = Checker()
    if parts == ["prefs" + DATA_SUFFIX]:
        data = parse(path, text, PREFS_CALLBACK, c)
        if data is not None:
            check_prefs(c, data)
    elif parts == ["index" + DATA_SUFFIX]:
        data = parse(path, text, TASK_CALLBACK, c)
        if data is not None:
            check_index(c, data)
    elif len(parts) == 2:
        data = parse(path, text, TASK_CALLBACK, c)
        if data is not None:
            check_task_data(c, data, parts[0], parts[1][: -len(DATA_SUFFIX)])
    else:
        c.error("置き場所", "作業のデータは ~/.claude/nuu/dashboards/<プロジェクト名>/<開始日時>-<作業名>.data.js に、"
                "好みは ~/.claude/nuu/dashboards/prefs.data.js に置きます")
    report(path, c)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # 確かめられないときは、エージェントを止めない。
        print(f"dashboard-validate: {error}", file=sys.stderr)
    sys.exit(0)
