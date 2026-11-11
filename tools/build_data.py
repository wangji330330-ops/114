# -*- coding: utf-8 -*-
"""把「题目导入模板」Excel 表格合并成一站式题库数据。

用法：
    pip install xlrd openpyxl
    python tools/build_data.py --src <题库目录> --out assets/data.js

处理要点：
1. 单元回填：文件名或「知识点」列中的「第X单元」决定归属；
2. 共用选项：B 型题/组题把备选答案单独写成一行或一行多列，按「最近一次出现的选项组」补齐；
3. 去重：题干（去空白/编号/标点）+ 正确答案文本 作为联合键，避免仅凭题干误并；
4. 输出：window.QB = {version,total,units,questions}，供 index.html 直接读取。
"""
import argparse
import collections
import json
import math
import os
import re
import unicodedata

NBSP = "\u00a0"

UNIT_NAMES = {
    1: "中药的性能", 2: "中药的配伍", 3: "中药的用药禁忌", 4: "中药的剂量与用法",
    5: "解表药", 6: "清热药", 7: "泻下药", 8: "祛风湿药", 9: "化湿药",
    10: "利水渗湿药", 11: "温里药", 12: "理气药", 13: "消食药", 14: "驱虫药",
    15: "止血药", 16: "活血祛瘀药", 17: "化痰止咳平喘药", 18: "安神药",
    19: "平肝息风药", 20: "开窍药", 21: "补虚药", 22: "收涩药",
    23: "攻毒杀虫止痒药", 0: "综合练习",
}
NAME_TO_ID = {v: k for k, v in UNIT_NAMES.items()}
NAME_TO_ID.update({"利水滲湿药": 10, "总论": 1, "中药学总论": 1})

CN_NUM = {"一": 1, "二": 2, "三": 3, "四": 4, "五": 5, "六": 6, "七": 7, "八": 8,
          "九": 9, "十": 10}
DIFFS = {"非常简单": 1, "简单": 2, "一般": 3, "困难": 4, "非常困难": 5}

UNIT_DESC = {
    1: "四气五味 · 归经 · 升降浮沉 · 毒性", 2: "七情配伍 · 君臣佐使",
    3: "十八反 · 十九畏 · 妊娠禁忌", 4: "剂量 · 煎服法",
    5: "发散表邪，解表证", 6: "清热泻火 · 燥湿 · 凉血 · 解毒",
    7: "攻下 · 润下 · 峻下逐水", 8: "祛除风湿，解除痹痛",
    9: "芳香化湿，健脾", 10: "利水消肿 · 利尿通淋 · 利湿退黄",
    11: "温里散寒，回阳救逆", 12: "疏理气机，行气解郁",
    13: "消食化积，健脾开胃", 14: "驱杀肠道寄生虫",
    15: "制止体内外出血", 16: "通利血脉，消散瘀血",
    17: "化痰 · 止咳 · 平喘", 18: "宁心安神，安定神志",
    19: "平肝潜阳，息风止痉", 20: "辛香走窜，开窍醒神",
    21: "补益气血阴阳之不足", 22: "收敛固涩，治滑脱证",
    23: "攻毒 · 杀虫 · 止痒",
}


def cn2int(s):
    if s.isdigit():
        return int(s)
    if s in CN_NUM:
        return CN_NUM[s]
    if s.startswith("十"):
        return 10 + CN_NUM.get(s[1:2], 0)
    if s.endswith("十"):
        return CN_NUM.get(s[:1], 0) * 10
    if len(s) == 3 and s[1] == "十":
        return CN_NUM.get(s[0], 0) * 10 + CN_NUM.get(s[2], 0)
    return None


def clean(s):
    if s is None:
        return ""
    if isinstance(s, float) and s == int(s):
        s = int(s)
    s = str(s).replace(NBSP, " ").replace("\u3000", " ").replace("\u200b", "")
    s = s.replace("\r", "\n")
    s = re.sub(r"[ \t]+", " ", s)
    s = re.sub(r"\n{2,}", "\n", s)
    return s.strip()


