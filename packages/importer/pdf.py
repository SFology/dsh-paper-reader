#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""pdf.py — 用 PyMuPDF 抽取 PDF 文本，输出 JSON 到 stdout。

用法：python pdf.py <file.pdf>
输出：{"pages": [{"no": 1, "text": "..."}], "meta": {"title"?, "author"?}}

设计：
  - 按文本块的 y 坐标排序（同 y 再按 x）；
  - 去掉跨页重复的短行（出现率 > 60% 的页眉/页脚）和顶部/底部的页码行；
  - 合并行尾 '-' 断词；中文相邻不加空格；
  - 失败时通过 stderr 说明原因并返回非 0 退出码。
"""
import json
import re
import sys

try:
    import pymupdf as fitz  # PyMuPDF >= 1.24
except ImportError:
    try:
        import fitz  # 旧版本
    except ImportError:
        sys.stderr.write("未找到 PyMuPDF，请安装：pip install pymupdf\n")
        sys.exit(3)

SHORT_LINE_MAX = 100
REPEAT_RATIO = 0.6

CJK_RE = re.compile(r"[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]")
LOWER_RE = re.compile(r"^[a-z]")
PAGE_NO_RE = re.compile(r"^(?:page\s*)?[-–—]?\s*\d{1,4}\s*[-–—]?$", re.IGNORECASE)


def die(msg, code=1):
    sys.stderr.write(str(msg) + "\n")
    sys.exit(code)


def norm_for_repeat(s):
    """重复行判定用的归一化：数字统一成 #，空白压平，转小写。"""
    s = re.sub(r"\d+", "#", s)
    s = re.sub(r"\s+", " ", s).strip().lower()
    return s


def join_lines(lines):
    """合并块内物理行：行尾断词拼接、中文不加空格。"""
    out = ""
    for raw in lines:
        line = raw.strip()
        if not line:
            continue
        if not out:
            out = line
            continue
        if out.endswith("-") and LOWER_RE.match(line):
            out = out[:-1] + line
        elif CJK_RE.search(out[-1]) or CJK_RE.search(line[0]):
            out += line
        else:
            out += " " + line
    return out


def block_text(block):
    text = block[4] if len(block) > 4 else ""
    return join_lines(str(text).splitlines())


def join_pair(left, right):
    if CJK_RE.search(left[-1]) or CJK_RE.search(right[0]):
        return left + right
    return left + " " + right


def merge_soft_blocks(blocks):
    """同一页内合并被 PDF 拆成「单个物理行块」的续行：行尾断词 + 无句末标点的续行。"""
    out = []
    for raw in blocks:
        text = raw.strip()
        if not text:
            continue
        if out:
            prev = out[-1]
            if prev.endswith("-") and LOWER_RE.match(text):
                out[-1] = prev[:-1] + text
                continue
            if not re.search(r"[.!?。！？:：;；]\s*$", prev) and (
                LOWER_RE.match(text) or CJK_RE.search(text[0])
            ):
                out[-1] = join_pair(prev, text)
                continue
        out.append(text)
    return out


def main():
    if len(sys.argv) < 2:
        die("用法：python pdf.py <file.pdf>", 2)
    path = sys.argv[1]
    try:
        doc = fitz.open(path)
    except Exception as exc:  # noqa: BLE001 - 交给调用方展示
        die("无法打开 PDF：%s" % exc, 2)
    if doc.needs_pass:
        die("PDF 已加密，请先解密后再导入", 4)

    raw_pages = []
    for pno in range(doc.page_count):
        page = doc.load_page(pno)
        try:
            blocks = page.get_text("blocks")
        except Exception:  # noqa: BLE001
            blocks = []
        height = page.rect.height or 1.0
        items = []
        for block in blocks:
            # (x0, y0, x1, y1, text, block_no, block_type)；block_type 0 = 文本
            if len(block) < 7 or block[6] != 0:
                continue
            text = block_text(block)
            if not text.strip():
                continue
            items.append({
                "y0": float(block[1]),
                "x0": float(block[0]),
                "text": text,
                "top": float(block[1]) < height * 0.12,
                "bottom": float(block[3]) > height * 0.88,
            })
        items.sort(key=lambda it: (round(it["y0"], 1), it["x0"]))
        raw_pages.append(items)

    total = len(raw_pages)
    # 跨页重复短行（页眉/页脚）
    counter = {}
    for items in raw_pages:
        seen = set()
        for it in items:
            t = it["text"]
            if "\n" in t or len(t) > SHORT_LINE_MAX:
                continue
            key = norm_for_repeat(t)
            if not key or key in seen:
                continue
            seen.add(key)
            counter[key] = counter.get(key, 0) + 1
    repeated = {k for k, v in counter.items() if total and v / float(total) > REPEAT_RATIO}

    pages = []
    for idx, items in enumerate(raw_pages, start=1):
        kept = []
        for it in items:
            t = it["text"]
            if "\n" not in t and len(t) <= SHORT_LINE_MAX:
                if norm_for_repeat(t) in repeated:
                    continue
                if (it["top"] or it["bottom"]) and PAGE_NO_RE.match(t.strip()):
                    continue
            kept.append(t)
        pages.append({"no": idx, "text": "\n\n".join(merge_soft_blocks(kept)).strip()})

    meta = {}
    md = doc.metadata or {}
    title = (md.get("title") or "").strip()
    author = (md.get("author") or "").strip()
    if title:
        meta["title"] = title
    if author:
        meta["author"] = author
    doc.close()

    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:  # noqa: BLE001
        pass
    sys.stdout.write(json.dumps({"pages": pages, "meta": meta}, ensure_ascii=False))
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
