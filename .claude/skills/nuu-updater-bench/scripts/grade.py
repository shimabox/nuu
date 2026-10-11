#!/usr/bin/env python3
"""パターンの手順ごとに保存した状態を採点する。

  grade.py --run-dir DIR [-v]

DIR は bench.py と同じ作業用のフォルダー。モデルとパターンは state file から読む。
返事は、bench.py の done が state file に控えた記録から読む（あとから流した別の計測の記録は使わない）。
s10 の step4 の「一覧にない」は、いまの一覧を読んで確かめるので、採点は cleanup の前に行う。
"""
import argparse
import json
import os
import sys

sys.dont_write_bytecode = True
HERE = os.path.dirname(os.path.realpath(__file__))
sys.path.insert(0, HERE)
import bench  # noqa: E402

STEPS = {1: 7, 2: 2, 3: 4, 4: 2, 5: 2, 6: 3, 7: 3, 8: 3, 9: 2, 10: 4, 11: 3, 12: 3}
FINAL = {"done", "failed", "skipped"}


def T(d):
    return [t.get("status") for t in d.get("tasks", [])]


def panel(d, pid):
    return next((p for p in d.get("panels", []) if p.get("id") == pid), {})


def kv(d, pid):
    return {i.get("label"): (str(i.get("value")), i.get("state")) for i in panel(d, pid).get("items", [])}


def has(pair, text, state):
    return pair is not None and text in pair[0] and pair[1] == state


def cell(c):
    return (c.get("text"), c.get("state")) if isinstance(c, dict) else (c, None)


def rev(d):
    return [(r.get("provider"), r.get("kind"), r.get("number"), r.get("state")) for r in d.get("reviews", [])]


def leftovers(d):
    """完了のあとに残った、未着手や途中の状態。"""
    out = [t["title"] for t in d.get("tasks", []) if t.get("status") not in ("done", "skipped")]
    for p in d.get("panels", []):
        for i in p.get("items", []) + p.get("steps", []):
            if "state" in i and i["state"] not in FINAL:
                out.append(f"{p['id']}:{i.get('label')}")
        for row in p.get("rows", []):
            for c in row:
                if isinstance(c, dict) and c.get("state") not in FINAL:
                    out.append(f"{p['id']}:{row[0]}")
    return out


def strip(s):
    return (s or "").strip("「」 ")


def listed(project):
    """計測用の作業が、いまの一覧に載っているか。フォルダーがもうなければ None（確かめられない）。"""
    if not os.path.isdir(f"{bench.D}/{project}"):
        return None
    return any(r.get("project") == project for r in bench.load(bench.D + "/index.data.js")["items"])