def norm_key(s):
    s = unicodedata.normalize("NFKC", s or "")
    s = s.replace(NBSP, "").replace(" ", "")
    s = re.sub(r"[（(]\s*[)）]", "", s)
    s = s.replace("(", "").replace(")", "")
    s = re.sub(r"[。．\.]+$", "", s)
    s = re.sub(r"^[（(]?\d{1,3}[)）\.、．:：]", "", s)
    return s


def strip_number(stem):
    s = clean(stem)
    s = re.sub(r"^\s*[（(]?\d{1,3}\s*[)）\.、．:：]\s*", "", s)
    s = re.sub(r"^[\.．、,，。;；:：\-—\s]+", "", s)
    return s.strip()


def unit_from_text(t):
    t = clean(t)
    if not t:
        return None
    m = re.search(r"第\s*([0-9]{1,2}|[一二三四五六七八九十]{1,3})\s*单元", t)
    if m:
        n = cn2int(m.group(1))
        if n and 1 <= n <= 23:
            return n
    for name, uid in NAME_TO_ID.items():
        if name in t:
            return uid
    return None


def parse_options(cells):
    opts = []
    for i, c in enumerate(cells):
        t = clean(c)
        if not t:
            opts.append("")
            continue
        letter = chr(65 + i)
        m = re.match(r"^([A-Ha-h])\s*(?:[\.．、,，)）:：]\s*|\s+)?", t)
        if m and m.group(1).upper() == letter:
            t = t[m.end():]
        t = t.lstrip(".．、,，)）:： ")
        opts.append(t.strip())
    while opts and not opts[-1]:
        opts.pop()
    return opts


def parse_answer(s, n_opts):
    a = clean(s)
    a = re.sub(r"^(正确)?答案\s*[:：]?\s*", "", a)
    if a in ("正确", "对", "√", "T", "TRUE", "True"):
        return ["正确"]
    if a in ("错误", "错", "×", "F", "FALSE", "False"):
        return ["错误"]
    out = []
    for x in re.findall(r"[A-Ha-h]", a):
        x = x.upper()
        if x not in out:
            out.append(x)
    if n_opts:
        out = [x for x in out if ord(x) - 65 < n_opts]
    return out


def load_sheets(path, name):
    if name.lower().endswith(".xls"):
        import xlrd
        wb = xlrd.open_workbook(path)
        out = []
        for sn in wb.sheet_names():
            sh = wb.sheet_by_name(sn)
            out.append((sn, [[sh.cell_value(r, c) for c in range(sh.ncols)] for r in range(sh.nrows)]))
        return out
    import openpyxl
    wb = openpyxl.load_workbook(path, data_only=True)
    return [(ws.title, [[c if c is not None else "" for c in row] for row in ws.iter_rows(values_only=True)])
            for ws in wb.worksheets]


