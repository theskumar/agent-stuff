#!/usr/bin/env python3
"""Check TTS clips by ear proxy: transcribe each WAV with Gemini (Vercel AI Gateway) and diff against the script.
Usage: python3 hear.py lines.json wav_dir [id ...] [heard=written ...]   e.g. rosie=rosey
lines.json: [{"id", "text"}]. Prints OK or the transcript for every mismatch. Read the transcripts of
names and product terms yourself: a model can "correct" a mispronounced name back to the right spelling.
Key: keychain item 'vercel-ai-gateway' (never printed)."""
import base64, json, os, re, subprocess, sys, urllib.request, urllib.error
from concurrent.futures import ThreadPoolExecutor
URL = "https://ai-gateway.vercel.sh/v1/chat/completions"
MODEL = os.environ.get("HEAR_MODEL", "google/gemini-3.5-flash")
PROMPT = ("Transcribe this audio phonetically, exactly as heard. Do not correct names or product terms to known words; "
          "spell them the way they sound. Reply with the transcript only.")
k = subprocess.check_output(["security", "find-generic-password", "-a", os.environ["USER"], "-s", "vercel-ai-gateway", "-w"], text=True).strip()
lines, wav_dir = json.load(open(sys.argv[1])), sys.argv[2]
only = {a for a in sys.argv[3:] if "=" not in a}
same = dict(a.lower().split("=", 1) for a in sys.argv[3:] if "=" in a)
norm = lambda s: [same.get(w, w) for w in re.sub(r"[^a-z0-9 ]+", " ", s.lower().replace("'", "")).split()]

def hear(ln):
    f = os.path.join(wav_dir, ln["id"] + ".wav")
    b64 = base64.b64encode(open(f, "rb").read()).decode()
    body = {"model": MODEL, "messages": [{"role": "user", "content": [{"type": "text", "text": PROMPT},
            {"type": "file", "file": {"file_data": "data:audio/wav;base64," + b64, "filename": os.path.basename(f)}}]}]}
    req = urllib.request.Request(URL, data=json.dumps(body).encode(), headers={"Authorization": "Bearer " + k, "Content-Type": "application/json"})
    try:
        heard = json.load(urllib.request.urlopen(req, timeout=90))["choices"][0]["message"]["content"].strip()
    except urllib.error.HTTPError as e:
        return ln["id"], "HTTP %s %s" % (e.code, e.read()[:200])
    return ln["id"], "OK" if norm(heard) == norm(ln["text"]) else "DIFF heard: " + heard

todo = [l for l in lines if not only or l["id"] in only]
with ThreadPoolExecutor(6) as ex:
    for i, res in ex.map(hear, todo): print(i, res)
