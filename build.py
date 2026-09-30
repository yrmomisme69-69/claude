#!/usr/bin/env python3
"""Build the PRISM site.

The source is written once in Traditional Chinese (matching the proposal)
under site-src/. This script inlines the CSS and JavaScript into a single
HTML file per language and generates the Simplified Chinese version with
OpenCC:

    docs/index.html        Simplified Chinese (default)
    docs/hant/index.html   Traditional Chinese

Usage:
    pip install -r requirements.txt
    python3 build.py
"""

from pathlib import Path

from opencc import OpenCC

ROOT = Path(__file__).resolve().parent
SRC = ROOT / "site-src"
OUT = ROOT / "docs"

# Character conversion alone leaves some Hong Kong wording; these are the
# usual mainland terms for the same thing. Applied only to the Simplified
# output, longest phrases first.
SIMPLIFIED_TERMS = [
    ("为甚么", "为什么"),
    ("甚么", "什么"),
    ("汇出", "导出"),
    ("汇入", "导入"),
    ("档案", "文件"),
    ("程式", "程序"),
    ("记忆体", "内存"),
    ("重新整理", "刷新"),
    ("栏位", "字段"),
    ("介面", "界面"),
    ("支援", "支持"),
    ("覆核", "复核"),
    ("卷动", "滚动"),
    ("帐", "账"),
]

LANGUAGES = {
    "hans": {
        "path": OUT / "index.html",
        "LANG_TAG": "zh-Hans",
        "ALT_HREF": "hant/index.html",
        "ALT_LANG_TAG": "zh-Hant",
        "ALT_LANG_KEY": "hant",
        "ALT_LABEL": "繁體",
    },
    "hant": {
        "path": OUT / "hant" / "index.html",
        "LANG_TAG": "zh-Hant",
        "ALT_HREF": "../index.html",
        "ALT_LANG_TAG": "zh-Hans",
        "ALT_LANG_KEY": "hans",
        "ALT_LABEL": "简体",
    },
}


def indent(text, spaces):
    pad = " " * spaces
    return "\n".join(pad + line if line.strip() else "" for line in text.splitlines())


def assemble():
    page = (SRC / "page.html").read_text(encoding="utf-8")
    style = (SRC / "style.css").read_text(encoding="utf-8")
    script = (SRC / "app.js").read_text(encoding="utf-8")

    for token, value in (("{{STYLE}}", indent(style, 4)), ("{{SCRIPT}}", indent(script, 4))):
        if page.count(token) != 1:
            raise SystemExit(f"page.html must contain {token} exactly once")
        page = page.replace(token, value)

    return page


def to_simplified(text):
    text = OpenCC("hk2s").convert(text)
    for old, new in SIMPLIFIED_TERMS:
        text = text.replace(old, new)
    return text


def render(source, key):
    settings = LANGUAGES[key]
    html = to_simplified(source) if key == "hans" else source
    html = html.replace("{{LANG_KEY}}", key)

    for name, value in settings.items():
        if name != "path":
            html = html.replace("{{" + name + "}}", value)

    if "{{" in html and "}}" in html.split("{{", 1)[1]:
        leftover = html.split("{{", 1)[1].split("}}", 1)[0]
        raise SystemExit(f"unreplaced token: {{{{{leftover}}}}}")

    return html


def main():
    source = assemble()

    for key, settings in LANGUAGES.items():
        path = settings["path"]
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(render(source, key), encoding="utf-8")
        print(f"wrote {path.relative_to(ROOT)} ({path.stat().st_size // 1024} KB)")

    (OUT / ".nojekyll").touch()


if __name__ == "__main__":
    main()
