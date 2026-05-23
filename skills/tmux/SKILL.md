---
name: tmux
description: "Remote control tmux sessions for interactive CLIs (python, gdb, etc.) by sending keystrokes and scraping pane output."
license: Vibecoded
---

# tmux Skill

Use tmux as a programmable terminal multiplexer for interactive work. Works on Linux and macOS with stock tmux.

## Session strategy: reuse vs. isolate

Before creating anything, check `$TMUX`. If it is set, the agent is already running inside a tmux session. In that case, **create a new window in the current session** so the user can switch to it with normal tmux keybindings (e.g. `Ctrl+b n`). Do NOT create a separate socket/session.

### When inside an existing tmux session (`$TMUX` is set)

```bash
# Parse current session name from $TMUX
CURRENT_SESSION=$(tmux display-message -p '#{session_name}')
WINDOW_NAME=claude-dev   # descriptive slug

# Create a new window in the current session
tmux new-window -t "$CURRENT_SESSION" -n "$WINDOW_NAME"
tmux send-keys -t "$CURRENT_SESSION:$WINDOW_NAME" -- 'python3 -q' Enter
tmux capture-pane -p -J -t "$CURRENT_SESSION:$WINDOW_NAME" -S -200
```

After creating the window, tell the user:

```
Started in tmux window "$WINDOW_NAME". Switch to it with:
  Ctrl+b n    (next window)
  Ctrl+b w    (window list)
```

### When NOT inside tmux (`$TMUX` is empty)

Fall back to an isolated socket:

```bash
SOCKET_DIR=${TMPDIR:-/tmp}/claude-tmux-sockets
mkdir -p "$SOCKET_DIR"
SOCKET="$SOCKET_DIR/claude.sock"
SESSION=claude-python
tmux -S "$SOCKET" new -d -s "$SESSION" -n shell
tmux -S "$SOCKET" send-keys -t "$SESSION":0.0 -- 'python3 -q' Enter
tmux -S "$SOCKET" capture-pane -p -J -t "$SESSION":0.0 -S -200
tmux -S "$SOCKET" kill-session -t "$SESSION"   # clean up when done
```

After starting, tell the user:

```
To monitor this session yourself:
  tmux -S $SOCKET attach -t $SESSION
```

This must ALWAYS be printed right after a session was started and once again at the end of the tool loop.

## Socket convention (isolated mode only)

- Agents MUST place tmux sockets under `CLAUDE_TMUX_SOCKET_DIR` (defaults to `${TMPDIR:-/tmp}/claude-tmux-sockets`) and use `tmux -S "$SOCKET"` so we can enumerate/clean them. Create the dir first: `mkdir -p "$CLAUDE_TMUX_SOCKET_DIR"`.
- Default socket path to use unless you must isolate further: `SOCKET="$CLAUDE_TMUX_SOCKET_DIR/claude.sock"`.

## Targeting panes and naming

- Target format: `{session}:{window}.{pane}`, defaults to `:0.0` if omitted. Keep names short (e.g., `claude-py`, `claude-gdb`).
- **Inside existing tmux**: use bare `tmux` commands (no `-S`). Target with `$CURRENT_SESSION:$WINDOW_NAME`.
- **Isolated mode**: use `-S "$SOCKET"` consistently. Target with `$SESSION:0.0`.
- Inspect: `tmux list-windows` (inside tmux) or `tmux -S "$SOCKET" list-sessions` (isolated).

## Finding sessions

- List sessions on your active socket with metadata: `./scripts/find-sessions.sh -S "$SOCKET"`; add `-q partial-name` to filter.
- Scan all sockets under the shared directory: `./scripts/find-sessions.sh --all` (uses `CLAUDE_TMUX_SOCKET_DIR` or `${TMPDIR:-/tmp}/claude-tmux-sockets`).

## Sending input safely

- Prefer literal sends to avoid shell splitting: `tmux -L "$SOCKET" send-keys -t target -l -- "$cmd"`
- When composing inline commands, use single quotes or ANSI C quoting to avoid expansion: `tmux ... send-keys -t target -- $'python3 -m http.server 8000'`.
- To send control keys: `tmux ... send-keys -t target C-c`, `C-d`, `C-z`, `Escape`, etc.

## Watching output

- Capture recent history (joined lines to avoid wrapping artifacts): `tmux -L "$SOCKET" capture-pane -p -J -t target -S -200`.
- For continuous monitoring, poll with the helper script (below) instead of `tmux wait-for` (which does not watch pane output).
- You can also temporarily attach to observe: `tmux -L "$SOCKET" attach -t "$SESSION"`; detach with `Ctrl+b d`.
- When giving instructions to a user, **explicitly print a copy/paste monitor command** alongside the action don't assume they remembered the command.

## Spawning Processes

Some special rules for processes:

- when asked to debug, use lldb by default
- when starting a python interactive shell, always set the `PYTHON_BASIC_REPL=1` environment variable. This is very important as the non-basic console interferes with your send-keys.

## Synchronizing / waiting for prompts

- Use timed polling to avoid races with interactive tools. Example: wait for a Python prompt before sending code:
  ```bash
  ./scripts/wait-for-text.sh -t "$SESSION":0.0 -p '^>>>' -T 15 -l 4000
  ```
- For long-running commands, poll for completion text (`"Type quit to exit"`, `"Program exited"`, etc.) before proceeding.

## Interactive tool recipes

- **Python REPL**: `tmux ... send-keys -- 'python3 -q' Enter`; wait for `^>>>`; send code with `-l`; interrupt with `C-c`. Always with `PYTHON_BASIC_REPL`.
- **gdb**: `tmux ... send-keys -- 'gdb --quiet ./a.out' Enter`; disable paging `tmux ... send-keys -- 'set pagination off' Enter`; break with `C-c`; issue `bt`, `info locals`, etc.; exit via `quit` then confirm `y`.
- **Other TTY apps** (ipdb, psql, mysql, node, bash): same pattern—start the program, poll for its prompt, then send literal text and Enter.

## Cleanup

- **Inside existing tmux**: kill the window, not the session: `tmux kill-window -t "$CURRENT_SESSION:$WINDOW_NAME"`.
- **Isolated mode**: kill a session: `tmux -S "$SOCKET" kill-session -t "$SESSION"`. Kill all: `tmux -S "$SOCKET" kill-server`.

## Helper: wait-for-text.sh

`./scripts/wait-for-text.sh` polls a pane for a regex (or fixed string) with a timeout. Works on Linux/macOS with bash + tmux + grep.

```bash
./scripts/wait-for-text.sh -t session:0.0 -p 'pattern' [-F] [-T 20] [-i 0.5] [-l 2000]
```

- `-t`/`--target` pane target (required)
- `-p`/`--pattern` regex to match (required); add `-F` for fixed string
- `-T` timeout seconds (integer, default 15)
- `-i` poll interval seconds (default 0.5)
- `-l` history lines to search from the pane (integer, default 1000)
- Exits 0 on first match, 1 on timeout. On failure prints the last captured text to stderr to aid debugging.
