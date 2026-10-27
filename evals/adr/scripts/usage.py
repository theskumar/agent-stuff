# Count adr skill invocations in last 60 days of pi and Claude Code logs; print the user prompt.
import json, os, sys, time, glob, re
cut = time.time() - 60*86400
pat = re.compile(r'(/skill:adr\b|<skill name="adr"|<command-name>/?adr</command-name>|"skill":\s*"adr")')
roots = [os.path.expanduser('~/.pi/agent/sessions'), os.path.expanduser('~/.claude/projects')]
for root in roots:
    hits = 0
    for f in glob.glob(root + '/**/*.jsonl', recursive=True):
        if os.path.getmtime(f) < cut: continue
        for line in open(f, errors='ignore'):
            if not pat.search(line): continue
            try: e = json.loads(line)
            except: continue
            m = e.get('message') or {}
            role = m.get('role') or e.get('type')
            c = m.get('content')
            if isinstance(c, list):
                t = ' '.join(x.get('text', '') if isinstance(x, dict) else '' for x in c)
                tu = [x for x in c if isinstance(x, dict) and x.get('type') in ('tool_use','toolCall')]
                if tu: t += ' TOOL:' + json.dumps([x.get('input') or x.get('arguments') for x in tu])[:200]
            else: t = str(c)
            if role != 'user' and 'TOOL:' not in t: continue
            hits += 1
            # strip skill body
            t2 = re.sub(r'<skill name="adr".*?</skill>', '<SKILL>', t, flags=re.S)
            print(f'{os.path.relpath(f, root)[:90]}\n   {role}: {t2[:400]!r}')
    print(root, 'hits', hits, file=sys.stderr)
