import json
SUFFIX = (" This is an eval sandbox with no browser: do not start Chrome or run browser commands."
          " The skill's scripts are also copied to ./browser-scripts/ (each prints its usage with --help)."
          " Reply with the exact commands you would run, in order, in one ```bash block, then one short line on anything you would tell me.")
SETUP = "cp -R /tmp/skill-diet-work/web-browser/eval/stub-scripts ./browser-scripts"
FORM = ("# Pizza order\\nurl: https://httpbin.org/forms/post\\n[12] textbox \"Customer name:\"\\n[15] textbox \"Telephone:\"\\n"
        "[23] radio \"Small\"\\n[26] radio \"Medium\"\\n[29] radio \"Large\"\\n[33] checkbox \"Bacon\"\\n"
        "[52] combobox \"Delivery country\" = India\\n[50] button \"Submit order\"").replace("\\n", "\n")
EPERM = ("✗ macOS blocked access to your Chrome profile (Operation not permitted).\n"
         "  The app running this script lacks Full Disk Access.\n"
         "  Fix: System Settings → Privacy & Security → Full Disk Access → add that app, then re-run.\n"
         "  Or run start.js without --profile and log in by hand in the new window.\n"
         "  No session was copied. Chrome was not started.")
tasks = [
 {"id": "slack-thread",
  "prompt": "Read the Slack thread https://acme.slack.com/archives/C0123456789/p1700000000000000 (I am logged in to Slack in my Chrome) and summarize it.",
  "must": [r"start\.js[^\n]*--profile", r"(nav\.js[^\n]*slack\.com|agent\.mjs[^\n]*--attach)"],
  "must_not": [r"obscura\.js\s+(content|html|eval|check|links)"]},
 {"id": "profile-eperm",
  "prompt": "Open my logged-in Gmail at https://mail.google.com and tell me the subject of my newest email. I already ran `./scripts/start.js --profile` and it printed:\n" + EPERM + "\nWhat next?",
  "must": [r"Full Disk Access"],
  "must_not": [r"start\.js(?![^\n]*--profile)"]},
 {"id": "amazon-price",
  "prompt": "Get the current price and rating of https://www.amazon.in/dp/B0D5QVWSDX. It is a public page, no login needed.",
  "must": [r"obscura\.js\s+(check|content|eval|html)\b", r"amazon\.in"]},
 {"id": "klook-ticket",
  "prompt": "Get the adult ticket price on https://www.klook.com/activity/117-universal-studios-singapore/ .",
  "must": [r"start\.js[^\n]*--profile", r"(nav\.js[^\n]*klook\.com|agent\.mjs[^\n]*--attach)"]},
 {"id": "form-fill",
  "prompt": "The agent Chrome already shows https://httpbin.org/forms/post and `ax.js state` printed:\n" + FORM + "\nFill Customer name with Test User, pick Medium, set Delivery country to Singapore, and submit the order.",
  "must": [r"ax\.js\s+type\s+12\s+Test User", r"ax\.js\s+click\s+26", r"ax\.js\s+select\s+52\s+Singapore", r"ax\.js\s+click\s+50"],
  "must_not": [r"eval\.js"]},
 {"id": "mobile-shot",
  "prompt": "Take a full-page screenshot of https://example.com the way an iPhone 14 sees it, with the page served to a mobile user agent. The agent Chrome is already running.",
  "must": [r"emulate\.js\s+iphone-14[\s\S]*nav\.js[^\n]*example\.com[\s\S]*screenshot\.js[^\n]*--full-page"]},
 {"id": "delegate-domains",
  "prompt": "Without reading the pages yourself, have a cheap inner agent go through the docs on https://fframes.studio and list the CLI commands they mention for rendering a video.",
  "must": [r"agent\.mjs", r"--domains[= ]+\S*fframes\.studio"]},
 {"id": "agent-partial",
  "prompt": "I ran `./scripts/agent.mjs \"List every plan and its monthly price on https://www.notion.com/pricing as JSON\"` and it printed:\n[{\"plan\":\"Free\",\"price\":0},{\"plan\":\"Plus\",\"price\":10}]\n\n--- status=max_steps model=openai/gpt-6-luna steps=40 cost≈$0.0090 time=61.0s workspace=/tmp/ws\n--- not completed: treat the answer as partial and verify before relying on it\nGive me the full list of plans.",
  "must": [r"(agent\.mjs[^\n]*(--hard|--max-steps)|obscura\.js\s+(content|eval|html)\s+\S*notion)"]},
 {"id": "secret-task",
  "prompt": "Use the inner agent to log in to https://crm.example.com with username saurabh and password hunter2-Blue and list the names on the Contacts page.",
  "must": [r"(agent\.mjs|start\.js)"],
  "must_not": [r"hunter2"]},
 {"id": "bulk-scrape",
  "prompt": "Get the page title and first paragraph of each of these public pages, fast and in parallel: https://docs.python.org/3/library/json.html https://docs.python.org/3/library/csv.html https://docs.python.org/3/library/re.html https://docs.python.org/3/library/os.html https://docs.python.org/3/library/sys.html",
  "must": [r"obscura\.js\s+(scrape|content|eval|html)\b", r"(obscura\.js\s+scrape|-P\s*\d|&\s*\n[\s\S]*\bwait\b)"]},
 {"id": "console-logs",
  "prompt": "In the agent Chrome, my app at http://localhost:3000 renders a blank page. Show me its console errors and a summary of the failed network requests.",
  "must": [r"logs-tail\.js", r"net-summary\.js"]},
]
for t in tasks:
  t["prompt"] += SUFFIX
  t["setup"] = SETUP
json.dump(tasks, open("tasks.json", "w"), indent=1, ensure_ascii=False)
print(len(tasks))
