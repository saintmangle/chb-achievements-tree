import { useEffect, useRef } from 'react';
import type { CatalogBranch } from '../hooks/useAppData';
export const treeAreas = [
  [31,22,35,20],[14,28,22,10],[14,38,20,10],[18,47,20,10],[17,56,23,10],[17,64,20,9],[20,74,23,11],
  [74,12,39,17],[85,22,23,10],[84,33,23,10],[84,43,28,11],[85,53,23,9],[81,62,27,9],[79,73,34,13],[50,91,65,13],
];
const colors = [[92,161,94],[113,156,75],[76,159,122],[151,170,76],[102,156,130],[72,155,147],[113,172,102],[76,147,102],[136,171,96],[95,163,146],[152,168,84],[90,145,78],[121,165,123],[145,178,93]];
export function TreeHome({ branches, selected, ratios, onSelect, onOpen }: { branches: CatalogBranch[]; selected: number | null; ratios: Record<number, number>; onSelect: (id: number) => void; onOpen: (id: number) => void }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const original = useRef<ImageData | null>(null);
  const regions = useRef<Int8Array | null>(null);
  // Find whole painted foliage islands once, so two neighboring clouds never
  // inherit each other's progress along an artificial rectangular boundary.
  function segment(source: ImageData) {
    const {width,height,data}=source, labels=new Int8Array(width*height).fill(-1), seen=new Uint8Array(width*height);
    const green=(p:number)=>data[p*4+3]>10&&data[p*4+1]>data[p*4]*1.35&&data[p*4+1]>data[p*4+2]*1.1;
    for(let start=0;start<seen.length;start++) {
      if(seen[start]||!green(start))continue;
      const pixels=[start];seen[start]=1;let sx=0,sy=0;
      for(let k=0;k<pixels.length;k++) {const p=pixels[k],x=p%width,y=Math.floor(p/width);sx+=x;sy+=y;
        for(const n of [x>0?p-1:-1,x<width-1?p+1:-1,y>0?p-width:-1,y<height-1?p+width:-1])if(n>=0&&!seen[n]&&green(n)){seen[n]=1;pixels.push(n);}
      }
      const px=sx/pixels.length/width*100,py=sy/pixels.length/height*100;
      let nearest=0,dist=Infinity;
      for(let j=0;j<14;j++){const a=treeAreas[j],d=((px-a[0])/(a[2]/2))**2+((py-a[1])/(a[3]/2))**2;if(d<dist){dist=d;nearest=j;}}
      for(const p of pixels)labels[p]=nearest;
    }
    regions.current=labels;
  }
  const latest = useRef(ratios); latest.current = ratios;
  const selectedCloud = useRef(selected); selectedCloud.current = selected;
  function paint() {
    const ctx = canvas.current?.getContext('2d'), source = original.current; if (!ctx || !source) return;
    const out = new ImageData(new Uint8ClampedArray(source.data), source.width, source.height);
    for (let y=0; y<source.height; y++) for(let x=0; x<source.width; x++) {
      const i=(y*source.width+x)*4, r=source.data[i], g=source.data[i+1], b=source.data[i+2];
      if (source.data[i+3]<10 || g<r*1.35 || g<b*1.1) continue;
      const py=y/source.height*100, nearest=regions.current?.[y*source.width+x] ?? -1;
      if(nearest<0)continue;
      const p=treeAreas[nearest], ratio=latest.current[nearest+1] ?? 0;
      // Fixed organic reveal pattern. The image and contours are never regenerated.
      const vertical=Math.max(0,Math.min(1,(p[1]+p[3]/2-py)/p[3]));
      const wave=Math.sin(x*.042)*Math.cos(y*.037)*.13;
      const threshold=Math.max(.001,Math.min(.999,vertical+wave));
      const earned=ratio>=threshold;
      const color=earned?colors[nearest]:colors[nearest].map((v,k)=>[137,147,126][k]*.75+v*.25);
      const shade=Math.min(1.1,g/107);
      const highlight=selectedCloud.current===nearest+1 ? 1 : 0;
      out.data[i]=color[0]*shade+highlight*35;out.data[i+1]=color[1]*shade+highlight*35;out.data[i+2]=color[2]*shade+highlight*24;
    }
    ctx.putImageData(out,0,0);
  }
  useEffect(()=>{const image=new Image();image.onload=()=>{const ctx=canvas.current?.getContext('2d');if(!ctx)return;ctx.drawImage(image,0,0,800,1000);original.current=ctx.getImageData(0,0,800,1000);segment(original.current);paint();};image.src=import.meta.env.BASE_URL+'art/tree.png';},[]);
  useEffect(()=>{paint();},[ratios,selected]);
  return <div className="tree-window"><div className="tree-stage">
    <canvas ref={canvas} width={800} height={1000} role="img" aria-label="Твоё дерево достижений: листва окрашивается по мере выполнения" />
    {branches.filter(b=>b.id<=15&&b.active!==false).map(b=>{const p=treeAreas[b.id-1];if(!p)return null;return <button key={b.id} className={'tree-hit '+(selected===b.id?'selected':'')} style={{left:p[0]+'%',top:p[1]+'%',width:p[2]+'%',height:p[3]+'%'}} aria-label={b.title} aria-pressed={selected===b.id} onClick={()=>selected===b.id?onOpen(b.id):onSelect(b.id)}>{selected===b.id&&<span>{b.title.replace(/^ветка\s*/i,'')}</span>}</button>})}
  </div></div>;
}
