#!/usr/bin/env python3
"""Narration via Vercel AI Gateway -> Google Gemini TTS.

Usage: python3 tts.py lines.json [out_dir]
lines.json: [{"id": "s01", "text": "...", "instructions": "optional style"}]
Writes <out_dir>/<id>.wav (24 kHz mono) and <out_dir>/durations.json.
Key: macOS keychain item 'vercel-ai-gateway' (never printed).
Env: TTS_MODEL (default google/gemini-3.8-flash-tts), TTS_VOICE (default Kore).
"""
import base64, json, os, subprocess, sys, urllib.request, wave

MODEL = os.environ.get("TTS_MODEL", "google/gemini-3.8-flash-tts")
VOICE = os.environ.get("TTS_VOICE", "Kore")
STYLE = "Warm, clear product-demo narrator. Confident, unhurried, lightly upbeat."
URL = "https://ai-gateway.vercel.sh/v4/ai/speech-model"


def key():
    return subprocess.check_output(
        ["security", "find-generic-password", "-a", os.environ["USER"], "-s", "vercel-ai-gateway", "-w"],
        text=True).strip()


def speak(k, text, instructions):
    req = urllib.request.Request(URL, method="POST", data=json.dumps({
        "text": text, "voice": VOICE, "outputFormat": "wav", "instructions": instructions,
    }).encode(), headers={
        "Authorization": f"Bearer {k}", "Content-Type": "application/json",
        "ai-gateway-protocol-version": "0.0.1", "ai-gateway-auth-method": "api-key",
        "ai-speech-model-specification-version": "4", "ai-model-id": MODEL,
    })
    with urllib.request.urlopen(req, timeout=120) as r:
        return base64.b64decode(json.load(r)["audio"])


def main():
    lines = json.load(open(sys.argv[1]))
    out = sys.argv[2] if len(sys.argv) > 2 else "audio"
    os.makedirs(out, exist_ok=True)
    k, durs = key(), {}
    for ln in lines:
        path = os.path.join(out, ln["id"] + ".wav")
        if not os.path.exists(path):
            open(path, "wb").write(speak(k, ln["text"], ln.get("instructions", STYLE)))
        with wave.open(path) as w:
            durs[ln["id"]] = round(w.getnframes() / w.getframerate(), 3)
        print(ln["id"], durs[ln["id"]], "s")
    json.dump(durs, open(os.path.join(out, "durations.json"), "w"), indent=1)


if __name__ == "__main__":
    main()

