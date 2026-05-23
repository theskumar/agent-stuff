---
name: tmux
description: "Remote control tmux sessions for interactive CLIs (python, gdb, etc.) by sending keystrokes and scraping pane output."
---

Drive tmux programmatically. stock tmux.

## Mode selection

Check `$TMUX`:

- **Set** → reuse user's server. Make new **window** in current session. User reaches it with their own prefix.
- **Unset** → isolated socket under `CLAUDE_TMUX_SOCKET_DIR` (default `${TMPDIR:-/tmp}/claude-tmux-sockets`), socket `claude.sock`.

Detect prefix for user-facing instructions:

```bash
PREFIX=$(tmux show -gv prefix 2>/dev/null || echo 'C-b')
```

## Inside existing tmux

```bash
SESSION=$(tmux display-message -p '#{session_name}')
WIN=claude-dev
tmux new-window -t "$SESSION" -n "$WIN"
tmux send-keys -t "$SESSION:$WIN" -- 'python3 -q' Enter
tmux capture-pane -p -J -t "$SESSION:$WIN" -S -2000
```

Tell user:

```
Window "$WIN" in session "$SESSION". Switch: $PREFIX n  or  $PREFIX w
```

Cleanup: `tmux kill-window -t "$SESSION:$WIN"`.

## Isolated socket

```bash
SOCK_DIR=${CLAUDE_TMUX_SOCKET_DIR:-${TMPDIR:-/tmp}/claude-tmux-sockets}
mkdir -p "$SOCK_DIR"
SOCK="$SOCK_DIR/claude.sock"
SESSION=claude-py
tmux -S "$SOCK" new -d -s "$SESSION" -n shell
tmux -S "$SOCK" send-keys -t "$SESSION:shell" -- 'python3 -q' Enter
```

Print to user on start AND on tool-loop exit:

```
Monitor:  tmux -S $SOCK attach -t $SESSION
```

Cleanup: `tmux -S "$SOCK" kill-session -t "$SESSION"` (or `kill-server` for all).

## Targeting

- **Never hardcode `:0.0`**. `base-index` may be `1`. Target by window name: `$SESSION:$WIN`.
- Inside existing tmux: bare `tmux`. Isolated: always `-S "$SOCK"`.

## Send + capture

- Literal sends: `send-keys -t target -l -- "$cmd"` then `send-keys -t target Enter`.
- Capture depth: `-S -2000` default. Cap at `tmux show -gv history-limit`.

## Critical gotchas

- **Python REPL**: ALWAYS export `PYTHON_BASIC_REPL=1` before `python3 -q`. The new REPL breaks send-keys.
- **Debugger**: use `lldb` by default, not gdb (macOS-friendly).
- **gdb**: send `set pagination off` first.

## Waiting for prompts

`tmux wait-for` cannot watch pane content. Use the polling helper:

```bash
./scripts/wait-for-text.sh -t "$SESSION:$WIN" -p '^>>>' -T 15
# isolated mode: add  -S "$SOCK"
```

Poll for prompt before sending next input. For long commands, poll for completion text.

## Finding sessions

```bash
./scripts/find-sessions.sh -S "$SOCK"        # one socket
./scripts/find-sessions.sh --all             # all claude sockets
./scripts/find-sessions.sh --all -q partial  # filter by name
```

If user has `sesh`, they can pick sessions via their own binding.

## Helper scripts

- `scripts/wait-for-text.sh` — poll pane for regex/fixed string with timeout. `--help` for flags.
- `scripts/find-sessions.sh` — list sessions on one or all sockets. `--help` for flags.
