# Capturing real product footage

## Browser

- Use the agent Chrome from the `web-browser` skill (`start.js`, CDP on :9222). On macOS, `--profile` fails when the agent's host app lacks Full Disk Access: rsync hits EPERM and start.js exits with a stack trace. Don't quietly relaunch without `--profile`. Tell the user, then either they grant access or you use the fresh profile (`~/.cache/agent-web/browser/fresh-profile`): open a tab titled "AGENT BROWSER: log in here", and have them log in **in that window**. The logins persist.
- Check each login yourself (page title, a private URL) before you plan around it.
- Target tabs by URL, never "the active tab": `node scripts/tab.mjs <url-substring> eval '<js>' | shot out.png [fullpage] | nav <url>`. The skill's eval.js and nav.js act on whichever tab happens to be first.
- After `nav`, the URL changes. Match on a part that survives, or the next `shot` finds no tab.

## Recording

- Pick one capture size for every clip (1600×1000 worked well in a 1920×1080 frame) and a theme. Sample the existing captures with ffmpeg `signalstats` (YAVG) and keep them all dark or all light.
- Scripted clips: `node scripts/rec.mjs <url-substring|new:URL> out.mp4 steps.json 1600 1000`. It uses a CDP screencast at a fixed viewport, draws its own cursor, and supports `nav, wait, type{sel,text,cps}, click, clickText, hover, moveTo, scroll{y,ms}, scrollToText, key`. In Figma, zoom with very small Ctrl+scroll steps; large steps zoom into an empty grid.
- Stills of every state are cheap insurance, so take them as well.
- Human recordings (someone merging a PR, with a webcam): `node scripts/vp.mjs <url-substring> 1600 1000` sizes the real window so the page is exactly that size. macOS tiling snaps the window back, so untile it or use another display. CleanShot saves to the Desktop by default, not to your folder.
- A local app whose API sends no CORS headers: put a small CORS proxy in front of the API for the capture, and only on localhost.

## What must not reach the screen

Crop, cut or speed past these, then prove it with `check/ocr_scan.sh` and `check/redbar.py`:

- names of people who aren't part of the story (CI "Started by" fields show the token owner, not who did the work);
- red "failed" statuses, warnings like "checks haven't completed", and other people's runs in shared tables;
- URL fragments at the crop edges, and the cursor inside design stills;
- secrets, tokens and private links.
