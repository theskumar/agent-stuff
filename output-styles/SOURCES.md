# Output styles — sources and acknowledgements

Claude Code output styles, version controlled here and symlinked into
`~/.claude/output-styles/` by [`install.sh`](../install.sh).

Select one with `/output-style <name>` in Claude Code, or set
`"outputStyle": "<name>"` in `~/.claude/settings.json`. The `<name>` is the
`name` field in each file's frontmatter.

| Style | Source | Notes |
|---|---|---|
| [`simple-english.md`](simple-english.md) | [AminBlg/SimpleEnglish](https://github.com/AminBlg/SimpleEnglish/blob/main/output-styles/simple-english.md) | ASD-STE100 Simplified Technical English. Vendored verbatim from upstream. Thanks to [AminBlg](https://github.com/AminBlg). |
| [`caveman.md`](caveman.md) | local (recovered) | Terse "smart caveman" style. Recovered from a corrupted `~/.claude/settings.json` + `~/.claude/CLAUDE.md` state where the style body had leaked into the global memory file with no backing style file. Preserved here so it survives. |

## Back reference

- simple-english upstream: <https://github.com/AminBlg/SimpleEnglish>
- Original request: apply simple-english as the Claude Code output style,
  version control the caveman style in this repo, and keep this back
  reference for future use and acknowledgement.

## Corruption note (caveman)

`~/.claude/settings.json` pointed `outputStyle` at `caveman`, but no
`~/.claude/output-styles/caveman.md` existed. The style body had been written
into `~/.claude/CLAUDE.md` (global memory, injected into every session)
instead. `caveman` is not a Claude Code built-in style. The fix:

1. Save the caveman body as a real style file (this directory).
2. Symlink it into `~/.claude/output-styles/` via `install.sh`.
3. Restore `~/.claude/CLAUDE.md` to clean memory (backup kept under
   `~/.claude/backups/`).
