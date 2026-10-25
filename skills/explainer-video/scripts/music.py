# /// script
# dependencies = ["numpy"]
# ///
# Usage: uv run music.py -> music.wav (length from timeline.json). Synthesized, so no licensing. Soft ambient bed: pad chords + light plucked arpeggio + sub bass, simple stereo delay "reverb".
import numpy as np, wave, json
SR=48000; DUR=json.load(open('timeline.json'))['total']+1.5
N=int(SR*DUR); t=np.arange(N)/SR
midi=lambda m:440*2**((m-69)/12)
# I - vi - IV - V feel in C, 4 beats @ 84 BPM per bar, 2 bars per chord
BPM=84; beat=60/BPM; bar=4*beat; chord_len=2*bar
chords=[[48,55,60,64,67,71],[45,52,57,60,64,67],[41,48,53,57,60,64],[43,50,55,59,62,67]]
L=np.zeros(N); R=np.zeros(N)
def env_ar(n,a,r):
    e=np.ones(n); a=int(a*SR); r=int(r*SR)
    e[:a]=np.linspace(0,1,a); e[-r:]*=np.linspace(1,0,r); return e
k=0; start=0.0
while start<DUR:
    c=chords[k%4]; s=int(start*SR); n=min(int((chord_len+1.5)*SR),N-s)
    tt=np.arange(n)/SR; e=env_ar(n,1.2,1.8)
    for j,m in enumerate(c[1:]):
        f=midi(m); lfo=1+0.002*np.sin(2*np.pi*0.2*tt+j)
        v=(np.sin(2*np.pi*f*lfo*tt)+0.25*np.sin(2*np.pi*2*f*tt)+0.08*np.sin(2*np.pi*3*f*tt))*e*0.05
        pan=0.3+0.4*(j%2)
        L[s:s+n]+=v*(1-pan); R[s:s+n]+=v*pan
    fb=midi(c[0]-12); v=np.sin(2*np.pi*fb*tt)*e*0.09; L[s:s+n]+=v; R[s:s+n]+=v
    # arpeggio, 8th notes
    arp=[c[2]+12,c[3]+12,c[4]+12,c[3]+12]
    for i in range(int(chord_len/(beat/2))):
        ps=start+i*beat/2; ss=int(ps*SR)
        if ss>=N: break
        m=arp[i%4]; f=midi(m); nn=min(int(1.2*SR),N-ss); tt2=np.arange(nn)/SR
        v=np.sin(2*np.pi*f*tt2)*np.exp(-tt2*5)*0.035*(0.8 if i%2 else 1)
        a=int(0.005*SR); v[:a]*=np.linspace(0,1,a)
        pan=0.5+0.3*np.sin(i)
        L[ss:ss+nn]+=v*(1-pan); R[ss:ss+nn]+=v*pan
    k+=1; start+=chord_len
# stereo feedback delay as cheap space
def delay(x,y,d,g,reps):
    d=int(d*SR)
    for r in range(1,reps+1):
        sh=d*r; x[sh:]+=y[:-sh]*g**r
dl,dr=L.copy(),R.copy(); delay(L,dr,0.357,0.35,5); delay(R,dl,0.476,0.35,5)
# fades
fi=int(3*SR); fo=int(4*SR); env=np.ones(N); env[:fi]=np.linspace(0,1,fi); env[-fo:]=np.linspace(1,0,fo)
L*=env; R*=env; pk=max(abs(L).max(),abs(R).max()); L/=pk/0.8; R/=pk/0.8
out=(np.stack([L,R],1)*32767).astype('<i2')
w=wave.open('music.wav','wb'); w.setnchannels(2); w.setsampwidth(2); w.setframerate(SR); w.writeframes(out.tobytes()); w.close()
print('ok',DUR)