def checks(n, step, d, prev, reply, model):
    """手順ごとの採点の項目を (名前, 合否) で返す。合否が None の項目は、未確認として数に入れない。"""
    q = d.get("questions", [])
    a = d.get("artifacts", [])
    b = d.get("blockers", [])
    if n == 1:
        spec, chk = kv(d, "audit-spec"), kv(d, "audit-checks")
        if step == 1:
            return [("手順", T(d) == ["done", "doing", "todo"]),
                    ("記録する項目", has(spec.get("記録する項目"), "IP アドレス", "done")),
                    ("記録するタイミング", has(spec.get("記録するタイミング"), "成功と失敗", "done")),
                    ("記録の処理", chk.get("記録の処理") == ("実装中", "doing")),
                    ("テストは変えない", chk.get("テスト") == ("未実行", "todo"))]
        if step == 2:
            return [("質問 1 件", len(q) == 1 and "90 日" in q[0].get("question", "")),
                    ("既定の対応", bool(q) and "90 日で進める" in q[0].get("default", "")),
                    ("進めている", bool(q) and q[0].get("proceeding") is True and isinstance(q[0].get("askedAt"), int)),
                    ("手順は変えない", T(d) == ["done", "doing", "todo"])]
        if step == 3:
            return [("PR 下書き", rev(d) == [("github", "pr", 42, "draft")]),
                    ("題名と URL", bool(d.get("reviews")) and d["reviews"][0].get("title") == "監査ログの項目を足す"
                     and d["reviews"][0].get("url") == "https://github.com/example-org/audit/pull/42")]
        if step == 4:
            return [("中断中", d["status"] == "paused"), ("手順は変えない", T(d) == ["done", "doing", "todo"])]
        if step == 5:
            return [("進行中", d["status"] == "active")]
        if step == 6:
            return [("PR レビュー中", rev(d) == [("github", "pr", 42, "open")])]
        if step == 7:
            return [("完了", d["status"] == "done"), ("手順", T(d) == ["done"] * 3),
                    ("回答", len(q) == 1 and "90 日でよい" in (q[0].get("answer") or "") and isinstance(q[0].get("answeredAt"), int)),
                    ("記録の処理", chk.get("記録の処理") == ("実装済み", "done")),
                    ("テスト", has(chk.get("テスト"), "12 件成功", "done")),
                    ("PR はそのまま", rev(d) == [("github", "pr", 42, "open")]),
                    ("途中の状態が残っていない", leftovers(d) == [])]
    if n == 2:
        fmt = kv(d, "csv-format").get("形式")
        if step == 1:
            return [("手順", T(d) == ["done", "done", "doing", "todo"]),
                    ("形式", fmt is not None and "UTF-8" in fmt[0] and "カンマ" in fmt[0] and fmt[1] == "done")]
        if step == 2:
            return [("手順", T(d) == ["done", "done", "done", "doing"]),
                    ("落ちたテストが残っていない", not any("落ち" in json.dumps(x, ensure_ascii=False) for x in b)),
                    ("形式はそのまま", fmt is not None and "UTF-8" in fmt[0] and fmt[1] == "done")]
    if n == 3:
        rows = panel(d, "slow-queries").get("rows", [])
        st = kv(d, "production-state")
        if step == 1:
            return [("手順", T(d) == ["done", "done", "todo"]),
                    ("表に 2 行", len(rows) == 2 and all(len(r) == 4 for r in rows)),
                    ("1 行目", len(rows) == 2 and "注文の一覧" in str(rows[0][0]) and rows[0][1] == "orders"
                     and "user_id" in str(rows[0][2]) and cell(rows[0][3]) == ("未実施", "todo")),
                    ("2 行目", len(rows) == 2 and "在庫の検索" in str(rows[1][0]) and rows[1][1] == "stock_items"
                     and "sku" in str(rows[1][2]) and cell(rows[1][3]) == ("未実施", "todo")),
                    ("状態の 2 項目", has(st.get("見つけた遅いクエリ"), "2 本", "done") and has(st.get("設計した索引"), "2 つ", "done")),
                    ("本番への反映は変えない", st.get("本番への反映") == ("未実施", "todo"))]
        if step == 2:
            return [("止まっているもの", len(b) == 1 and "索引を本番に入れる" in b[0].get("what", "") and "承認" in b[0].get("why", "")
                     and "手順書" in b[0].get("next", "") and isinstance(b[0].get("since"), int)),
                    ("手順 3 は blocked", T(d) == ["done", "done", "blocked"])]
        if step == 3:
            return [("止まっているものが空", b == []), ("手順 3 は doing", T(d) == ["done", "done", "doing"])]
        if step == 4:
            return [("完了", d["status"] == "done"), ("手順", T(d) == ["done"] * 3), ("止まっているものが空", b == []),
                    ("表の反映", len(rows) == 2 and all(cell(r[3]) == ("反映済み", "done") for r in rows)),
                    ("状態の反映", has(st.get("本番への反映"), "反映済み", "done")),
                    ("途中の状態が残っていない", leftovers(d) == [])]
    if n == 4:
        m = kv(d, "mail-copy")
        if step == 1:
            return [("質問 2 件", len(q) == 2),
                    ("1 件目", len(q) == 2 and "件名に店名" in q[0].get("question", "") and strip(q[0].get("default")) == "入れる"),
                    ("2 件目", len(q) == 2 and "英語版" in q[1].get("question", "") and "日本語版だけ" in q[1].get("default", "")),
                    ("進めている", len(q) == 2 and all(x.get("proceeding") is True for x in q))]
        if step == 2:
            return [("1 件目に回答", len(q) == 2 and strip(q[0].get("answer")) == "入れない" and isinstance(q[0].get("answeredAt"), int)),
                    ("2 件目は未回答", len(q) == 2 and not q[1].get("answer") and "answeredAt" not in q[1]),
                    ("手順", T(d) == ["done", "todo", "todo"]),
                    ("集めた文面", has(m.get("集めた文面"), "8 通", "done")),
                    ("ほかの値は変えない", m.get("書き直した文面") == ("未集計", "todo") and m.get("送信テストの結果") == ("未実行", "todo"))]
    if n == 5:
        o = kv(d, "invoice-outputs")
        names = [(x.get("name"), x.get("ref")) for x in a]
        want = [("見本の PDF", "docs/invoice-sample.pdf"), ("生成処理", "src/invoice/pdf.ts"), ("確認の手順", "docs/invoice-check.md")]
        if step == 1:
            return [("成果物 3 件", names == want), ("時刻", all(isinstance(x.get("at"), int) for x in a) and len(a) == 3)]
        if step == 2:
            return [("成果物 3 件のまま", names == want),
                    ("説明を直した", any(x.get("name") == "生成処理" and "税込みと税抜きの両方を出す" in (x.get("note") or "") for x in a)),
                    ("ほかの説明は変えない", sum(1 for x in a if "税込み" in (x.get("note") or "")) == 1),
                    ("手順", T(d) == ["done", "done", "todo"]),
                    ("パネルの 2 項目", has(o.get("見本"), "作成済み", "done") and has(o.get("生成した PDF"), "生成できた", "done")),
                    ("照合は変えない", o.get("見本との照合") == ("未実行", "todo"))]
    if n == 6:
        it = (panel(d, "replaced-files").get("items") or [{}])[0]
        val = (it.get("value"), it.get("total"))
        if step == 1:
            return [("手順", T(d) == ["done", "doing", "todo"]), ("棒 3 / 10", val == (3, 10))]
        if step == 2:
            return [("棒 7 / 10", val == (7, 10)), ("手順は変えない", T(d) == ["done", "doing", "todo"])]
        if step == 3:
            return [("棒 10 / 10", val == (10, 10)), ("手順", T(d) == ["done", "done", "todo"])]
    if n == 7:
        pts = (panel(d, "passing-trend").get("series") or [{}])[0].get("points", [])
        vals = [p.get("value") for p in pts]
        asc = all(pts[i]["at"] <= pts[i + 1]["at"] for i in range(len(pts) - 1))
        it = (panel(d, "passing-now").get("items") or [{}])[0]
        val = (it.get("value"), it.get("total"))
        if step == 1:
            return [("手順", T(d) == ["done", "todo", "todo"]), ("推移", vals == [30, 38] and asc), ("棒", val == (38, 50))]
        if step == 2:
            return [("手順", T(d) == ["done", "doing", "todo"]), ("推移", vals == [30, 38, 45] and asc), ("棒", val == (45, 50))]
        if step == 3:
            return [("手順", T(d) == ["done"] * 3), ("推移", vals == [30, 38, 45, 50] and asc), ("棒", val == (50, 50))]
    if n == 8:
        s = kv(d, "dark-mode-spec")
        if step == 1:
            return [("MR 下書き", rev(d) == [("gitlab", "mr", 17, "draft")]),
                    ("題名と URL", bool(d.get("reviews")) and d["reviews"][0].get("title") == "ダークモードの切り替えを足す"
                     and d["reviews"][0].get("url") == "https://gitlab.com/example-group/settings/-/merge_requests/17"),
                    ("手順", T(d) == ["done", "todo", "todo"]),
                    ("配色", has(s.get("ダークモードの配色"), "#121212", "done") and "#E6E6E6" in s["ダークモードの配色"][0])]
        if step == 2:
            return [("MR レビュー中", rev(d) == [("gitlab", "mr", 17, "open")]), ("手順は変えない", T(d) == ["done", "todo", "todo"])]
        if step == 3:
            return [("MR マージ済み", rev(d) == [("gitlab", "mr", 17, "merged")]), ("完了", d["status"] == "done"),
                    ("手順", T(d) == ["done"] * 3),
                    ("切り替え", s.get("設定画面の切り替え") == ("実装済み", "done")),
                    ("表示の確認", has(s.get("表示の確認"), "3 画面で確認済み", "done")),
                    ("途中の状態が残っていない", leftovers(d) == [])]
    if n == 9:
        titles = [t.get("title") for t in d["tasks"]]
        ids = [t.get("id") for t in d["tasks"]]
        if step == 1:
            return [("手順 4 件の並び", titles == ["集める項目を決める", "送る処理を書く", "個人情報を消す", "集計を作る"]),
                    ("状態", T(d) == ["todo"] * 4), ("id が重ならない", len(set(ids)) == len(ids))]
        if step == 2:
            return [("名前を変えた", titles == ["集める項目を決める", "送る処理を書き、失敗したら再送する", "個人情報を消す", "集計を作る"]),
                    ("状態", T(d) == ["done", "todo", "todo", "todo"]),
                    ("集める項目", has(kv(d, "log-design").get("集める項目"), "検索語", "done"))]
    if n == 10:
        c = kv(d, "compress-time")
        body = panel(d, "hotspots").get("body", "")
        if step == 1:
            return [("手順", T(d) == ["done", "todo"]), ("直す前", has(c.get("直す前"), "840 ms", "done")),
                    ("直した後は変えない", c.get("直した後") == ("未計測", "todo")),
                    ("文章 2 段落", "読み直している" in body and "1 画素ずつ" in body and "\n\n" in body and "まだ計測していない" not in body)]
        if step == 2:
            return [("中断中", d["status"] == "paused"), ("手順は変えない", T(d) == ["done", "todo"])]
        if step == 3:
            return [("完了", d["status"] == "done"), ("手順", T(d) == ["done", "done"]),
                    ("直した後", has(c.get("直した後"), "310 ms", "done")), ("途中の状態が残っていない", leftovers(d) == [])]
        if step == 4:
            on_index = listed(f"zbench-s10-{model}")
            return [("外した", d["status"] == "removed"),
                    ("一覧にない", None if on_index is None else not on_index)]
    if n == 11:
        rows = {r[0]: cell(r[1]) for r in panel(d, "environments").get("rows", [])}
        g = {i.get("label"): i.get("state") for i in panel(d, "devices").get("items", [])}
        if step == 1:
            return [("語彙を直した", T(d) == ["done", "doing", "todo"]),
                    ("表", rows == {"開発": ("確認済み", "done"), "検証": ("未確認", "todo"), "本番": ("未確認", "todo")}),
                    ("マス目", g == {"iOS": "done", "Android": "todo", "Web": "todo"})]
        if step == 2:
            return [("完了にしない", d["status"] == "active"),
                    ("パネルを推測で埋めない", rows.get("検証") == ("未確認", "todo") and rows.get("本番") == ("未確認", "todo")
                     and g.get("Android") == "todo" and g.get("Web") == "todo"),
                    ("残りを返した", all(w in reply for w in ("検証", "本番", "Android", "Web")))]
        if step == 3:
            return [("完了", d["status"] == "done"), ("手順", T(d) == ["done"] * 3),
                    ("検証", rows.get("検証") == ("確認済み", "done")),
                    ("本番は見送り", rows.get("本番") is not None and "見送" in rows["本番"][0] and rows["本番"][1] == "skipped"),
                    ("マス目", g == {"iOS": "done", "Android": "done", "Web": "failed"}),
                    ("途中の状態が残っていない", leftovers(d) == [])]
    if n == 12:
        m = kv(d, "measurements")
        if step == 1:
            return [("語彙を直した", T(d) == ["done", "doing", "todo"]),
                    ("値", m.get("p95 の応答時間", ("",))[0] == "640 ms" and m.get("キャッシュのヒット率", ("",))[0] == "35%"),
                    ("成果物", [(x.get("name"), x.get("ref")) for x in a] == [("計測メモ", "docs/perf-notes.md")])]
        if step == 2:
            return [("Issue だけ載せた", rev(d) == [("github", "issue", 80, "open")]),
                    ("http の PR を載せないと返した", "88" in reply or "http://" in reply or "PR" in reply)]
        if step == 3:
            same = {k: v for k, v in d.items() if k != "updatedAt"} == {k: v for k, v in prev.items() if k != "updatedAt"}
            return [("何も変えない", same), ("パネルは 1 つのまま", len(d.get("panels", [])) == 1),
                    ("構成の見直しと返した", "構成の見直し" in reply)]
    return [("採点の定義がない", False)]


