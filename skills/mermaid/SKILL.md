---
disable-model-invocation: true
name: mermaid
description: "Must read guide on creating/editing mermaid charts with validation tools"
---

# Mermaid Skill

Use this skill to validate Mermaid diagrams and preview them as images. The tool uses [Pele](https://pele.run), a pure JavaScript Mermaid renderer, through [pele-cli](https://github.com/ahmedelgabri/pele-cli). Validation needs no browser and takes under a second.

## Prerequisites

- Node.js 22.4 or later, with `npx`.
- For `--png` and `--strict`: Chrome, Chromium, Brave, or Edge. Set `CHROME` if the tool cannot find the browser.

## Tool

### Validate diagrams

```bash
./tools/validate.sh diagram.mmd
./tools/validate.sh README.md docs/*.md
```

- Accepts `.mmd` and `.mermaid` files, and `mermaid` code blocks in `.md` files.
- Prints each error as `file:line:col`, with the line number in the original file.
- Exit codes: `0` valid, `1` invalid diagrams, `2` usage or file error.

### Preview as an image

```bash
./tools/validate.sh --png /tmp/mermaid-preview diagram.mmd
```

- Writes one SVG and one PNG per diagram, and prints the PNG paths.
- Read a PNG to check layout, label fit, and edge routing.
- Markdown files produce `<name>-1.png`, `<name>-2.png`, and so on, in block order.
- `--theme light|dark|auto` sets the colors. The default is `light`.
- `--svg <dir>` writes SVG files only.

### Other options

| Option     | Effect                                                                     |
| ---------- | -------------------------------------------------------------------------- |
| `--json`   | Prints the check result as JSON: diagram count and every error.            |
| `--ascii`  | Prints a text preview of `.mmd` files (`beautiful-mermaid`, best-effort).  |
| `--strict` | Also validates with the official `@mermaid-js/mermaid-cli`. Takes seconds. |

Run `./tools/validate.sh --help` for the full list. Run `npx -y --min-release-age=0 @ahmedelgabri/pele-cli@0.1.1 types` to list the supported diagram types.

## Workflow

1. Write or edit the diagram in place: a `.mmd` file, or a mermaid block in Markdown.
2. Run `./tools/validate.sh <file>`.
3. Fix each error at the reported `file:line:col`. Run the tool again until it exits `0`.
4. For a new or restructured diagram, run with `--png /tmp/mermaid-preview` and read the PNG.
5. If GitHub, GitLab, or Notion will render the diagram, run once with `--strict`. These sites use mermaid.js, and Pele can accept or reject edge cases differently.

## Notes

- Pele estimates label widths without a browser. Labels in an unusual font can overflow their shapes slightly.
- Pele supports the diagram types built into Mermaid 12.1.0. It does not support plugins such as ZenUML.
- The tool pins `@ahmedelgabri/pele-cli@0.1.1`, which pins `pele@1.6.0`. The npx call passes `--min-release-age=0` because both releases are newer than the 7-day npm cooldown. Remove that flag after 2026-10-30.
- A `pele` binary on `PATH` takes precedence over npx. `PELE_CMD` overrides both.
