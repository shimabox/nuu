#!/usr/bin/env python3
"""ダッシュボードの HTML を書いた直後に、埋め込んだデータが JSON として正しいかを確かめる。

エージェントに書き込み後の読み直しをさせずに済むよう、壊れているときだけ理由を返して直させる。
正しいときは何も出力しない。確かめられないときも、エージェントの作業は止めない。
"""

import json
import os
import re
import sys

DASHBOARDS = os.path.realpath(os.path.expanduser("~/.claude/nuu/dashboards"))
DATA = re.compile(r'<script id="dashboard-data" type="application/json">(.*?)</script>', re.S)


def block(reason):
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


def main():
    payload = json.load(sys.stdin)
    if payload.get("tool_name") not in ("Write", "Edit"):
        return
    path = os.path.realpath(os.path.expanduser((payload.get("tool_input") or {}).get("file_path") or ""))
    if not path.endswith(".html"):
        return
    with open(path, encoding="utf-8") as f:
        text = f.read()
    match = DATA.search(text)
    if not match:
        # ダッシュボードの置き場所の HTML には、必ずデータがなければならない。
        if path.startswith(DASHBOARDS + os.sep):
            block(f'{path} に <script id="dashboard-data" type="application/json"> が見つかりません。データを消さずに残してください。')
        return
    try:
        data = json.loads(match.group(1))
    except json.JSONDecodeError as error:
        line = match.group(1).splitlines()[error.lineno - 1] if error.lineno else ""
        block(
            f"{path} の dashboard-data の JSON が壊れています: {error.msg}"
            f"（データの {error.lineno} 行目 {error.colno} 文字目: {line.strip()[:80]}）。"
            "JSON として正しくなるよう直してください。"
        )
        return
    if os.path.basename(path) == "index.html" and not isinstance(data.get("items") if isinstance(data, dict) else None, list):
        block(f"{path} の dashboard-data に items の配列がありません。一覧の行は items に入れてください。")


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # 確かめられないときは、エージェントを止めない。
        print(f"dashboard-validate: {error}", file=sys.stderr)
    sys.exit(0)
