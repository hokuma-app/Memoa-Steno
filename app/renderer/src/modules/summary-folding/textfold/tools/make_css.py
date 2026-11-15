import re, sys
import os
SRC=os.path.join(os.environ.get('TEXTFOLD_SRC','textfold-src'),'textfold/web/reader.css')
OUT=sys.argv[1]
L=open(SRC,encoding='utf-8').read().split('\n')
def r(a,b): return '\n'.join(L[a-1:b])
text='\n'.join([r(130,162), r(193,336), r(437,440)])
text=re.sub(r'/\*.*?\*/','',text,flags=re.S)
rules=[]; i=0; n=len(text)
while i<n:
    j=text.find('{',i)
    if j<0: break
    sel=text[i:j].strip(); depth=1; k=j+1
    while depth and k<n:
        depth += (text[k]=='{') - (text[k]=='}'); k+=1
    rules.append((sel,text[j+1:k-1].strip())); i=k
DROP=re.compile(r'^@|\.paper-head|\[data-width|\[data-font|html\.app|html\.compare|^:root|\.legend|\.tagline|\.topbar|\[data-role|\.cjk|\.abstract|\.fbody|\.mk-labeled|\.numbered|\.hint')
out=[]
for sel,body in rules:
    if DROP.search(sel) and not sel.startswith('.hint'): continue
    parts=[]
    for s in sel.split(','):
        s=s.strip()
        s=re.sub(r'^(html|:root)',' .tf-root',s).strip() if re.match(r'^(html|:root)',s) else '.tf-root '+s
        s=s.replace('#ghosts','.tf-ghosts')
        parts.append(s)
    out.append(',\n'.join(parts)+' {\n  '+body+'\n}')
css='\n'.join(out)
css=re.sub(r'--([a-z][\w-]*)',r'--tf-\1',css)
HDR='''/* TextFold reader styles: the zoom bar, the stage, the column, the units and the Topic cards.
   Derived from textfold/web/reader.css (lines 130-162, 193-336 and 437-440)
   Source: https://github.com/chenxiachan/textfold at commit 5062eacc0b1e2a2528e0906414f5073033051a30 (Apache-2.0)
   Modified by Veneta MemoAi: every selector scoped under .tf-root (TextFold's html/:root), custom properties prefixed
   --tf- (host tokens in theme.css), print, width, font, CJK, link, note and map rules left out. See LICENSE and NOTICE. */
'''
open(OUT,'w',encoding='utf-8').write(HDR+css)
print(len(out),'rules')
