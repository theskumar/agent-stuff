#!/usr/bin/env bash
# Finish a render for sharing: poster from frame 0, embedded cover art, faststart, and checks.
# Usage: finish.sh <in.mp4> <out.mp4>   -> out.mp4, out-poster.jpg; prints streams, decode errors,
# QuickLook thumbnail path and an audio PCM hash (compare hashes to prove audio did not change between versions).
# Frame 0 must already be the finished title card: players, Slack and QuickLook show it before play.
set -euo pipefail
IN=$1; OUT=$2; P="${OUT%.mp4}-poster.jpg"
ffmpeg -v error -y -i "$IN" -map 0:v:0 -frames:v 1 -q:v 2 -pix_fmt yuvj420p "$P"
ffmpeg -v error -y -i "$IN" -i "$P" -map 0:v:0 -map 0:a? -map 1 -c copy -disposition:v:1 attached_pic -movflags +faststart "$OUT"
ffprobe -v error -show_entries stream=index,codec_name,width,height:stream_disposition=attached_pic -of csv=p=0 "$OUT"
echo "duration $(ffprobe -v error -show_entries format=duration -of csv=p=0 "$OUT")s"
E=$(ffmpeg -v error -i "$OUT" -map 0:v:0 -f null - 2>&1 | wc -l | tr -d ' '); echo "decode errors: $E"
echo "audio pcm md5: $(ffmpeg -v error -i "$OUT" -map 0:a:0 -f s16le - | md5 -q 2>/dev/null || true)"
Q=$(mktemp -d /tmp/ql-XXXX); qlmanage -t -s 512 -o "$Q" "$OUT" >/dev/null 2>&1 || true; echo "quicklook: $(ls "$Q"/*.png 2>/dev/null || echo none)"
