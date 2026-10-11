#!/usr/bin/env python3
"""dashboard-updater を、モデルごとに同じ条件で動かして比べるための補助。

  bench.py --run-dir DIR prepare <モデル…> [--patterns 1,3,8] [--force]
      固定の初期データをモデルごとに複製し、検査を通して、進み具合を state file に書く
  bench.py --run-dir DIR next [--max 1〜18]
      次に流す updater の呼び出しを、Agent ツールの引数の JSON で出す。
      流している最中の呼び出しが終わっていなければ、それだけを出し直して 3 で終わる
  bench.py --run-dir DIR done
      流し終えた呼び出しの状態を保存し、採用した記録を state file に控える
  bench.py --run-dir DIR stats [--detail [字数]]
      state file に控えた記録から、時間・トークン・料金・差し戻しを集計する
  bench.py --run-dir DIR cleanup
      計測用のフォルダー（zbench-*）だけを消し、一覧を作り直す

DIR は state file と保存した状態を置く作業用のフォルダーで、リポジトリの外に置く。
依存は標準ライブラリだけ。
"""
import argparse
import glob
import importlib.util
import json
import os
import re
import shutil
import statistics
import sys
import time
from datetime import datetime

# リポジトリに __pycache__ を作らない。
sys.dont_write_bytecode = True

HERE = os.path.dirname(os.path.realpath(__file__))
SKILL = os.path.dirname(HERE)
# スキルは <リポジトリ>/.claude/skills/nuu-updater-bench/ に置く。
REPO = os.path.dirname(os.path.dirname(os.path.dirname(SKILL)))
D = os.path.expanduser("~/.claude/nuu/dashboards")
RECORDS = os.path.expanduser("~/.claude/projects")
MODELS = ("haiku", "sonnet", "opus", "fable")
AGENT = "dashboard-updater"
# 計測用のフォルダーの名前。cleanup はこれに合うものだけを消す。
BENCH_DIR = re.compile(r"^zbench-s\d\d(-[a-z0-9]+)?$")
TOKENS = ("in", "out", "read", "w5", "w1h")
# 1 回に出す呼び出しの上限。同時に動かせるサブエージェントは 20 個で、ほかの用途に 2 つ空ける。
MAX_CALLS = 18
# next の終了コード: 新しい回ではなく、終わっていない呼び出しを出し直した。
RESENT = 3


def load(path):
    t = open(path, encoding="utf-8").read()
    return json.loads(t[t.index("(") + 1 : t.rindex(")")])


def hook_module(name):
    spec = importlib.util.spec_from_file_location(name.replace("-", "_"), f"{REPO}/hooks/{name}.py")
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


def validate_module():
    return hook_module("dashboard-validate")


def errors(v, path, project, slug):
    c = v.Checker()
    data = v.parse(path, open(path, encoding="utf-8").read(), "window.nuuDashboardData(", c)
    if data is not None:
        v.check_task_data(c, data, project, slug)
    return list(c.errors)


# ---- パターンと依頼文

def prompts():
    """依頼文を {(パターン, 手順): 文} で返す。"""
    raw = json.load(open(f"{SKILL}/scenarios/prompts.json", encoding="utf-8"))
    out = {}
    for key, text in raw.items():
        m = re.fullmatch(r"s(\d\d)\.step(\d+)", key)
        out[(int(m.group(1)), int(m.group(2)))] = text
    return out


def step_counts(ps):
    """パターンごとの手順の数。"""
    out = {}
    for n, step in ps:
        out[n] = max(out.get(n, 0), step)
    return out


def fill(text, model):
    return text.replace("{dashboards}", D).replace("{model}", model)


def base_path(n):
    return f"{SKILL}/scenarios/base/s{n:02d}.data.js"


def project_of(n, model):
    return f"zbench-s{n:02d}-{model}"


def data_path(n, model):
    return f"{D}/{project_of(n, model)}/{load(base_path(n))['slug']}.data.js"


def record_key(n, model, step):
    """手順の名前。保存した状態のファイル名と、state file に控える記録のキーに使う。"""
    return f"s{n:02d}-{model}.step{step}"


def snap_path(run, n, model, step):
    return f"{run}/snap/{record_key(n, model, step)}.data.js"


def bench_entries():
    """ダッシュボードの下にある、zbench- で始まるもの。"""
    try:
        return sorted(x for x in os.listdir(D) if x.startswith("zbench-"))
    except OSError:
        return []


# ---- state file

def state_path(run):
    return f"{run}/state.json"


