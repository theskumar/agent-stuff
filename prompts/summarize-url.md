---
description: Fetch a URL (or HN post + comments) and summarize it
allowedTools: Bash, Read, Write
---

You are summarizing web content for the user. The input is: $ARGUMENTS

## Steps

### 1. Detect URL type

- **HN item page** (`news.ycombinator.com/item?id=...`): extract the item ID, fetch via HN API, get the article URL and top-level comment IDs.
- **HN front page** (`news.ycombinator.com`): fetch top stories via API, present titles, ask user which to summarize.
- **Any other URL**: treat as a direct article URL with no comments.

### 2. Fetch the article


```bash
uvx --from 'markitdown' markitdown "<article-url>"
```

If `content.js` fails (empty output or error), fall back to the web-browser skill's `content.js` 
to extract readable markdown from the article URL. Before using it, ensure Chrome is running:

```bash
cd ~/.agents/skills/web-browser/scripts
node start.js --profile --stealth 2>/dev/null
node content.js "<article-url>" 2>/dev/null
```

### 3. Fetch HN comments (only for HN URLs)

Use the HN Firebase API to fetch top-level comments:

```bash
curl -s "https://hacker-news.firebaseio.com/v0/item/<id>.json"
```

Fetch up to 15 top-level `kids` items. For each comment, extract `by` and `text` fields. Strip HTML tags from comment text. Skip deleted or dead comments.

### 4. Summarize

Write a concise summary with these sections:

**For articles with HN comments:**
- **Article summary**: 1 paragraph capturing the core argument and key points.
- **Comment themes**: Group comments into 2-4 camps/perspectives. Quote brief, representative snippets. Note the overall sentiment split.
- **Bottom line**: 1-2 sentences on the key tension or takeaway.

**For articles without comments:**
- **Summary**: 2-3 paragraphs covering the main argument, supporting evidence, and conclusion.
- **Key points**: Bullet list of the most important claims or findings.

Keep summaries tight. Prefer the author's own words when they're vivid. Don't editorialize.
