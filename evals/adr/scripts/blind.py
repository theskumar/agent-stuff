# blind.py: fresh no-skill sessions judge before/after ADR pairs in random order. Mapping saved in judge/blind-key.json.
import json, random, subprocess, tempfile, shutil, glob, os, concurrent.futures as cf
d = '/tmp/skill-diet-work/adr'; random.seed(20261030)
tasks = {t['id']: t for t in json.load(open(f'{d}/tasks.json'))}
pairs = [(t, i, f'docs/decisions/{"0001" if t == "draft-notes" else "0004"}-*.md')
         for t in ('new-adr', 'draft-notes', 'supersede', 'rejected', 'edit-accepted') for i in (0, 1, 2)]
def one(p):
    tid, i, g = p
    files = {v: glob.glob(f'{d}/runs/{v}-{tid}-{i}/agent/work/{g}')[0] for v in ('before', 'after')}
    order = ['before', 'after']; random.shuffle(order)
    w = tempfile.mkdtemp(); o = f'{d}/judge/blind-{tid}-{i}'; shutil.rmtree(o, ignore_errors=True)
    open(f'{w}/task.txt', 'w').write(tasks[tid]['prompt'] + '\n')
    for lab, v in zip('AB', order): shutil.copy(files[v], f'{w}/{lab}.md')
    if tid == 'draft-notes': os.makedirs(f'{w}/notes'); shutil.copy(glob.glob(f'{d}/runs/before-{tid}-{i}/agent/work/notes/*.md')[0], f'{w}/notes/')
    prompt = ('Today is 2026-10-27. task.txt holds a request a user gave to an agent in a repo. A.md and B.md are two ADRs written for it by different agents'
              + (' (the notes it refers to are in notes/)' if tid == 'draft-notes' else '') +
              '. Read them. Judge which better does the job for a team reading it later: faithful to the request and facts, clear decision, '
              'honest trade-offs, right length, no invented facts. Reply with "WINNER: A", "WINNER: B" or "WINNER: TIE" on the first line, then one line why.')
    subprocess.run([f'{d}/adapter', '', prompt, o, w], capture_output=True)
    shutil.rmtree(w)
    ans = json.load(open(f'{o}/result.json'))['answer']
    win = 'TIE' if 'WINNER: TIE' in ans else ('A' if 'WINNER: A' in ans else 'B' if 'WINNER: B' in ans else '?')
    ver = {'A': order[0], 'B': order[1]}.get(win, win)
    return dict(task=tid, run=i, A=order[0], B=order[1], winner=ver, why=ans.split('\n', 1)[-1].strip()[:300])
with cf.ThreadPoolExecutor(4) as ex: res = list(ex.map(one, pairs))
json.dump(res, open(f'{d}/judge/blind-key.json', 'w'), indent=1)
for r in res: print(f"{r['task']}-{r['run']}: {r['winner']}  ({r['why']})")
