#!/usr/bin/env bash
# Usage: mux.sh <workers> <out.mp4> [music.wav]
# Concats seg0..seg<workers-1>.mp4 + narration.wav (+ ducked music) + captions.srt. Never pass -shortest: the subtitle track ends early and would cut the video.
set -euo pipefail
W=$1; OUT=$2; MUSIC=${3:-}
: > segs.txt; for ((k=0;k<W;k++)); do echo "file 'seg$k.mp4'" >> segs.txt; done
AUD=narration.wav
if [ -n "$MUSIC" ]; then
  ffmpeg -y -v error -i narration.wav -i "$MUSIC" -filter_complex "[1:a]volume=0.16[m];[0:a]asplit=2[v][sc];[m][sc]sidechaincompress=threshold=0.02:ratio=6:attack=80:release=900[md];[v][md]amix=inputs=2:duration=first:normalize=0,alimiter=limit=0.95[a]" -map "[a]" mixed.wav
  AUD=mixed.wav
fi
ffmpeg -y -v error -f concat -safe 0 -i segs.txt -i $AUD -i captions.srt -map 0:v -map 1:a -map 2 -c:v copy -c:a aac -b:a 192k -c:s mov_text -metadata:s:s:0 language=eng -movflags +faststart "$OUT"
ffprobe -v error -show_entries stream=codec_type,duration -of csv=p=0 "$OUT"
ffmpeg -hide_banner -nostats -i "$OUT" -af ebur128 -f null - 2>&1 | grep -E "^ *(I|LRA):" || true  # aim voice-led mix near -19..-16 LUFS