def main():
    ap = argparse.ArgumentParser(description="保存した状態を手順ごとに採点する")
    ap.add_argument("--run-dir", required=True, help="bench.py と同じ作業用のフォルダー")
    ap.add_argument("-v", action="store_true", help="パターンごとの行も出す")
    a = ap.parse_args()
    run = os.path.realpath(os.path.expanduser(a.run_dir))
    state = bench.read_state(run)
    v = bench.validate_module()
    got = bench.recorded(state)
    total, unchecked, lost = {}, [], []
    for model in state["models"]:
        for n in state["patterns"]:
            base = bench.load(bench.base_path(n))
            prev = base
            line = []
            for step in range(1, STEPS[n] + 1):
                path = bench.snap_path(run, n, model, step)
                if not bench.saved(run, state, n, model, step):
                    line.append(f"step{step} まだ")
                    break
                r = got.get((n, model, step))
                if r is None:
                    lost.append(f"{model} s{n:02d} step{step}")
                d = bench.load(path)
                slug = base["slug"]
                res = [("形が正しい", bench.errors(v, path, bench.project_of(n, model), slug) == []),
                       ("題名や構成を変えない", d.get("title") == base["title"] and d.get("startedAt") == base["startedAt"]
                        and [(p.get("id"), p.get("type")) for p in d.get("panels", [])] == [(p["id"], p["type"]) for p in base["panels"]])]
                try:
                    res += checks(n, step, d, prev, r["reply"] if r else "", model)
                except Exception as e:  # 採点の途中で落ちたものは不合格として数える
                    res.append((f"採点エラー {type(e).__name__}: {e}", False))
                unchecked += [f"{model} s{n:02d} step{step}: {k}" for k, x in res if x is None]
                res = [(k, x) for k, x in res if x is not None]
                ok = sum(1 for _, x in res if x)
                fails = [k for k, x in res if not x]
                t = total.setdefault(model, {"ok": 0, "all": 0, "steps": 0, "clean": 0, "fails": []})
                t["ok"] += ok
                t["all"] += len(res)
                t["steps"] += 1
                t["clean"] += not fails
                t["fails"] += [f"s{n:02d} step{step}: {f}" for f in fails]
                line.append(f"step{step} {ok}/{len(res)}" + ("" if not fails else " NG[" + "、".join(fails) + "]"))
                prev = d
            if a.v or any("NG" in x or "まだ" in x for x in line):
                print(f"{model:6} s{n:02d}  " + " | ".join(line))
    for model, t in total.items():
        print(f"{model:6} 手順 {t['clean']}/{t['steps']} が全項目合格、項目 {t['ok']}/{t['all']}")
        for f in t["fails"]:
            print("        ", f)
    if unchecked:
        print(f"未確認 {len(unchecked)} 項目（計測用のフォルダーがもうないので、数に入れていません）")
        for u in unchecked:
            print("        ", u)
    if lost:
        print(f"注意: 記録なし {len(lost)} 件（state file に控えた記録のファイルがありません。返事を見る項目は、返事なしで採点しています）")
        for x in lost:
            print("        ", x)


if __name__ == "__main__":
    main()
