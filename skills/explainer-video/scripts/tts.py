# Usage: python3 tts.py  (reads beats.json, writes aud/, timeline.json, narration.wav, captions.srt)
# Env: VOICE (default en-US-AvaMultilingualNeural), RATE (default +6%), CAPFIX=capfix.json ([["spoken","shown"],...])
import json,subprocess,re,os
from concurrent.futures import ThreadPoolExecutor
V=os.environ.get("VOICE","en-US-AvaMultilingualNeural"); RATE=os.environ.get("RATE","+6%")
beats=json.load(open('beats.json')); os.makedirs('aud',exist_ok=True)
items=[(bid,txt) for _,bs in beats for bid,txt in bs]
def run(it):
    bid,txt=it
    if not os.path.exists(f'aud/{bid}.mp3'):
        subprocess.run(['uvx','edge-tts','--voice',V,f'--rate={RATE}','--text',txt,'--write-media',f'aud/{bid}.mp3','--write-subtitles',f'aud/{bid}.srt'],check=True,capture_output=True)
    d=float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f'aud/{bid}.mp3']))
    def ts(s):h,m,r=s.split(':');sec,ms=r.split(',');return int(h)*3600+int(m)*60+int(sec)+int(ms)/1000
    subs=[]
    for blk in open(f'aud/{bid}.srt').read().strip().split('\n\n'):
        l=blk.split('\n'); a,b=l[1].split(' --> '); subs.append([ts(a),ts(b),' '.join(l[2:])])
    return bid,d,subs
with ThreadPoolExecutor(6) as ex: res={b:(d,s) for b,d,s in ex.map(run,items)}
T={}; caps=[]; t=0.8; files=[]
CAPFIX=[tuple(x) for x in json.load(open(os.environ.get('CAPFIX','capfix.json')))] if os.path.exists(os.environ.get('CAPFIX','capfix.json')) else []
for si,(scene,bs) in enumerate(beats):
    if si>0: t+=0.9
    T[scene]=round(t,3)
    for bid,_ in bs:
        d,subs=res[bid]; T[bid]=round(t,3)
        for i,(a,b,txt) in enumerate(subs):
            T[f'{bid}.{i}']=round(t+a,3)
            for x,y in sorted(CAPFIX,key=lambda p:-len(p[0])): txt=txt.replace(x,y)
            caps.append([round(t+a,3),round(t+b,3),txt])
        files.append((bid,t)); t+=d+0.35
        T[bid+':end']=round(t-0.35,3)
total=round(t+2.0,2); T['END']=total
json.dump({'T':T,'caps':caps,'total':total},open('timeline.json','w'),indent=0)
open('timeline.js','w').write('const TIMELINE='+json.dumps({'T':T,'caps':caps,'total':total})+';')
# audio mix
inputs=[];flt=[]
for i,(bid,st) in enumerate(files):
    inputs+=['-i',f'aud/{bid}.mp3']; flt.append(f'[{i}:a]adelay={int(st*1000)}:all=1[a{i}]')
flt.append(''.join(f'[a{i}]' for i in range(len(files)))+f'amix=inputs={len(files)}:normalize=0,apad=whole_dur={total}[out]')
subprocess.run(['ffmpeg','-y','-v','error',*inputs,'-filter_complex',';'.join(flt),'-map','[out]','-ar','48000','-ac','2','narration.wav'],check=True)
def f(s):h=int(s//3600);m=int(s%3600//60);sec=s%60;return f'{h:02}:{m:02}:{sec:06.3f}'.replace('.',',')
open('captions.srt','w').write('\n'.join(f'{i+1}\n{f(a)} --> {f(b)}\n{x}\n' for i,(a,b,x) in enumerate(caps)))
print('total',total,'beats',len(files),'caps',len(caps)); print({k:T[k] for k in [s for s,_ in beats]})
