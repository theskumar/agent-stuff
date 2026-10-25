# HTML scenes pipeline

`beats.json` → TTS → `timeline.js` → HTML scenes keyed to sentences → Chrome frames → ffmpeg.

## Setup

- Work dir: copy `assets/template.html` → `index.html`, `assets/beats.example.json` → `beats.json`.
- `npm i playwright-core` in the work dir. It drives the installed Chrome (`channel: 'chrome'`) with no browser download.
- Run the scripts in `scripts/` from the work dir.
- `uvx`/`uv` may be missing from the agent shell PATH. Look in `~/.cargo/bin` and `~/.local/bin` before you decide it isn't installed.
- macOS ships bash 3.2, which has no `declare -A`. Loop over a TSV with `while IFS=$'\t' read`.

## Steps

1. Script: `beats.json` as `[[sceneId, [[beatId, "sentence(s)"], ...]], ...]`. One beat is about one idea.
2. Voice: `python3 scripts/tts.py` writes a per-beat mp3, `timeline.js`, `narration.wav` and `captions.srt` (env `VOICE`, `RATE`, `CAPFIX`). It uses free edge-tts voices. For Gemini voices, voice the beats with `gateway_tts.py` instead and keep the same timeline step.
3. Scenes: in `index.html`, cue elements with `data-in="beatId.sentenceIdx+0.4"` and mark scenes with `data-scene`.
4. Check: `node shot.mjs <t...>`, then `python3 scripts/sheet.py`, and view the contact sheet. Repeat until it's clean.
5. Render: `rm -f seg*.mp4; node render.mjs 4` (about 1/3 of realtime with 4–5 workers).
6. Music: `music_el.py`, or `uv run scripts/music.py` for a synthesized bed with no licensing.
7. Mux: `scripts/mux.sh 4 out.mp4 [music.wav]` adds the video, ducked music and soft captions, and prints a loudness readout.
8. Images (optional): `python3 scripts/imggen.py "prompt" out.png ref1.png,ref2.jpg 1024x1024`.
9. Captions: `capfix.json` (`[["slash review","/review"]]`) turns spoken forms back into written ones.

## Gotchas (verified)

- Never use `-shortest` in the mux: the subtitle track ends about 2 s early and cuts the video and audio to match.
- Stale `segN.mp4` files from a run with more workers get concatenated into the output. Delete `seg*.mp4` before every render.
- Use `display=block` for webfonts and await `document.fonts.ready`, or early frames render in the fallback font.
- An idle float animation needs `composite:'add'`, or it overrides the pop-in transform.
- `shot.mjs` prints `missing <cue>` warnings. After any script edit, check that every `data-in` cue still exists.
- Put images in a fixed box with `object-fit:contain`, so an asset swap with a new aspect ratio can't overflow cards.
- Keep exact wording in HTML, not in generated images, so text edits stay cheap and correct.

## Cheap rebuilds

- Text or timing change: rerun tts, then render and mux. Images stay as they are.
- Shorter cut: trim `beats.json`, delete the matching scenes, raise `RATE` a little, then rerun tts, render and mux.
- Asset swap with the same filenames: render only, then remux with the old audio: `ffmpeg -f concat -i segs.txt -i old.mp4 -map 0:v -map 1:a -map 1:s -c copy`.
- Music only: run `music.py` or `music_el.py`, then `mux.sh`. The frames are reused.

## Image generation

- `imggen.py` uses the Codex CLI login (`~/.codex/auth.json` via `codex login`). Other tools' OpenAI tokens can expire while Codex's is still valid.
- The endpoint is undocumented. If it breaks, fall back to the OpenAI Images API with an API key.
- For brand characters, pass the official art as reference images and say "keep the character identical; only add the prop".
- Ask for a transparent background with "no ground or drop shadow". A light floor shadow looks wrong on dark scenes.
- Generate in parallel, then compare all the results on one contact sheet before you use any.
- Brand assets: `fueled-branding` skill.
