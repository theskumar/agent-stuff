# Usage: python3 imggen.py "prompt" out.png [ref1.png,ref2.jpg] [1024x1024]
# OpenAI image_generation via the ChatGPT Codex backend, using the Codex CLI login (~/.codex/auth.json; run `codex login`).
# Undocumented endpoint: if it breaks, fall back to the OpenAI Images API with an API key.
import json,base64,sys,urllib.request,time
d=json.load(open(__import__('os').path.expanduser('~/.codex/auth.json')))['tokens']
tok=d['access_token']; acct=d['account_id']
prompt, outp = sys.argv[1], sys.argv[2]
model = 'gpt-5.5'
ref = sys.argv[3] if len(sys.argv)>3 and sys.argv[3] else None
size = sys.argv[4] if len(sys.argv)>4 else 'auto'
body={"model":model,"instructions":"You generate images with the image_generation tool. Always call the tool exactly once.","input":[{"role":"user","content":[{"type":"input_text","text":prompt}]+[{"type":"input_image","image_url":"data:image/%s;base64,%s"%('jpeg' if p.endswith('jpg') else 'png',base64.b64encode(open(p,"rb").read()).decode())} for p in (ref.split(',') if ref else [])]}],
 "tools":[{"type":"image_generation","size":size,"quality":"high","background":"transparent","output_format":"png"}],"tool_choice":"auto","stream":True,"store":False}
req=urllib.request.Request('https://chatgpt.com/backend-api/codex/responses',data=json.dumps(body).encode(),method='POST',headers={
 'Authorization':'Bearer '+tok,'chatgpt-account-id':acct or '','Content-Type':'application/json','OpenAI-Beta':'responses=experimental','originator':'codex_cli_rs','accept':'text/event-stream'})
try:
  r=urllib.request.urlopen(req,timeout=300)
except urllib.error.HTTPError as e:
  print('HTTP',e.code,e.read()[:600].decode(),file=sys.stderr); sys.exit(1)
img=None
for line in r:
  line=line.decode().strip()
  if not line.startswith('data:'): continue
  try: ev=json.loads(line[5:])
  except: continue
  t=ev.get('type','')
  if t=='response.output_item.done' and ev.get('item',{}).get('type')=='image_generation_call':
    img=ev['item'].get('result')
  if t in('response.failed','error'): print('ERR',json.dumps(ev)[:600],file=sys.stderr)
if img: open(outp,'wb').write(base64.b64decode(img)); print('saved',outp)
else: print('no image',file=sys.stderr); sys.exit(2)
