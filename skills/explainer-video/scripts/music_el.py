#!/usr/bin/env python3
"""Background music via ElevenLabs Music. Usage: music_el.py out.mp3 seconds "prompt"  (max 600 s; generate >= video length + 10 s). Key: keychain 'elevenlabs' (never printed)."""
import json, os, subprocess, sys, urllib.request, urllib.error
out, secs, prompt = sys.argv[1], float(sys.argv[2]), sys.argv[3]
k = subprocess.check_output(["security", "find-generic-password", "-a", os.environ["USER"], "-s", "elevenlabs", "-w"], text=True).strip()
req = urllib.request.Request("https://api.elevenlabs.io/v1/music?output_format=mp3_44100_192", method="POST",
    data=json.dumps({"prompt": prompt, "music_length_ms": int(secs * 1000), "model_id": os.environ.get("EL_MODEL", "music_v2_5"), "force_instrumental": True}).encode(),
    headers={"xi-api-key": k, "Content-Type": "application/json"})
try:
    with urllib.request.urlopen(req, timeout=280) as r:
        open(out, "wb").write(r.read()); print("ok", out)
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read()[:600].decode(errors="replace")); sys.exit(1)