def read_state(run):
    try:
        return json.load(open(state_path(run), encoding="utf-8"))
    except OSError:
        sys.exit(f"{state_path(run)} がありません。prepare から始めてください")


def write_state(run, state):
    tmp = state_path(run) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, state_path(run))


def call_of(p):
    """state file の「流している最中」の 1 件から、Agent ツールの引数を取り出す。"""
    return {k: p[k] for k in ("description", "subagent_type", "model", "prompt")}


# ---- prepare

def prepare(run, models, patterns, force):
    left = bench_entries()
    if left:
        print(f"計測用のフォルダーが {len(left)} 件残っています（{'、'.join(left[:6])}{' ほか' if len(left) > 6 else ''}）。")
        print("何もしていません。先に cleanup が要ります")
        return 1
    if not os.path.isdir(D):
        print(f"{D} がありません。nuu を入れてから流してください")
        return 1
    if os.path.exists(state_path(run)) and not force:
        print(f"{state_path(run)} がすでにあります。何もしていません。")
        print("続きは next で流せます。最初から作り直すなら --force を付けます（保存した状態も消します）")
        return 1
    ps = prompts()
    known = sorted(step_counts(ps))
    patterns = sorted(set(patterns)) if patterns else known
    unknown = [n for n in patterns if n not in known]
    if unknown:
        print(f"パターン {unknown} はありません。指定できるのは {known[0]}〜{known[-1]} です")
        return 1
    v = validate_module()
    made, bad = [], []
    try:
        for n in patterns:
            text = open(base_path(n), encoding="utf-8").read()
            base = f"zbench-s{n:02d}"
            slug = load(base_path(n))["slug"]
            if text.count(f'"project": "{base}"') != 1:
                bad.append((base, [f'初期データに "project": "{base}" が 1 つではありません']))
                continue
            for model in models:
                project = project_of(n, model)
                os.makedirs(f"{D}/{project}")
                made.append(f"{D}/{project}")
                dst = f"{D}/{project}/{slug}.data.js"
                with open(dst, "w", encoding="utf-8") as f:
                    f.write(text.replace(f'"project": "{base}"', f'"project": "{project}"'))
                e = errors(v, dst, project, slug)
                if e:
                    bad.append((project, e))
    except BaseException:  # 途中で落ちても、計測用のフォルダーを残さない
        for folder in made:
            shutil.rmtree(folder, ignore_errors=True)
        raise
    if bad:
        for folder in made:
            shutil.rmtree(folder)
        print("初期データが検査を通りません。作ったフォルダーは消しました。")
        for project, e in bad:
            for line in e:
                print(f"  {project}: {line}")
        print("データの形が変わった合図です。scenarios/base/ の初期データを作り直してください")
        return 1
    os.makedirs(run, exist_ok=True)
    if force:
        shutil.rmtree(f"{run}/snap", ignore_errors=True)
    write_state(run, {"models": list(models), "patterns": patterns, "started": int(time.time()), "pending": [], "records": {}})
    counts = step_counts(ps)
    total = sum(counts[n] for n in patterns) * len(models)
    print(f"用意しました: モデル {'、'.join(models)} / パターン {len(patterns)} 個 / フォルダー {len(made)} 個 / 呼び出し 全 {total} 回")
    return 0


# ---- next と done

def saved(run, state, n, model, step):
    """状態を保存して、記録を state file に控えてある手順か。"""
    return record_key(n, model, step) in state["records"] and os.path.exists(snap_path(run, n, model, step))


def next_step(run, state, counts, n, model):
    """まだ状態を保存していない最初の手順。すべて保存済みなら None。"""
    for step in range(1, counts[n] + 1):
        if not saved(run, state, n, model, step):
            return step
    return None


def remaining(run, state, counts):
    return sum(
        counts[n] - step + 1
        for n in state["patterns"]
        for model in state["models"]
        for step in [next_step(run, state, counts, n, model)]
        if step is not None
    )


