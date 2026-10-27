# Inner agent details

`agent.mjs --help` lists every option, the model order and the safety notes. It leaves out these:

- Defaults: reasoning `low`, 40 steps, 5 minutes, $0.25 cap. `--hard` raises them to `xhigh`, 80 steps, 15 minutes, $2.
- Without `--attach` or `--profile-dir`, each run starts a fresh isolated headless Chrome (about 5 seconds) and closes it on exit.
- `status=completed` means the answer fits the schema, not that it is correct.
- Credentials come from pi's `~/.pi/agent/auth.json`. Without pi, set `OPENAI_API_KEY` or `OPENROUTER_API_KEY`.
- The SDK is `@browser_use/pi`, pinned in `scripts/package.json`. Its telemetry is off.
