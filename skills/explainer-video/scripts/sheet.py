# Usage: python3 sheet.py [cols=3] [out=shots/sheet.jpg]  -> contact sheet of shots/*.jpg (sorted by time), 12 per sheet max
import glob,sys
from PIL import Image
cols=int(sys.argv[1]) if len(sys.argv)>1 else 3; out=sys.argv[2] if len(sys.argv)>2 else 'shots/sheet.jpg'
fs=sorted([f for f in glob.glob('shots/*.jpg') if 'sheet' not in f],key=lambda f:float(f.split('/')[-1][:-4]))[:12]
w=1920//cols; h=w*9//16; rows=(len(fs)+cols-1)//cols
sh=Image.new('RGB',(w*cols,h*rows))
for j,f in enumerate(fs): sh.paste(Image.open(f).resize((w,h)),((j%cols)*w,(j//cols)*h))
sh.save(out,quality=85); print(out,len(fs))
