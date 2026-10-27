import json
SUFFIX = (" This is an eval sandbox with no browser: do not start Chrome or run browser commands."
          " The skill's scripts are also copied to ./browser-scripts/ (each prints its usage with --help)."
          " Reply with the exact commands you would run, in order, in one ```bash block, then one short line on anything you would tell me.")
SETUP = "cp -R /tmp/skill-diet-work/web-browser/eval/stub-scripts ./browser-scripts"
tasks = [
 {"id": "eval-multi", "prompt": "In the agent Chrome, click the first button on the current page and return the page title afterwards, in a single eval.js call.",
  "must": [r"eval\.js[^\n]*click\(\)[^\n]*title"]},
 {"id": "chrome-profile", "prompt": "Open https://github.com/notifications logged in with my Chrome profile named Work, not my default profile.",
  "must": [r"--list-profiles", r"start\.js[^\n]*--profile[^\n]*--chrome-profile|start\.js[^\n]*--chrome-profile[^\n]*--profile"]},
 {"id": "cookies-reject", "prompt": "The agent Chrome shows https://www.bbc.com with a cookie consent banner. Reject non-essential cookies, then read the top headline.",
  "must": [r"dismiss-cookies\.js[^\n]*--reject"]},
 {"id": "obscura-proxy", "prompt": "Fetch the readable text of the public page https://example.com through my SOCKS5 proxy at 127.0.0.1:1080, with a 60 second timeout.",
  "must": [r"obscura\.js\s+content\s+\S*example\.com[^\n]*--proxy\s+socks5://127\.0\.0\.1:1080", r"obscura\.js[^\n]*--timeout\s+60"]},
 {"id": "live-chrome", "prompt": "Skip any profile copy: attach straight to my everyday Chrome window that is already open, and read the page I have there.",
  "must": [r"(can.?t|cannot|won.?t|doesn.?t|not)[^\n]{0,80}(attach|drive)[^\n]{0,60}(everyday|live|your|directly)"], "must_not": [r"remote-debugging-port", r"(eval|ax|nav|content)\.js"]},
 {"id": "custom-port", "prompt": "Port 9222 on this machine is taken by another app. Start the agent Chrome anyway and open https://example.com in it.",
  "must": [r"BROWSER_DEBUG_PORT=\d+", r"nav\.js[^\n]*example\.com"]},
]
for t in tasks:
  t["prompt"] += SUFFIX; t["setup"] = SETUP
json.dump(tasks, open("tasks.json", "w"), indent=1)
print(len(tasks))