def settle(run, state):
    """流している最中の呼び出しのうち、終わったものの状態を保存して、記録を state file に控える。

    同じ手順の記録が複数あれば、始まりが最も新しい記録で判定する。それが終わっていなければ、
    以前に終わった記録があっても保存しない（流し直しの途中の状態を保存しないため）。
    保存した件数と、終わっていないもの [(呼び出し, 記録の様子)] を返す。
    """
    got = running(state)
    os.makedirs(f"{run}/snap", exist_ok=True)
    count, rest = 0, []
    for p in state["pending"]:
        n, model, step = p["pattern"], p["model"], p["step"]
        rs = got.get((n, model, step), [])
        if rs and rs[-1]["finished"]:
            if not os.path.exists(data_path(n, model)):
                sys.exit(f"{data_path(n, model)} がありません。計測用のフォルダーを消したあとなら、prepare --force からやり直してください")
            shutil.copy(data_path(n, model), snap_path(run, n, model, step))
            state["records"][record_key(n, model, step)] = {"file": rs[-1]["file"], "reruns": len(rs) - 1}
            count += 1
        elif rs:
            rest.append((p, f"記録の最後の書き込みから {max(0, int(time.time() - rs[-1]['written']))} 秒"))
        else:
            rest.append((p, "記録がまだない"))
    state["pending"] = [p for p, _ in rest]
    write_state(run, state)
    return count, rest


def next_calls(run, limit):
    state = read_state(run)
    if state["pending"]:
        count, rest = settle(run, state)
        if rest:
            print(json.dumps([call_of(p) for p, _ in rest], ensure_ascii=False, indent=1))
            print(
                f"新しい回ではありません。流している最中の呼び出しのうち、終わっていない {len(rest)} 件を出し直しました"
                + (f"（終わっていた {count} 件は、状態を保存しました）。" if count else "。"),
                file=sys.stderr,
            )
            print("まだ動いているものは通知を待ち、失敗して終わったものだけを同じ引数で流し直してください", file=sys.stderr)
            for p, note in rest:
                print(f"  {p['description']}: {note}", file=sys.stderr)
            return RESENT
        print(f"終わっていた呼び出し {count} 件の状態を保存しました", file=sys.stderr)
    ps = prompts()
    counts = step_counts(ps)
    groups = []
    for n in state["patterns"]:
        todo = [(model, next_step(run, state, counts, n, model)) for model in state["models"]]
        todo = [(model, step) for model, step in todo if step is not None]
        if todo:
            groups.append((max(counts[n] - step + 1 for _, step in todo), n, todo))
    # 手順が多く残っているパターンから入れる（回数を少なくするため）。
    # 同じパターンの全モデルは同じ回に入れ、入りきらないパターンは次の回に回す。
    groups.sort(key=lambda g: (-g[0], g[1]))
    batch = []
    for _, n, todo in groups:
        if len(batch) + len(todo) > limit:
            continue
        for model, step in todo:
            if not os.path.exists(data_path(n, model)):
                print(f"{data_path(n, model)} がありません。計測用のフォルダーを消したあとなら、prepare --force からやり直してください", file=sys.stderr)
                return 1
            batch.append(
                {
                    "pattern": n,
                    "step": step,
                    "description": f"s{n:02d} {model} step{step}",
                    "subagent_type": AGENT,
                    "model": model,
                    "prompt": fill(ps[(n, step)], model),
                }
            )
    if groups and not batch:
        print(f"--max {limit} が、1 つのパターンで流すモデルの数より小さいので、何も出せません", file=sys.stderr)
        return 1
    state["pending"] = batch
    write_state(run, state)
    print(json.dumps([call_of(p) for p in batch], ensure_ascii=False, indent=1))
    if batch:
        names = sorted({f"s{p['pattern']:02d} step{p['step']}" for p in batch})
        print(f"{len(batch)} 件（{'、'.join(names)}）。残りの呼び出しは、この回を含めて {remaining(run, state, counts)} 回", file=sys.stderr)
    else:
        print("すべての手順を流し終えています", file=sys.stderr)
    return 0


def done(run):
    state = read_state(run)
    if not state["pending"]:
        print("流している最中の呼び出しはありません")
        return 0
    count, rest = settle(run, state)
    print(f"状態を保存 {count} 件")
    if rest:
        print(f"終わった記録がない呼び出しが {len(rest)} 件あります。終わるのを待つか、同じ引数で流してから、もう一度 done を呼んでください")
        for p, note in rest:
            print(f"  {p['description']}: {note}")
        return 1
    left = remaining(run, state, step_counts(prompts()))
    print(f"残りの呼び出しは {left} 回" if left else "すべての手順を流し終えました")
    return 0


# ---- 記録の読み取りと集計

