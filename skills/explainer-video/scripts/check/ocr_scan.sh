#!/usr/bin/env bash
# Scan a rendered video for words that must not appear on screen (names, "failed", retired product names).
# Usage: ocr_scan.sh <video.mp4> <words.txt> [fps=1] [range e.g. 80-95]
# words.txt: one case-insensitive phrase per line. Prints "<time>s <phrase> | <ocr line>" per hit.
# Runs tesseract in parallel; also OCRs an inverted copy so white-on-dark captions are read.
set -euo pipefail
V=$1; W=$2; FPS=${3:-1}; RANGE=${4:-}
D=$(mktemp -d /tmp/ocr-XXXX)
SS=(); [ -n "$RANGE" ] && SS=(-ss "${RANGE%-*}" -to "${RANGE#*-}")
ffmpeg -v error ${SS[@]+"${SS[@]}"} -i "$V" -map 0:v:0 -vf "fps=$FPS,scale=2880:-1" "$D/f%05d.png"
OFF=${RANGE%-*}; [ -z "$RANGE" ] && OFF=0
ls "$D"/f*.png | xargs -P "$(sysctl -n hw.ncpu 2>/dev/null || nproc)" -I{} sh -c '
  f={}; { tesseract "$f" - 2>/dev/null; magick "$f" -negate - 2>/dev/null | tesseract - - 2>/dev/null; } > "${f%.png}.txt"'
for t in "$D"/f*.txt; do
  n=$(basename "$t" .txt); n=$((10#${n#f})); sec=$(awk -v n="$n" -v f="$FPS" -v o="$OFF" 'BEGIN{printf "%.1f", o+(n-1)/f}')
  while IFS= read -r w; do [ -z "$w" ] && continue
    grep -i -F -- "$w" "$t" | head -1 | sed "s|^|${sec}s $w \| |" || true
  done < "$W"
done
echo "frames: $(ls "$D"/f*.png | wc -l | tr -d ' ')  (frames kept in $D)"