def extract(path, name, stats=None):
    stats = stats if stats is not None else collections.Counter()
    recs = []
    file_unit = unit_from_text(os.path.splitext(name)[0])
    for sn, rows in load_sheets(path, name):
        if not rows:
            continue
        hdr_i = None
        for i, r in enumerate(rows[:4]):
            cells = [clean(x) for x in r]
            if any(c in ("题干", "题目", "试题") for c in cells) and any("题型" in c for c in cells):
                hdr_i = i
                break
        if hdr_i is None:
            continue
        hdr = [clean(x) for x in rows[hdr_i]]
        col = {"opt": []}
        for i, h in enumerate(hdr):
            if "知识点" in h or h in ("章节", "考点"):
                col.setdefault("k", i)
            elif "题干" in h or h in ("题目", "试题"):
                col.setdefault("q", i)
            elif "题型" in h:
                col.setdefault("t", i)
            elif "难" in h:
                col.setdefault("d", i)
            elif "答案" in h:
                col.setdefault("a", i)
            elif "解析" in h:
                col.setdefault("e", i)
            elif re.match(r"^选项\s*[A-H]$", h):
                col["opt"].append(i)
        if "q" not in col:
            col.update({"k": 0, "q": 1, "t": 2, "d": 3, "a": 5, "e": 6})
        opt_idx = sorted(col["opt"]) or [7, 8, 9, 10, 11]

        def get(r, key, default=""):
            i = col.get(key)
            return r[i] if i is not None and i < len(r) else default

        cur_unit = file_unit
        prev_options = None
        prev_at = -99
        for ridx, r in enumerate(rows[hdr_i + 1:], hdr_i + 1):
            stats["rows"] += 1
            k_text = clean(get(r, "k"))
            u = unit_from_text(k_text)
            if u:
                cur_unit = u
            stem = strip_number(get(r, "q"))
            t_raw = clean(get(r, "t"))
            raw_opts = [r[i] if i < len(r) else "" for i in opt_idx]
            here_opts = [x for x in parse_options(raw_opts) if x]

            if not stem:
                if len(here_opts) >= 2:          # 共用选项行
                    prev_options = here_opts
                    prev_at = ridx
                    stats["shared_rows"] += 1
                elif "组题" in t_raw:
                    stats["group_rows"] += 1
                continue
            if re.fullmatch(r"(A\d?|B\d?|X)\s*型?\s*题?|组题[:：]?", stem):
                continue
            if "单元" in stem and len(stem) <= 20 and not re.search(r"[？?（）()]", stem):
                continue

            opts = here_opts
            inherited = False
            if len(opts) < 2:
                if prev_options and len(prev_options) >= 2 and ridx - prev_at <= 4:
                    opts = list(prev_options)
                    inherited = True
                    stats["inherit"] += 1
                else:
                    stats["no_opt"] += 1
                    continue
            ans = parse_answer(get(r, "a"), len(opts))
            if not ans:
                stats["no_answer"] += 1
                continue
            qtype = "多选题" if len(ans) > 1 else "单选题"
            if "判断" in t_raw:
                qtype = "判断题"
                opts = ["正确", "错误"]
                ans = ["正确" if ans[0] in ("正确", "A") else "错误"]
            tag = k_text if not re.search(r"型题|组题|单元", k_text) else ""
            recs.append({
                "stem": stem, "options": opts, "answer": ans, "type": qtype,
                "difficulty": DIFFS.get(clean(get(r, "d")), 3),
                "explain": clean(get(r, "e")), "tag": tag,
                "unit": cur_unit, "src": os.path.splitext(name)[0].strip(),
                "file": name, "inherited": inherited,
            })
            prev_options = opts
            prev_at = ridx
    return recs


def answer_text(r):
    out = []
    for a in r["answer"]:
        if a in ("正确", "错误"):
            out.append(a)
        else:
            i = ord(a) - 65
            if 0 <= i < len(r["options"]):
                out.append(r["options"][i])
    return norm_key("|".join(out))


def build(src):
    files = sorted(f for f in os.listdir(src) if f.lower().endswith((".xls", ".xlsx")))
    raw = []
    for f in files:
        s = collections.Counter()
        raw.extend(extract(os.path.join(src, f), f, s))

    # 继承串味修正
    by_stem = collections.defaultdict(list)
    for r in raw:
        by_stem[norm_key(r["stem"])].append(r)
    kept = []
    for stem, rs in by_stem.items():
        solid = {answer_text(r) for r in rs if not r["inherited"]}
        for r in rs:
            if r["inherited"] and len(solid) == 1 and answer_text(r) not in solid:
                continue
            kept.append(r)

    groups = collections.OrderedDict()
    for r in kept:
        groups.setdefault((norm_key(r["stem"]), answer_text(r)), []).append(r)

    def score(r):
        s = 0.0
        s += min(len(r["options"]), 6) * 10
        s += 20 if r["unit"] else 0
        s += 6 if "大功告成" not in r["file"] else 0
        s += 4 if not r["inherited"] else 0
        s += 1 if r["tag"] else 0
        s += len(r["stem"]) / 300.0
        return s

    merged = []
    for (k, a), rs in groups.items():
        best = max(rs, key=score)
        merged.append({k2: best[k2] for k2 in
                       ("stem", "options", "answer", "type", "difficulty", "tag", "unit")})
    return raw, merged


