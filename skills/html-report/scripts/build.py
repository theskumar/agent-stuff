#!/usr/bin/env python3
"""Assemble an html-report from the shared template and a body fragment.

Reads assets/template.html, fills the header placeholders, injects the body
fragment at <!-- BODY -->, drops unused optional CSS component blocks, and
validates the result. Stdlib only.

Usage:
  build.py --title T --thesis TH --body body.html --out report.html \\
           [--eyebrow E] [--subject S] [--lens L] [--projection P] \\
           [--template path] [--no-trim]

The body fragment is the content between the header and footer: a series of
<section>...</section> blocks using the component classes (verdict, pill,
data, finding, card/grid2, weights/track, diff, export, sources).
"""
from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

PLACEHOLDERS = ("TITLE", "EYEBROW", "THESIS", "SUBJECT", "LENS", "PROJECTION")
COMPONENT_RE = re.compile(r"/\*\s*@c:([^*]+?)\s*\*/(.*?)/\*\s*@/c\s*\*/", re.DOTALL)


def class_tokens(html: str) -> set[str]:
    """Every class token used in the body fragment."""
    tokens: set[str] = set()
    for attr in re.findall(r'class="([^"]*)"', html):
        tokens.update(attr.split())
    return tokens


def trim_css(template: str, body: str) -> tuple[str, list[str]]:
    """Drop optional component blocks whose trigger class is absent from body."""
    used = class_tokens(body)
    dropped: list[str] = []

    def repl(m: re.Match[str]) -> str:
        triggers = [t.strip() for t in m.group(1).split(",")]
        if any(t in used for t in triggers):
            return m.group(2)  # keep block, strip the markers
        dropped.append("/".join(triggers))
        return ""

    return COMPONENT_RE.sub(repl, template), dropped


def validate(html: str) -> list[str]:
    """Return a list of problems. Empty means the report is well formed."""
    problems: list[str] = []
    if not html.lstrip().startswith("<!DOCTYPE html>"):
        problems.append("missing <!DOCTYPE html>")
    if "{{" in html:
        problems.append("unfilled {{PLACEHOLDER}} remains")
    if "@c:" in html or "@/c" in html:
        problems.append("leftover CSS component marker")
    if "<img" in html:
        problems.append("<img src> present (assets must be inline)")
    if 'data-theme="auto"' not in html:
        problems.append('default data-theme="auto" missing')
    if "__setTheme" not in html:
        problems.append("theme script missing")
    for tag in ("section", "table", "svg", "div"):
        o = len(re.findall(rf"<{tag}[ >]", html))
        c = len(re.findall(rf"</{tag}>", html))
        if o != c:
            problems.append(f"unbalanced <{tag}>: {o} open / {c} close")
    return problems


def main() -> int:
    here = Path(__file__).resolve().parent
    ap = argparse.ArgumentParser()
    ap.add_argument("--title", required=True)
    ap.add_argument("--thesis", required=True)
    ap.add_argument("--body", required=True, help="path to body fragment HTML")
    ap.add_argument("--out", required=True)
    ap.add_argument("--eyebrow", default="")
    ap.add_argument("--subject", default="")
    ap.add_argument("--lens", default="")
    ap.add_argument("--projection", default="")
    ap.add_argument("--template", default=str(here.parent / "assets" / "template.html"))
    ap.add_argument("--no-trim", action="store_true", help="keep all component CSS")
    args = ap.parse_args()

    template = Path(args.template).read_text(encoding="utf-8")
    body = Path(args.body).read_text(encoding="utf-8")

    if not args.no_trim:
        template, dropped = trim_css(template, body)
        if dropped:
            print(f"trimmed unused CSS: {', '.join(dropped)}")

    html = template.replace("<!-- BODY -->", body)
    values = {
        "TITLE": args.title,
        "EYEBROW": args.eyebrow,
        "THESIS": args.thesis,
        "SUBJECT": args.subject,
        "LENS": args.lens,
        "PROJECTION": args.projection,
    }
    for key in PLACEHOLDERS:
        html = html.replace("{{" + key + "}}", values[key])

    problems = validate(html)
    if problems:
        print("VALIDATION FAILED:", file=sys.stderr)
        for p in problems:
            print(f"  - {p}", file=sys.stderr)
        return 1

    Path(args.out).write_text(html, encoding="utf-8")
    print(f"wrote {args.out} ({len(html.encode())} bytes) — validation passed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
