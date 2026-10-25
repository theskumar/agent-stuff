# Fueled services for video

Keys live in the macOS keychain: `security find-generic-password -a "$USER" -s <item> -w`. Never print a key.

| Item | Use |
|---|---|
| `vercel-ai-gateway` | Gemini TTS, Gemini transcription |
| `elevenlabs` | music (the key needs **Music Generation: Access**; otherwise 401 `missing the permission music_generation`) |

The `gemini` item is not a Google API key, and gcloud Cloud TTS is disabled on the default projects. Use the gateway.

## Voice: `scripts/gateway_tts.py`

- Calls `POST https://ai-gateway.vercel.sh/v4/ai/speech-model` with model `google/gemini-3.8-flash-tts` and voice `Kore`. The OpenAI-style `/v1/audio/speech` returns 404. To find the route for another provider, read the `@ai-sdk/gateway` package (`npm pack`).
- Output is 24 kHz mono WAV, about 4 s per line. mp3 isn't offered. The script writes `durations.json`.
- There are no word timings, so captions go one per line, timed to the WAV.
- Pacing comes from the text and the `instructions` style prompt. A colon or dash makes a long pause. If a line sounds slow or "stretched", regenerate it without the punctuation and with "natural conversational pace, a little brisk, no pauses inside the sentence". Don't time-stretch the audio.
- It skips ids that already have a WAV. Delete a WAV to regenerate it, and back up the old one first.
- The free fallback is edge-tts (`scripts/tts.py`).

## Ear check: `scripts/hear.py`

- Transcribes each WAV with `google/gemini-3.5-flash` through `/v1/chat/completions`. Audio goes in as a `{"type":"file","file":{"file_data":"data:audio/wav;base64,…"}}` part; `input_audio` returns 400.
- Pass spellings that sound the same as `heard=written` (`rosie=rosey`).
- It caught "Rosey Remember" heard as "Rosin Remember" before a reviewer did. Read every DIFF.

## Music: `scripts/music_el.py`

- ElevenLabs `/v1/music` with `music_v2_5` and `force_instrumental: true`. It takes about 15 s per 155 s track.
- Make 2–3 variations from one prompt. Measure each one (integrated LUFS, loudness in the speech band, level over the last 8 s), and let the user choose by ear.
- Write the bed length into every build brief. A bed shorter than the cut forces tighter pauses or an extension.
- To extend a bed: fit a beat grid, find two bars that match (cross-correlation), repeat whole bars near the start with about 45 ms equal-gain crossfades (equal-power crossfades raise the level), and keep the seams off narration starts. Then offset the bed so its own ending lands on the last frame.
- Mix: voice-led content at about −16 LUFS integrated (slides, Slack, phone) or −14 (social), true peak below −1 dBTP, music about 20 dB under the voice while it speaks.

## Phone preview over Tailscale

1. Copy the video into a `phone/` folder with `-movflags +faststart`, and add an `index.html` with a `<video poster>` and a download link.
2. Run `node scripts/serve_preview.mjs <phone dir> 30177 /video`.
3. Run `tailscale serve --bg --set-path /video http://localhost:30177`. macOS Tailscale can't serve a folder directly. Leave pi-web on `/` as it is.
4. The link is `https://<host>.<tailnet>.ts.net/video/`. Add `?dl=1` to a file URL to download it to Files, then share it to Slack.
5. You can't test the link from the same Mac. When you're done, run `tailscale serve --set-path /video off` and stop the server.

## Reading the brief and the reviews

- Meeting notes: Wispr Flow MCP `search_meetings`, then `get_meeting` with `view_transcript` (paginated).
- Slack threads: `slack` skill script, `slack.mjs thread <channel> <ts>` or `catchup <url>`. Subagents can't open Slack links, so paste the text into the brief.