def fix_option(t):
    t = t.strip()
    m = re.match(r"^([A-H])\s*[\.．、,，)）:：]\s*", t)
    if m:
        t = t[m.end():]
    return t.strip(" .．、,，;；:：")


def clean_record(r):
    opts, ans, mapping = [], [], {}
    for i, o in enumerate(r["options"]):
        o = fix_option(o)
        if not o:
            continue
        key = norm_key(o)
        if key in mapping:
            mapping[chr(65 + i)] = mapping[key]
            continue
        mapping[key] = chr(65 + len(opts))
        mapping[chr(65 + i)] = chr(65 + len(opts))
        opts.append(o)
    for a in r["answer"]:
        if a in ("正确", "错误"):
            ans.append(a)
        elif a in mapping and mapping[a] not in ans:
            ans.append(mapping[a])
    if len(opts) < 2 or not ans:
        return None
    r = dict(r)
    r["options"] = opts
    r["answer"] = sorted(ans)
    return r


# ---------------- 药物知识挖掘 ----------------
# 题库没有解析字段，但「X的功效是」「具有Y功效的药物是」这类题的正确答案
# 本身就构成了一份「药 -> 功效/主治」对照表，从数据里反推出来用于作答后的标注。
DRUG_RX = r"[\u4e00-\u9fa5]{2,5}"
TAIL_RX = re.compile(r"(?:具有|善于|善|能|既|可|尤|最|长于|均)$")
RE_EFF = re.compile("^(" + DRUG_RX + r")(?:具有|善于|善|能|既|可|尤|最|长于|均)?的(?:功效|功用|功能|功效与主治|功效及主治)是")
RE_IND = re.compile("^(" + DRUG_RX + r")(?:具有|善于|善|能|既|可|尤|最|长于|均)?的(?:主治|主治病证|主治证候|主治病症|临床应用|适应证|适应症)是")
RE_TREAT = re.compile("^(" + DRUG_RX + r")长于治疗")
RE_MOST = re.compile("^(" + DRUG_RX + r")(?:尤|最)善")
RE_HAS = re.compile(r"^(?:均|都)?具有(.{2,40}?)(?:功效|作用)的药物(?:组)?是")
RE_PICK = re.compile(r"^治疗(.{3,50}?)(?:者|的人)?(?:，|,)?(?:用药)?(?:应|宜|首|当|最|均|可)?(?:选用|首选|最佳)?(?:的)?药物(?:组)?是")
BAD_NAMES = {"下列", "各项", "以下", "上述", "本药", "该药", "此药", "治疗", "患者",
             "具有", "能够", "功能", "作用", "主治", "均", "都", "两", "一组"}
NOT_DRUG = re.compile(r"(功效|作用|主治|药物|病证|证候|下列|各项|以下)")


def _drug_tokens(s):
    return [t for t in re.split(r"[、，,/／]|和|与", s) if t]


# 题库里的错字/异体写法，统一到规范药名
ALIAS = {"射千": "射干", "防已": "防己", "瓜萎": "瓜蒌", "川棟子": "川楝子",
         "琋莶草": "豨莶草", "稀莶草": "豨莶草", "茎叶": "艾叶", "芬香化湿药": "",
         "芳香化湿药": ""}
# 明显不是药名的条目
JUNK_RX = re.compile(r"(药$|药物|用$|生用|炒用|药组)")


