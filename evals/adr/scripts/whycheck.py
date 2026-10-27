# whycheck.py <run-name>: rerun each '&&' part of the task's check on the saved work snapshot, print failing parts.
import json, sys, subprocess, tempfile, shutil, os
d = '/tmp/skill-diet-work/adr'; r = sys.argv[1]
res = json.load(open(f'{d}/runs/{r}/result.json'))
t = [t for t in json.load(open(f'{d}/tasks.json')) if t['id'] == res['task']][0]
w = tempfile.mkdtemp()
subprocess.run(['sh', '-c', t['setup']], cwd=w, check=True)
git = os.path.join(w, '.git'); keep = tempfile.mkdtemp(); shutil.move(git, keep)
shutil.rmtree(w); shutil.copytree(f'{d}/runs/{r}/agent/work', w); shutil.move(os.path.join(keep, '.git'), git)
parts = t['check'].split(' && ')
env = ''
for p in parts:
    full = (env + ' && ' if env else '') + p
    ok = subprocess.run(['sh', '-c', full], cwd=w).returncode == 0
    if p.lstrip().startswith(('f=', '[ $(ls')) or 'f=$(' in p: env = full if ok else env
    if not ok: print('FAIL:', p[:160])
shutil.rmtree(w)