def ts(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()


def rates():
    return json.load(open(f"{SKILL}/resources/rates.json", encoding="utf-8"))


def cost(tok, model_id, table):
    """記録のトークンからの料金（ドル）。単価がないモデル ID は None。"""
    r = table.get(model_id)
    if not isinstance(r, dict):
        return None
    read = r.get("cache_read", r["in"] * 0.1)
    return (tok["in"] * r["in"] + tok["out"] * r["out"] + tok["read"] * read + tok["w5"] * r["in"] * 1.25 + tok["w1h"] * r["in"] * 2) / 1e6


def read_record(path):
    """updater の 1 回の記録を読む。updater の記録でなければ None。"""
    try:
        if json.load(open(path[:-6] + ".meta.json", encoding="utf-8")).get("agentType") != AGENT:
            return None
        lines = open(path, encoding="utf-8").read().split("\n")
        written = os.path.getmtime(path)
    except (OSError, ValueError):
        return None
    es = []
    for line in lines:
        try:
            es.append(json.loads(line))
        except ValueError:  # 書きかけの行は読み飛ばす
            pass
    prompt = None
    for e in es:
        if e.get("type") == "user":
            c = (e.get("message") or {}).get("content")
            prompt = c if isinstance(c, str) else " ".join(b.get("text", "") for b in c or [] if isinstance(b, dict))
            break
    stamps = [ts(e["timestamp"]) for e in es if e.get("timestamp")]
    if prompt is None or not stamps:
        return None
    rejects = []
    for e in es:
        a = e.get("attachment") or {}
        if e.get("type") == "attachment" and a.get("type") == "hook_blocking_error":
            why = a.get("blockingError") or a.get("content") or ""
            rejects.append(why.get("blockingError", "") if isinstance(why, dict) else str(why))
    resp, model_id, tools, reads, tool_errors = {}, None, 0, 0, 0
    handback, last_text, ended = None, "", False
    for e in es:
        msg = e.get("message") or {}
        content = msg.get("content")
        if e.get("type") == "user":
            tool_errors += sum(
                1 for b in (content if isinstance(content, list) else [])
                if isinstance(b, dict) and b.get("type") == "tool_result" and b.get("is_error")
            )
        if e.get("type") != "assistant":
            continue
        for b in content or []:
            # 返事は SubagentHandback の呼び出しで渡される。古い形の記録では最後の文章が返事。
            if b.get("type") == "tool_use" and b.get("name") == "SubagentHandback":
                handback = (b.get("input") or {}).get("message") or handback
            elif b.get("type") == "tool_use":
                tools += 1
                reads += b.get("name") == "Read"
                ended = False
            elif b.get("type") == "text" and b.get("text", "").strip():
                last_text = b["text"]
                ended = msg.get("stop_reason") == "end_turn"
        u = msg.get("usage")
        if u and msg.get("id"):
            if msg.get("model") and msg["model"] != "<synthetic>":
                model_id = msg["model"]
            cc = u.get("cache_creation") or {}
            cur = {
                "in": int(u.get("input_tokens") or 0),
                "out": int(u.get("output_tokens") or 0),
                "read": int(u.get("cache_read_input_tokens") or 0),
                "w5": int(cc.get("ephemeral_5m_input_tokens") or 0),
                "w1h": int(cc.get("ephemeral_1h_input_tokens") or 0),
                "w": int(u.get("cache_creation_input_tokens") or 0),
            }
            # 同じ応答が何行にも分かれて記録されるので、応答 ID ごとに 1 回だけ数える。
            old = resp.setdefault(msg["id"], dict.fromkeys(cur, 0))
            for k in cur:
                old[k] = max(old[k], cur[k])
    tok = {k: sum(r[k] for r in resp.values()) for k in ("in", "out", "read", "w5", "w1h", "w")}
    # 保持時間の内訳がない書き込みは、5 分として数える。
    tok["w5"] += max(0, tok.pop("w") - tok["w5"] - tok["w1h"])
    return {
        "prompt": prompt,
        "start": min(stamps),
        "sec": max(stamps) - min(stamps),
        "model_id": model_id,
        "turns": len(resp),
        "tools": tools,
        "reads": reads,
        "tool_errors": tool_errors,
        "tok": tok,
        "rejects": rejects,
        "reply": handback or last_text,
        # 返事が取れていれば、終わった呼び出しとする。
        "finished": bool(handback) or (ended and bool(last_text)),
        "file": path,
        # 記録のファイルに最後に書き込まれた時刻。
        "written": written,
    }


def tag(r, key, ps, table):
    """記録に、どの手順のものかと料金を付ける。"""
    r["n"], r["model"], r["step"] = key
    r["finish"] = ps[(key[0], key[2])].startswith("finish")
    r["cost"] = cost(r["tok"], r["model_id"], table)
    return r


def running(state):
    """計測を始めてからの記録を {(パターン, モデル, 手順): [記録…]}（始まった順）で返す。

    流している最中の呼び出しが終わったかを確かめるときだけ使う。集計と採点は recorded() を使う。
    どの手順かは、最初の依頼文が一致するかで決める（始まった順では数えない）。
    """
    ps = prompts()
    wanted = {
        fill(ps[(n, step)], model): (n, model, step)
        for (n, step) in ps
        if n in state["patterns"]
        for model in state["models"]
    }
    table = rates()
    found = {}
    for path in glob.glob(f"{RECORDS}/*/*/subagents/agent-*.jsonl"):
        try:
            if os.path.getmtime(path) < state["started"]:
                continue
        except OSError:
            continue
        r = read_record(path)
        if r is None or "zbench-s" not in r["prompt"]:
            continue
        hit = [p for p in wanted if p in r["prompt"]]
        if not hit:
            continue
        key = wanted[max(hit, key=len)]
        found.setdefault(key, []).append(tag(r, key, ps, table))
    for rs in found.values():
        rs.sort(key=lambda r: r["start"])
    return found


def recorded(state):
    """state file に控えた記録を {(パターン, モデル, 手順): 記録} で返す。

    控えのない手順は入れない。控えた記録のファイルがなくなっていた手順は None にする
    （あとから流した別の計測の記録では埋めない）。
    """
    ps = prompts()
    table = rates()
    out = {}
    for (n, step) in sorted(ps):
        for model in state["models"]:
            kept = state["records"].get(record_key(n, model, step))
            if kept is None:
                continue
            r = read_record(kept["file"])
            if r is not None:
                tag(r, (n, model, step), ps, table)
                r["reruns"] = kept["reruns"]
            out[(n, model, step)] = r
    return out


def money(rs):
    known = [r["cost"] for r in rs if r["cost"] is not None]
    return f"${sum(known) / len(known):.5f}" if len(known) == len(rs) and rs else "不明"


def stats(run, detail):
    state = read_state(run)
    got = recorded(state)
    rows = sorted((r for r in got.values() if r is not None), key=lambda r: (r["n"], r["step"], state["models"].index(r["model"])))
    lost = sorted((key for key, r in got.items() if r is None), key=lambda k: (k[0], k[2], state["models"].index(k[1])))
    for model in state["models"]:
        rs = [r for r in rows if r["model"] == model]
        gone = sum(1 for key in lost if key[1] == model)
        if not rs:
            print(f"{model:6} " + (f"集計できる記録がありません（記録なし {gone} 件）" if gone else "記録がありません"))
            continue
        k = len(rs)
        secs = [r["sec"] for r in rs]
        ids = "、".join(sorted({str(r["model_id"]) for r in rs}))
        print(f"{model:6} {ids} 呼び出し {k} 回（流し直し {sum(r['reruns'] for r in rs)} 回{f'、記録なし {gone} 件' if gone else ''}）")
        print(f"       時間 平均 {sum(secs) / k:.1f} 秒 中央 {statistics.median(secs):.1f} 秒 最短 {min(secs):.1f} 秒 最長 {max(secs):.1f} 秒")
        print(
            f"       1 回 {money(rs)} 応答 {sum(r['turns'] for r in rs) / k:.1f} 回 ツール {sum(r['tools'] for r in rs) / k:.1f} 回 "
            f"差し戻し {sum(len(r['rejects']) for r in rs)} 回 失敗したツール呼び出し {sum(r['tool_errors'] for r in rs)} 回 "
            f"2 回以上 Read した呼び出し {sum(1 for r in rs if r['reads'] >= 2)} 回 返事 平均 {sum(len(r['reply']) for r in rs) / k:.0f} 字"
        )
        t = {key: round(sum(r["tok"][key] for r in rs) / k) for key in TOKENS}
        print(
            f"       1 回あたりのトークン 入力 {t['in']} 出力 {t['out']} キャッシュの読み込み {t['read']} "
            f"キャッシュへの書き込み 5 分 {t['w5']} / 1 時間 {t['w1h']}"
        )
        for name, part in (("完了", [r for r in rs if r["finish"]]), ("それ以外", [r for r in rs if not r["finish"]])):
            if part:
                print(
                    f"       {name} {len(part)} 回: 平均 {sum(r['sec'] for r in part) / len(part):.1f} 秒 1 回 {money(part)} "
                    f"差し戻し {sum(len(r['rejects']) for r in part)} 回"
                )
    if lost:
        print(f"記録なし {len(lost)} 件（state file に控えた記録のファイルがありません。集計に入れていません）")
        for n, model, step in lost:
            print(f"  s{n:02d} step{step} {model:6} {state['records'][record_key(n, model, step)]['file']}")
    if state["pending"]:
        print(f"流している最中の呼び出しが {len(state['pending'])} 件あります（集計に入れていません）")
    rejected = [r for r in rows if r["rejects"]]
    print(f"差し戻しのあった手順 {len(rejected)} 件")
    for r in rejected:
        why = r["rejects"][0].split("\n")
        print(f"  s{r['n']:02d} step{r['step']} {r['model']:6} {len(r['rejects'])} 回 | {(why[1] if len(why) > 1 else why[0]).strip()[:100]}")
    if detail:
        print("呼び出しごと")
        for r in rows:
            c = "不明" if r["cost"] is None else f"${r['cost']:.5f}"
            print(
                f"  s{r['n']:02d} step{r['step']} {r['model']:6} {r['sec']:5.1f} 秒 {c} 応答 {r['turns']} ツール {r['tools']} "
                f"差し戻し {len(r['rejects'])} | {r['reply'][:detail].replace(chr(10), ' / ')}"
            )
    return 0


# ---- cleanup

def cleanup():
    removed = 0
    for name in bench_entries():
        folder = f"{D}/{name}"
        # 名前が合う実体のフォルダーだけを消す。リンクやほかのものには触れない。
        if BENCH_DIR.match(name) and os.path.isdir(folder) and not os.path.islink(folder):
            shutil.rmtree(folder)
            removed += 1
    page = hook_module("dashboard-page")
    index = f"{D}/index.data.js"

    def listed():
        try:
            return open(index, encoding="utf-8").read().count("zbench-")
        except OSError:
            return 0

    for _ in range(3):
        # ほかの更新とロックが重なると作り直されないことがあるので、残っていればやり直す。
        page.update_index()
        if not listed():
            break
        time.sleep(1)
    left = bench_entries()
    print(f"消したフォルダー {removed} 個 / 残っている zbench- {len(left)} 個 / 一覧に残っている zbench- {listed()} 件")
    if left or listed():
        for name in left:
            print("  残っている: " + name)
        print("計測用のものが残っています。手で確かめてください")
        return 1
    return 0


# ---- 入口

def max_calls(text):
    try:
        n = int(text)
    except ValueError:
        n = 0
    if not 1 <= n <= MAX_CALLS:
        raise argparse.ArgumentTypeError(f"1〜{MAX_CALLS} で指定してください（同時に動かせるサブエージェントの数に収めるため）")
    return n


def main():
    ap = argparse.ArgumentParser(description="dashboard-updater のモデル比較の補助")
    ap.add_argument("--run-dir", required=True, help="state file と保存した状態を置く作業用のフォルダー（リポジトリの外）")
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("prepare")
    p.add_argument("models", nargs="+", choices=MODELS, metavar="モデル", help=" | ".join(MODELS))
    p.add_argument("--patterns", help="流すパターンをカンマ区切りで絞る（例: 1,3,8）")
    p.add_argument("--force", action="store_true", help="state file と保存した状態を作り直す")
    p = sub.add_parser("next")
    p.add_argument("--max", type=max_calls, default=MAX_CALLS, metavar="件数", help=f"1 回に出す呼び出しの上限（1〜{MAX_CALLS}）")
    sub.add_parser("done")
    p = sub.add_parser("stats")
    p.add_argument("--detail", nargs="?", type=int, const=160, default=0, metavar="字数", help="呼び出しごとの行も出す")
    sub.add_parser("cleanup")
    a = ap.parse_args()

    run = os.path.realpath(os.path.expanduser(a.run_dir))
    if (run + os.sep).startswith(os.path.realpath(REPO) + os.sep):
        sys.exit("--run-dir は、リポジトリの外に置いてください")
    if a.cmd == "prepare":
        if len(set(a.models)) != len(a.models):
            sys.exit("同じモデルを 2 回指定しています")
        try:
            patterns = [int(x) for x in a.patterns.split(",")] if a.patterns else []
        except ValueError:
            sys.exit("--patterns は 1,3,8 のように数字で指定してください")
        return prepare(run, a.models, patterns, a.force)
    if a.cmd == "next":
        return next_calls(run, a.max)
    if a.cmd == "done":
        return done(run)
    if a.cmd == "stats":
        return stats(run, a.detail)
    return cleanup()


if __name__ == "__main__":
    sys.exit(main())
