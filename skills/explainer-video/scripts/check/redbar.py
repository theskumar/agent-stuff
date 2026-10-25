# Flag frames that contain a wide red bar (a CI "failed" status, error banner) in a rendered video.
# Usage: python3 redbar.py video.mp4 [min_red_px_per_row=120]   (rows measured at 960x540)
import sys, subprocess, json, numpy as np
path = sys.argv[1]; MIN = int(sys.argv[2]) if len(sys.argv) > 2 else 120; W, H = 960, 540
fps = eval(subprocess.check_output(["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate", "-of", "csv=p=0", path], text=True).strip())
p = subprocess.Popen(["ffmpeg", "-v", "error", "-i", path, "-map", "0:v:0", "-vf", f"scale={W}:{H}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"], stdout=subprocess.PIPE)
i = 0; hits = []
while True:
    b = p.stdout.read(W * H * 3)
    if len(b) < W * H * 3: break
    f = np.frombuffer(b, np.uint8).reshape(H, W, 3).astype(int)
    rows = ((f[..., 0] > 160) & (f[..., 1] < 90) & (f[..., 2] < 100)).sum(1)
    if rows.max() > MIN: hits.append((round(i / fps, 2), int(rows.max())))
    i += 1
print("frames", i, "hits", len(hits), "first:", hits[:20])
