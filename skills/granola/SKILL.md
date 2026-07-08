---
name: granola
description: "Access Granola meeting notes, transcripts, and folders via REST API. Use when user mentions Granola, meeting notes/transcripts, or wants to search/export recorded meetings."
---

Access Granola meeting data via `https://public-api.granola.ai/v1`. Requires API key (`grn_...`).

## Auth

API key passed as Bearer token. Key created in Granola app: **Settings → Connectors → API keys**.

```bash
# Load key (fallback if not already in env)
[ -z "$GRANOLA_API_KEY" ] && source ~/.config/env/granola
```

All curl commands below assume `$GRANOLA_API_KEY` is set. Run the source line above before any API call. If key is empty, ask user to add it to `~/.config/env/granola`.

## Endpoints

### List notes

```bash
# Recent notes (last 7 days)
curl -s "https://public-api.granola.ai/v1/notes?created_after=$(date -u -v-7d +%Y-%m-%dT%H:%M:%SZ)&page_size=30" \
  -H "Authorization: Bearer $GRANOLA_API_KEY" | jq .

# Notes in date range
curl -s "https://public-api.granola.ai/v1/notes?created_after=2026-06-01&created_before=2026-06-30&page_size=30" \
  -H "Authorization: Bearer $GRANOLA_API_KEY" | jq .

# Notes updated recently
curl -s "https://public-api.granola.ai/v1/notes?updated_after=2026-06-25&page_size=30" \
  -H "Authorization: Bearer $GRANOLA_API_KEY" | jq .

# Notes in a folder
curl -s "https://public-api.granola.ai/v1/notes?folder_id=fol_XXXXXXXXXXXXXX&page_size=30" \
  -H "Authorization: Bearer $GRANOLA_API_KEY" | jq .

# Paginate (use cursor from previous response)
curl -s "https://public-api.granola.ai/v1/notes?cursor=eyJjcmVkZW50aWFsfQ==&page_size=30" \
  -H "Authorization: Bearer $GRANOLA_API_KEY" | jq .
```

Response shape: `{ "notes": [...], "hasMore": bool, "cursor": "..." }`

Each note summary: `id` (`not_...`), `title`, `owner` (name, email), `created_at`, `updated_at`.

### Resolve a shared URL to a note ID

Users paste share URLs, **not** API ids. The public API has **no slug lookup** — you cannot GET by the URL's UUID. Two URL forms appear:

- `https://notes.granola.ai/d/<uuid>` — doc link; the `<uuid>` matches a note's `web_url`.
- `https://notes.granola.ai/t/<uuid>-<suffix>` — transcript-chat share link; strip the trailing `-<suffix>`, the leading `<uuid>` still matches.

The `not_...` id is unrelated to the UUID. Resolve by listing recent notes and matching `web_url`:

```bash
URL="https://notes.granola.ai/t/0cdc77eb-ddbd-466a-9432-272be2b159af-008umkv4"
# extract the 8-4-4-4-12 UUID (ignores any trailing -suffix)
UUID=$(echo "$URL" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
# widen the window if not found in recent notes
for id in $(curl -s "https://public-api.granola.ai/v1/notes?created_after=2026-06-20&page_size=30" \
    -H "Authorization: Bearer $GRANOLA_API_KEY" | jq -r '.notes[].id'); do
  wu=$(curl -s "https://public-api.granola.ai/v1/notes/$id" \
    -H "Authorization: Bearer $GRANOLA_API_KEY" | jq -r '.web_url // empty')
  case "$wu" in *"$UUID"*) echo "$id"; break;; esac
done
```

If no match, the note is older than the window — widen `created_after` or paginate with `cursor`.

> **`date` portability:** the BSD `date -u -v-7d` form (in List notes) fails on GNU `date` (`invalid option -- 'v'`). If it errors, pass a literal date (`created_after=2026-06-20`) or use GNU syntax `date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ`.

### Resolve a shared URL to a note ID

Users paste share URLs, **not** API ids. The public API has **no slug lookup** — you cannot GET by the URL's UUID. Two URL forms appear:

- `https://notes.granola.ai/d/<uuid>` — doc link; the `<uuid>` matches a note's `web_url`.
- `https://notes.granola.ai/t/<uuid>-<suffix>` — transcript-chat share link; strip the trailing `-<suffix>`, the leading `<uuid>` still matches.

The `not_...` id is unrelated to the UUID. Resolve by listing recent notes and matching `web_url`:

```bash
URL="https://notes.granola.ai/t/0cdc77eb-ddbd-466a-9432-272be2b159af-008umkv4"
# extract the 8-4-4-4-12 UUID (ignores any trailing -suffix)
UUID=$(echo "$URL" | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}')
# widen the window if not found in recent notes
for id in $(curl -s "https://public-api.granola.ai/v1/notes?created_after=2026-06-20&page_size=30" \
    -H "Authorization: Bearer $GRANOLA_API_KEY" | jq -r '.notes[].id'); do
  wu=$(curl -s "https://public-api.granola.ai/v1/notes/$id" \
    -H "Authorization: Bearer $GRANOLA_API_KEY" | jq -r '.web_url // empty')
  case "$wu" in *"$UUID"*) echo "$id"; break;; esac
done
```

If no match, the note is older than the window — widen `created_after` or paginate with `cursor`.

> **`date` portability:** the BSD `date -u -v-7d` form (in List notes) fails on GNU `date` (`invalid option -- 'v'`). If it errors, pass a literal date (`created_after=2026-06-20`) or use GNU syntax `date -u -d '7 days ago' +%Y-%m-%dT%H:%M:%SZ`.

### Get note (with transcript)

```bash
# Note with summary only
curl -s "https://public-api.granola.ai/v1/notes/not_XXXXXXXXXXXXXX" \
  -H "Authorization: Bearer $GRANOLA_API_KEY" | jq .

# Note with raw transcript
curl -s "https://public-api.granola.ai/v1/notes/not_XXXXXXXXXXXXXX?include=transcript" \
  -H "Authorization: Bearer $GRANOLA_API_KEY" | jq .
```

Full note fields: `id`, `title`, `owner`, `created_at`, `updated_at`, `web_url`, `calendar_event` (title, invitees, organiser, start/end time), `attendees`, `folder_membership`, `summary_text`, `summary_markdown`, `transcript`.

Transcript items: `{ "speaker": { "source": "microphone"|"speaker" }, "text": "...", "start_time": "...", "end_time": "..." }`

- `microphone` = user's voice
- `speaker` = remote participants (macOS can't distinguish individual remote speakers)

### List folders

```bash
curl -s "https://public-api.granola.ai/v1/folders?page_size=30" \
  -H "Authorization: Bearer $GRANOLA_API_KEY" | jq .
```

Each folder: `id` (`fol_...`), `name`, `parent_folder_id` (null if top-level).

## Pagination

All list endpoints return max 30 items per page. When `hasMore` is true, pass `cursor` value to next request.

## Saving transcripts to files

When user wants to export/save, format as markdown:

```markdown
# Meeting Title

**Date:** 2026-06-25
**Attendees:** Alice, Bob

## Summary

{summary_markdown}

## Transcript

**ME:** I think we should...
**SPEAKER:** Agreed, let's...
```

Save to `~/Documents/GranolaTranscripts/YYYY/MM-MonthName/YYYY-MM-DD_Title.md`.
