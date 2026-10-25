# Verifying a render without watching it

Run these before you show any version. Don't report a check you didn't run.

| Check | How |
|---|---|
| Layout and flow | pipeline contact sheets (fframes `strip`, HTML `sheet.py`), then full-size frames around every change |
| Hard cuts nobody asked for | `ffmpeg -i v.mp4 -vf "scale=480:-1,select='gt(scene,0.08)',metadata=print" -f null -`, then frames on either side of each hit |
| Banned words on screen | `scripts/check/ocr_scan.sh v.mp4 words.txt 1` (whole video), plus `3 <a>-<b>` on the changed range. It runs in parallel and OCRs the inverted image too, so white caption text is read |
| Error colours | `scripts/check/redbar.py v.mp4` |
| Captions match the script | compare the caption table with `lines.json` by script, line for line |
| Loudness | `ffmpeg -i v.mp4 -af ebur128=peak=true -f null -` (target in `services.md`) |
| Audio unchanged between versions | the PCM hash from `finish.sh`, or `ffmpeg -i v.mp4 -map 0:a:0 -f s16le - \| md5` |
| Frames unchanged outside the edit | numpy diff of rawvideo frames at chosen times. Expect a mean diff of about 0.2 next to changed frames (encoder noise) |
| Poster and thumbnail | `finish.sh` prints the streams, decode errors and a QuickLook thumbnail. Look at the thumbnail |

- Keep a known false-positive list for OCR (app text like "Copy failed", GitHub footers) so hits don't need re-triage every round.
- Measure positions on a frame with `scripts/check/grid.py frame.png out.png 50`.
- Judge small details on a sharp, full-size crop, never on a scaled-down sheet.
- Before you claim a check passed, read the output yourself, not the subagent's summary of it.
