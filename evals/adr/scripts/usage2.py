# User prompts mentioning ADRs or the old skill name, last 60 days.
import json, os, time, glob, re
cut = time.time() - 60*86400
pat = re.compile(r'\bADRs?\b|architecture[- ]decision', re.I)
for root in [os.path.expanduser('~/.pi/agent/sessions'), os.path.expanduser('~/.claude/projects')]:
    n = 0
    for f in glob.glob(root + '/**/*.jsonl', recursive=True):
        if os.path.getmtime(f) < cut: continue
        for line in open(f, errors='ignore'):
            if 'skill-diet-work/adr' in line or 'skill_diet' in line: continue
            try: e = json.loads(line)
            except: continue
            m = e.get('message') or {}
            if m.get('role') != 'user': continue
            c = m.get('content')
            t = ' '.join(x.get('text','') for x in c if isinstance(x, dict)) if isinstance(c, list) else str(c)
            if len(t) > 3000 or not pat.search(t): continue
            n += 1
            print(os.path.basename(os.path.dirname(f))[:50], '|', t[:300].replace('\n',' '))
    print('==', root, n)