def mine_drugs(questions):
    freq = collections.Counter()
    for q in questions:
        for ch in q["q"] + "".join(q["o"]):
            if "\u4e00" <= ch <= "\u9fa5":
                freq[ch] += 1
    total = sum(freq.values()) or 1

    def readability(s):
        chars = [c for c in s if "\u4e00" <= c <= "\u9fa5"]
        if not chars:
            return -99.0
        return sum(math.log((freq[c] + 1) / total) for c in chars) / len(chars)

    eff, ind = collections.defaultdict(list), collections.defaultdict(list)
    partial = collections.defaultdict(set)   # 来自「具有…功效的药物是」，只是部分功效

    def add(bucket, drug, stmt, from_has=False):
        drug = TAIL_RX.sub("", drug.strip("·"))
        drug = ALIAS.get(drug, drug)
        if not drug or not (2 <= len(drug) <= 5) or drug in BAD_NAMES:
            return
        if NOT_DRUG.search(drug) or JUNK_RX.search(drug):
            return
        stmt = re.sub(r"\s+", "", stmt).strip("。．.")
        if stmt.endswith("用药"):
            stmt = re.sub(r"[，,]?用药$", "", stmt)
        if 2 <= len(stmt) <= 40:
            bucket[drug].append(stmt)
            if from_has and bucket is eff:
                partial[drug].add(stmt)

    for q in questions:
        stem = q["q"].strip()
        ai = ord(q["a"][0]) - 65
        if ai >= len(q["o"]):
            continue
        ans = q["o"][ai].strip()
        if not ans or len(ans) > 50:
            continue
        for rx, bucket in ((RE_EFF, eff), (RE_IND, ind), (RE_TREAT, ind), (RE_MOST, ind)):
            m = rx.match(stem)
            if m:
                add(bucket, m.group(1), ans)
                break
        m = RE_HAS.match(stem)
        if m:
            for t in _drug_tokens(ans):
                add(eff, t, m.group(1), from_has=True)
            continue
        m = RE_PICK.match(stem)
        if m:
            # 「治疗<证候>…的药物是」：答案为药名时，证候就是它的主治
            for t in _drug_tokens(ans):
                if len(t) <= 4 and not re.search(r"[配合加及或]", t):
                    add(ind, t, m.group(1))

    def best(lst):
        if not lst:
            return None
        c = collections.Counter(lst)
        return max(c.items(), key=lambda kv: (round(readability(kv[0]), 2), kv[1], len(kv[0])))[0]

    drugs = {}
    for d in set(eff) | set(ind):
        e, i = best(eff.get(d, [])), best(ind.get(d, []))
        if e or i:
            # 第三位标记：功效是否只是「具有…功效的药物是」里的片段，前端会补「等」
            drugs[d] = [e, i, 1 if (e and e in partial.get(d, ())) else 0]
    return dict(sorted(drugs.items()))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--src", required=True, help="Excel 题库所在目录")
    ap.add_argument("--out", default="assets/data.js", help="输出文件")
    args = ap.parse_args()

    raw, merged = build(args.src)
    out, seen = [], set()
    for r in merged:
        c = clean_record(r)
        if not c:
            continue
        key = (norm_key(c["stem"]),
               norm_key("|".join(c["options"][ord(a) - 65] for a in c["answer"] if a not in ("正确", "错误"))))
        if key in seen:
            continue
        seen.add(key)
        out.append(c)

    out.sort(key=lambda r: (r["unit"] is None, r["unit"] or 999))
    questions = [{
        "id": i, "q": r["stem"], "o": r["options"], "a": r["answer"],
        "t": r["type"], "u": r["unit"] or 0, "d": r["difficulty"], "k": r["tag"] or "",
    } for i, r in enumerate(out, 1)]

    cnt = collections.Counter(q["u"] for q in questions)
    units = [{"id": u, "name": UNIT_NAMES[u], "count": cnt[u], "desc": UNIT_DESC.get(u, "")}
             for u in sorted(cnt) if u]
    if cnt[0]:
        units.append({"id": 0, "name": UNIT_NAMES[0], "count": cnt[0], "desc": "跨章节混合题"})

    data = {"version": 1, "total": len(questions), "units": units,
            "questions": questions, "drugs": mine_drugs(questions)}
    js = "window.QB=" + json.dumps(data, ensure_ascii=False, separators=(",", ":")) + ";"
    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    with open(args.out, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(js)
    print("源表 %d 个，原始行 %d，去重后 %d 题 -> %s" % (len(os.listdir(args.src)), len(raw), len(questions), args.out))


if __name__ == "__main__":
    main()
