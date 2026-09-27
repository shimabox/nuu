#!/usr/bin/env python3
"""ダッシュボードのデータを書いた直後に、データが JSON として正しいかを確かめる。

データは HTML と同じフォルダーのデータファイル（<名前>.data.js）に置く。
ダッシュボードの HTML は、そのデータファイルを script 要素の src で読み込んでいるかを確かめる。
エージェントに書き込み後の読み直しをさせずに済むよう、壊れているときだけ理由を返して直させる。
正しいときは何も出力しない。確かめられないときも、エージェントの作業は止めない。
"""

import json
import os
import re
import sys

DASHBOARDS = os.path.realpath(os.path.expanduser("~/.claude/nuu/dashboards"))
DATA_FILE = re.compile(r"\Awindow\.nuuDashboardData\(\n(.*)\n\);\n?\Z", re.S)
DATA_SUFFIX = ".data.js"


def block(reason):
    print(json.dumps({"decision": "block", "reason": reason}, ensure_ascii=False))


def check_json(path, text, where):
    """JSON として読めればデータを、読めなければ理由を知らせて None を返す。"""
    try:
        return json.loads(text)
    except json.JSONDecodeError as error:
        lines = text.splitlines()
        line = lines[error.lineno - 1] if 0 < error.lineno <= len(lines) else ""
        block(
            f"{path} の{where}の JSON が壊れています: {error.msg}"
            f"（データの {error.lineno} 行目 {error.colno} 文字目: {line.strip()[:80]}）。"
            "JSON として正しくなるよう直してください。"
        )
        return None


def check_items(path, data, is_index):
    if is_index and not isinstance(data.get("items") if isinstance(data, dict) else None, list):
        block(f"{path} のデータに items の配列がありません。一覧の行は items に入れてください。")


def check_data_file(path, text):
    match = DATA_FILE.match(text)
    if not match:
        block(
            f"{path} の形が崩れています。1 行目を window.nuuDashboardData( 、最終行を ); にし、"
            "その間に JSON だけを書いてください。"
        )
        return
    data = check_json(path, match.group(1), "データファイル")
    if data is not None:
        check_items(path, data, os.path.basename(path) == "index" + DATA_SUFFIX)


def check_html(path, text):
    # ダッシュボードの HTML は、同じフォルダーのデータファイルを script 要素の src で読み込まなければならない。
    # 警告文などにファイル名があるだけでは、読み込んでいることにならない。
    data_file = os.path.basename(path)[: -len(".html")] + DATA_SUFFIX
    loads_data = re.search(r'<script\b[^>]*\ssrc="' + re.escape(data_file) + r'"', text)
    if not loads_data:
        block(
            f"{path} が同じフォルダーのデータファイル {data_file} を読み込んでいません。"
            f'データは同じフォルダーの {data_file} に置き、HTML に <script src="{data_file}"></script> を置いて読み込んでください。'
        )


def main():
    payload = json.load(sys.stdin)
    if payload.get("tool_name") not in ("Write", "Edit"):
        return
    path = os.path.realpath(os.path.expanduser((payload.get("tool_input") or {}).get("file_path") or ""))
    if path.endswith(DATA_SUFFIX):
        if not path.startswith(DASHBOARDS + os.sep):
            return
        check = check_data_file
    elif path.endswith(".html"):
        if not path.startswith(DASHBOARDS + os.sep):
            return
        check = check_html
    else:
        return
    with open(path, encoding="utf-8") as f:
        check(path, f.read())


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # 確かめられないときは、エージェントを止めない。
        print(f"dashboard-validate: {error}", file=sys.stderr)
    sys.exit(0)
