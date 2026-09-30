#!/usr/bin/env python3
"""dashboard-builder か dashboard-updater が作業のデータファイルを書いた直後に、その作業のトークン量を集計する。

会話の記録（Claude 本体とサブエージェント）から、ダッシュボードを用意し始めた時刻以降の
トークン量を合計し、データファイルと同じフォルダーの <作業>.usage.js に書く。
作業したセッションに戻れるよう、セッションの ID と作業ディレクトリも一緒に書く。
データファイルを書いたエージェント（dashboard-builder / dashboard-updater）とそのモデルも、前回までの記録に足して書く。
データファイルはエージェントが編集中のため、このスクリプトは書き換えない。
集計に失敗してもエージェントの作業は止めない。
"""

import json
import os
import sys
import time
from datetime import datetime

DASHBOARDS = os.path.realpath(os.path.expanduser("~/.claude/nuu/dashboards"))
DASHBOARD_AGENTS = ("dashboard-builder", "dashboard-updater")
TOKEN_KEYS = {
    "input": "input_tokens",
    "output": "output_tokens",
    "cacheRead": "cache_read_input_tokens",
    "cacheWrite": "cache_creation_input_tokens",
}


def empty():
    return {key: 0 for key in TOKEN_KEYS} | {"total": 0}


def epoch(timestamp):
    try:
        return datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()
    except (AttributeError, ValueError):
        return None


def read_lines(path):
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                try:
                    yield json.loads(line)
                except json.JSONDecodeError:
                    continue
    except OSError:
        return


def first_timestamp(path):
    for entry in read_lines(path):
        value = epoch(entry.get("timestamp"))
        if value is not None:
            return value
    return None


def add_usage(bucket, by_model, seen, path, since):
    """記録の assistant 応答を since 以降に限って合計する。同じ応答は 1 回だけ数える。

    記録は応答の部品ごとに 1 行ずつ残り、途中の行の出力トークンは書き出し途中の値になっている。
    応答ごとに各項目の最大値を取り、確定した行が残っていればその値を使う。
    """
    responses = {}
    for entry in read_lines(path):
        if entry.get("type") != "assistant":
            continue
        message = entry.get("message") or {}
        usage = message.get("usage")
        message_id = message.get("id")
        stamp = epoch(entry.get("timestamp"))
        if not usage or not message_id or stamp is None or stamp < since or message_id in seen:
            continue
        response = responses.setdefault(message_id, {"model": message.get("model") or "unknown"} | empty())
        for key, field in TOKEN_KEYS.items():
            response[key] = max(response[key], int(usage.get(field) or 0))
    for message_id, response in responses.items():
        seen.add(message_id)
        total = sum(response[key] for key in TOKEN_KEYS)
        for key in TOKEN_KEYS:
            bucket[key] += response[key]
        bucket["total"] += total
        by_model[response["model"]] = by_model.get(response["model"], 0) + total


def agent_type(transcript):
    try:
        with open(transcript[: -len(".jsonl")] + ".meta.json", encoding="utf-8") as f:
            return json.load(f).get("agentType")
    except (OSError, ValueError):
        return None


def last_model(path):
    """記録の最後の応答のモデルを返す。Claude Code が合成した応答（<synthetic> など）は除く。"""
    model = None
    for entry in read_lines(path):
        if entry.get("type") != "assistant":
            continue
        value = (entry.get("message") or {}).get("model")
        if isinstance(value, str) and value and not value.startswith("<"):
            model = value
    return model


def agent_models(existing, own):
    """エージェントごとに、データファイルを書いたモデルを最初に書いた順で並べる。

    前回までの記録を引き継ぐので、別のセッションで再開して書いた分も残る。
    """
    models = {name: [] for name in DASHBOARD_AGENTS}
    previous = existing.get("agentModels")
    if isinstance(previous, dict):
        for name in DASHBOARD_AGENTS:
            values = previous.get(name)
            if isinstance(values, list):
                models[name] = [value for value in values if isinstance(value, str) and value]
    name = agent_type(own)
    model = last_model(own)
    if name in DASHBOARD_AGENTS and model and model not in models[name]:
        models[name].append(model)
    return {name: values for name, values in models.items() if values}


def read_existing(usage_path):
    try:
        with open(usage_path, encoding="utf-8") as f:
            text = f.read()
        return json.loads(text[text.index("=", text.index("]")) + 1 : text.rindex(";")])
    except (OSError, ValueError):
        return None


def main():
    payload = json.load(sys.stdin)
    if payload.get("tool_name") not in ("Write", "Edit"):
        return
    target = os.path.realpath(os.path.expanduser((payload.get("tool_input") or {}).get("file_path") or ""))
    relative = os.path.relpath(target, DASHBOARDS)
    # 作業のデータファイル（<プロジェクト>/<作業>.data.js）だけを対象にし、一覧や好みは数えない。
    # スタブ（.html）はフックが置くので、エージェントの書き込みとしては起きない。
    suffix = ".data.js"
    if relative.startswith("..") or relative.count(os.sep) != 1 or not relative.endswith(suffix):
        return
    target = target[: -len(suffix)]
    relative = relative[: -len(suffix)]

    transcript = payload.get("transcript_path") or ""
    session_dir = transcript[: -len(".jsonl")] if transcript.endswith(".jsonl") else ""
    subagents_dir = os.path.join(session_dir, "subagents")
    key = relative.replace(os.sep, "/")
    usage_path = target + ".usage.js"

    existing = read_existing(usage_path) or {}
    own = os.path.join(subagents_dir, f"agent-{payload.get('agent_id')}.jsonl")
    since = existing.get("since")
    if since is None:
        # 最初の書き込みは setup の最後に起きるので、setup を始めた時刻から数える。
        since = first_timestamp(own) or time.time()

    categories = {"main": empty(), "subagents": empty(), "dashboard": empty()}
    by_model = {}
    seen = set()
    add_usage(categories["main"], by_model, seen, transcript, since)
    if os.path.isdir(subagents_dir):
        for name in sorted(os.listdir(subagents_dir)):
            if not name.endswith(".jsonl"):
                continue
            path = os.path.join(subagents_dir, name)
            bucket = "dashboard" if agent_type(path) in DASHBOARD_AGENTS else "subagents"
            add_usage(categories[bucket], by_model, seen, path, since)

    totals = empty()
    for bucket in categories.values():
        for field in totals:
            totals[field] += bucket[field]

    data = {
        "since": int(since),
        "updatedAt": int(time.time()),
        "sessionId": payload.get("session_id"),
        "cwd": payload.get("cwd"),
        "totals": totals,
        "byCategory": categories,
        "byModel": by_model,
        "agentModels": agent_models(existing, own),
    }
    body = json.dumps(data, ensure_ascii=False)
    script = (
        "// dashboard-usage.py が書く。手で編集しない。\n"
        f"(window.NUU_USAGE = window.NUU_USAGE || {{}})[{json.dumps(key, ensure_ascii=False)}] = {body};\n"
    )
    temporary = usage_path + ".tmp"
    with open(temporary, "w", encoding="utf-8") as f:
        f.write(script)
    os.replace(temporary, usage_path)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:  # 集計の失敗でエージェントを止めない。
        print(f"dashboard-usage: {error}", file=sys.stderr)
    sys.exit(0)
