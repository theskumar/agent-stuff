#!/bin/sh
# run.sh <eval args...>: retries when calibration flakes (the none agent's find command can name adr/SKILL.md)
cd /tmp/skill-diet-work/adr
E=/Users/theskumar/.pi/agent/npm/node_modules/skill-diet/scripts/eval.mjs
for i in 1 2 3 4 5 6 7 8; do node $E run . --model openai/gpt-6-luna --parallel 4 "$@" > run.log 2>&1; grep -q "calibration failed" run.log || break; echo "calibration retry $i"; done
tail -3 run.log
