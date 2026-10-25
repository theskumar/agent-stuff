---
disable-model-invocation: true
name: explainer-video
description: Make a short narrated explainer or product-demo video (voiceover, captions, scenes or real screen recordings, music) in the Fueled setup. Use when asked for an "explainer video", "demo video", "video walkthrough", "turn this doc into a video", or a new cut, fix or asset swap of an existing one.
---

# Explainer video

Two build pipelines share one workflow:

- **HTML scenes** (doc, RFC or process explainer; diagrams and characters): `references/html-pipeline.md`.
- **fframes** (product demo built from real screen recordings, camera moves, composited clips): the `fframes-video` skill, then `references/fframes.md` for what that skill leaves out.

Project notes come first. Before you write the script, read the project repo's `.context/` notes on demos and videos. For Rosey, read `.context/demo-videos.md` in `Fueled/rosey`; the local clone is usually `~/work/fueled/rosey`. Those notes hold names and internal setup, so keep them in the private repo, not in this skill.

## Workflow

1. **Brief.** Pin down the audience, the venue (deck slide, Slack, phone, full screen), the length, and the one thing to remember. Ask what is live today. Show only what exists.
2. **Script.** Write `narration/lines.json` as `[{id, text, caption}]`: `text` is spoken, `caption` is shown. Get the user's approval before you voice it.
3. **Voice.** `scripts/gateway_tts.py lines.json narration/wav`. Then run `scripts/hear.py lines.json narration/wav` and read every DIFF. Details: `references/services.md`.
4. **Capture** real product footage at one fixed viewport: `references/capture.md`.
5. **Music.** `scripts/music_el.py`, generated at least 10 s longer than the cut. Let the user pick a bed by ear.
6. **Build** in the chosen pipeline. Drive every time from the narration durations, never from hand-typed seconds.
7. **Verify** with `references/verify.md` before you show anything.
8. **Finish.** `scripts/finish.sh in.mp4 out.mp4` adds the poster, cover art, faststart and checks. To preview on a phone, see `references/services.md`.

## Content

- Follow one concrete example end to end. Real events and real numbers only. Keep an allowed-facts list and check every line against it.
- Open on the outcome the audience cares about (design next to the shipped result), not on a defect being fixed.
- People decide and the agent does the work. Show the human checkpoints (spec review, code review, merge, QA), and don't claim "nobody touched it".
- Don't simulate features that aren't live, even with a "Simulated" tag. Name them in the talk, not in the video.
- No discipline role labels ("Designer", "PM"). Label activities ("Reviewers", "tech lead") if you need labels at all.
- If the video sits in a deck or page, frame 0 must be a finished title card in the host's look (light deck: light card). Players and Slack show frame 0 until you press play.
- Hold before-and-after beats long enough to read: about 4 s or more for a side by side.
- Write narration for the ear: no colons or dashes inside a sentence (TTS pauses there), "slash review" not `/review`, and spell out acronyms on first use.
- Mark drafts on screen ("Draft · details still open").
- Close with one action, and say the video goes with the doc or talk, not instead of it.

## Working rules

- Never overwrite a version. Write `out/<name>-vN.mp4`, and back up the source and narration per version (`_work/src_vN`, `narration/vN/`). The user may rename or move outputs, so check before you write.
- You cannot watch or hear the output. Check frames and numbers yourself, then ask the user to watch and listen, and name what to listen for.
- Read an image only after the command that writes it has returned. Never put the `read` in the same parallel batch as its writer. Both runs here lost about 10 minutes to that race.
- Before you choose a technique for a reused asset, check how its source shows it (the page CSS, the original file format). The meetrosey.ai clips needed a CSS blend, not a matte.
- When you delegate a build, state outcomes and limits, not the technique: length caps (the music length), banned on-screen words, allowed facts, what must stay unchanged, a time budget with a STOP condition, and a backup step. Check the frames it reports before you pass them on.
- When the user is out of time, keep the last good version as the fallback. Change one thing per version.

## Report back

Give the path, duration and size, plus what changed since the last version, what you checked, and what the user must check by ear or eye.
