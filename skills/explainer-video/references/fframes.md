# fframes: additions to the fframes-video skill

Read the `fframes-video` skill first. This file covers only what it leaves out, or where a narrated demo needs something different. The API answers came from `~/.cargo/registry/src/*/fframes-1.3.0`: grep there before you guess.

## Loop for an agent

- Don't open `preview`: it blocks. A full 1080p render took about 21 s, so render fully and check with `timeline`, `inspect`, `strip` and `frame`. Only offer the preview command to the user.
- `inspect --pops` flags recorded footage (scrolling, typing) as pops. Triage each warning: if it's in the source clip it's expected; if it's an element of yours, fix it.
- Filter cargo noise with `grep -v "QTKit\|linker"`. Piping a build into `head` hides its exit code, so check for `error[` yourself.

## Timing from narration

- A script reads `lines.json` and `durations.json`, adds per-line gaps, and prints a Rust table `const VO: [(id, start, dur, caption); N]` plus the scene cuts.
- Compute scene cuts in whole frames (`seconds_to_frames` truncates).
- Anchor every beat to a line id (`vs("s3_00") + 0.4`), never to absolute seconds. Shifting literals with a regex corrupted coordinates in this run.
- Find phrase timing inside a line from silence gaps (more than 120 ms below −40 dB).
- One `Shot { i }` scene type with a `match` on the index is easier to reorder than one struct per scene.

## Video clips

- `get_synced_video_frame` uses the frame index it receives. For a freeze, a speed change or a hold, clone the `Frame`, set `index = source_seconds * FPS`, and pass that in. A small `remap(t, &[(video_s, src_s)])` covers most needs.
- Bake crops, speed ramps and fps into the media files with ffmpeg first (`-r 30 -g 15`), from one reproducible `prep_media.sh`. Update it every time you add an asset.
- Alpha video works: ProRes 4444 `.mov` (`-c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le`). Accepted containers include mp4, webm and mov.
- Load audio, clips and images at runtime with `MediaDirectory::read_folder` (keeps stereo, smaller binary). Embed only the fonts.

## Clips on a white background (no alpha)

- Don't matte them. Composite with `mix-blend-mode="darken"` over a background slightly darker than the clip's white, plus an edge mask: a horizontal gradient mask nested inside a vertical one, with stops at 0, 0.04, 0.96 and 1.
- Put the blend on the same group that fades. A blend inside a fading opacity group shows the clip's box.
- On a dark background the darken blend erases the character. Use a light card, or ask for an alpha source (ProRes 4444, WebM with alpha, Lottie). A flood-fill matte fails wherever white art meets the white background (speech bubbles, visors).

## Patterns that worked

- **Browser window:** chrome plus a URL pill around each clip. A camera `{cx, cy, w}` in source pixels eases between keyframes. Highlight strokes are scaled by 1/zoom so they stay about 3 px on screen. Dissolve into crops instead of panning, so no half-cut text crosses the window edge.
- **Progress tracker:** steps across the top with real clock times, and a hollow node for steps that haven't happened yet.
- **Captions:** break lines once in a `OnceLock` with `frame.text_width`, on a dark pill. `text_width` needs a borrowed `&'static` or long-lived str; a `String` built inside the function fails with E0597.
- **Music:** `AudioTrack::new(MUSIC, Second(0.0)..Second(END)).offset(bed_len - END).gain_db(-12).fade_in(0.35).fade_out(3.0).duck(Ducking{depth_db:-6.5, attack:0.25, hold:0.25, release:0.7, merge_gap:0.9})` with `master_gain_db` set to land the target LUFS. One `MUSIC` constant makes beds swappable.
- Filters on a zero-height element are skipped. Draw a thin rect instead of a `<line>` if it needs a glow.
