# Output styles — sources and acknowledgements

Claude Code output styles, version controlled here and symlinked into
`~/.claude/output-styles/` by [`install.sh`](../install.sh).

Select one with `/output-style <name>` in Claude Code, or set
`"outputStyle": "<name>"` in `~/.claude/settings.json`. The `<name>` is the
`name` field in each file's frontmatter.

| Style | Source | Notes |
|---|---|---|
| [`simple-english.md`](simple-english.md) | [AminBlg/SimpleEnglish](https://github.com/AminBlg/SimpleEnglish/blob/main/output-styles/simple-english.md) | ASD-STE100 Simplified Technical English. Vendored verbatim from upstream. Thanks to [AminBlg](https://github.com/AminBlg). |
| [`caveman.md`](caveman.md) | [carlosduplar/caveman-output-style-claude-code](https://github.com/carlosduplar/caveman-output-style-claude-code/blob/main/.claude/output-styles/caveman.md) | Terse "smart caveman" style. Adapted from upstream. Thanks to [carlosduplar](https://github.com/carlosduplar). |
