#!/bin/sh
# same-body.sh <adr-path>: exit 0 when the ADR's text, ignoring status/supersede/deprecate lines, blank lines and blockquote notes, matches the fixture original.
f=$1; o=.git/eval/$(basename "$f")
flt() { grep -viE 'status|supersed|superced|deprecat|replaced|^\s*$|^>|^[[:space:]*_]*(accepted|proposed|rejected)' "$1" | sed 's/[[:space:]]*$//'; }
[ -f "$f" ] && [ -f "$o" ] && [ "$(flt "$f")" = "$(flt "$o")" ]
