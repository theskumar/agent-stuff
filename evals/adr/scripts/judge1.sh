#!/bin/sh
# judge1.sh <run-name> <adr-glob> : fresh no-skill session judges whether one ADR does the job.
r=$1; g=$2; d=/tmp/skill-diet-work/adr
w=$(mktemp -d); o=$d/judge/loosen-$r; rm -rf $o
cp $d/runs/$r/agent/work/$g $w/adr.md
p=$(python3 -c "import json;print(json.load(open('$d/runs/$r/result.json'))['task'])")
prompt=$(python3 -c "import json;print([t['prompt'] for t in json.load(open('$d/tasks.json')) if t['id']=='$p'][0])")
$d/adapter "" "A user asked an agent: \"$prompt\". The agent wrote ./adr.md. Read it. Does it do the job, including stating the decision's costs or negative consequences? Reply with PASS or FAIL on the first line, then one line of reason." $o $w >/dev/null 2>&1
rm -rf $w; echo "$r: $(python3 -c "import json;print(json.load(open('$o/result.json'))['answer'].replace(chr(10),' ')[:200])")"
