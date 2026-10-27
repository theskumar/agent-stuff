# Batch steps in one codemode script

When pi's `codemode` tool is on, chain the scripts through `tools.bash` in one script. Resolve ids from the `state` output inside the script, so the tree never enters your context:

```js
const sh = async (c) => (await tools.bash({ command: `cd <SKILL_DIR>/scripts && ${c}` })).output.trim();
const run = async (c) => { const out = await sh(c); if (/^✗/m.test(out)) throw new Error(`${c}: ${out}`); return out; };
await run("./nav.js https://httpbin.org/forms/post");
const st = await run("./ax.js state");
const id = (re) => st.split("\n").find((l) => re.test(l))?.match(/\[(\d+)\]/)[1];
await run(`./ax.js type ${id(/Customer name/)} "Test User"`);
await run(`./ax.js click ${id(/Submit order/)}`);
return await run("./eval.js 'document.body.innerText.slice(0,300)'");
```

To show a screenshot from a script, read it with `base64 < file | tr -d '\n'` and pass `"data:image/png;base64," + b64` to `image()`. `tools.read` on an image returns only a text stub.
