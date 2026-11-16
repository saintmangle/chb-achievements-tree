import { useEffect, useMemo, useRef } from 'react';
import { layoutGraph } from '../lib/graph';
import type { CatalogAchievement } from '../hooks/useAppData';
export function AchievementGraph({ items, title, selected, completed, onSelect }: { items: CatalogAchievement[]; title: string; selected: string | null; completed: Record<string, boolean>; onSelect: (id: string | null) => void }) {
  const graph = useMemo(()=>layoutGraph(items),[items]);
  const viewport=useRef<HTMLDivElement>(null), drag=useRef<{x:number;y:number;left:number;top:number;move:boolean}|null>(null);
  const lookup=new Map(items.map(a=>[a.id,a]));
  useEffect(()=>{const n=graph.nodes.find(n=>n.id===(selected||'__root__'));if(n)viewport.current?.scrollTo({left:Math.max(0,n.x-100),top:Math.max(0,n.y-160)});},[title]);
  return <div className="graph-viewport" ref={viewport} onPointerDown={e=>{if(e.pointerType==='touch')return;drag.current={x:e.clientX,y:e.clientY,left:e.currentTarget.scrollLeft,top:e.currentTarget.scrollTop,move:false};}} onPointerMove={e=>{const d=drag.current;if(!d)return;const dx=e.clientX-d.x,dy=e.clientY-d.y;if(Math.abs(dx)+Math.abs(dy)>5)d.move=true;if(d.move){e.currentTarget.scrollLeft=d.left-dx;e.currentTarget.scrollTop=d.top-dy;}}} onPointerUp={()=>{setTimeout(()=>{drag.current=null;},0);}} onPointerLeave={()=>{drag.current=null;}}>
    <div className="graph-plane" style={{width:graph.width,height:graph.height}}>
      <svg width={graph.width} height={graph.height} aria-hidden="true">{graph.edges.map(e=>{const a=graph.nodes.find(n=>n.id===e.from)!,b=graph.nodes.find(n=>n.id===e.to)!;return <path key={e.to} d={`M${a.x+83},${a.y+26} H${a.x+125} V${b.y+26} H${b.x+35}`} fill="none" stroke="currentColor" strokeWidth="3"/>;})}</svg>
      {graph.nodes.map(n=>{const a=lookup.get(n.id),isRoot=n.id==='__root__';return <button key={n.id} className={'graph-node '+(isRoot?'root-node ':'')+(completed[n.id]?'done ':'')+(selected===n.id?'active':'')} style={{left:n.x,top:n.y}} aria-label={isRoot?title:(a?.title||'')+(completed[n.id]?', выполнено':'')} aria-pressed={selected===n.id} onClick={()=>{if(!drag.current?.move)onSelect(isRoot?null:n.id);}}><span className="node-icon">{isRoot?'◆':a?.icon_url?<img src={a.icon_url} alt="" loading="lazy" onError={e=>{e.currentTarget.style.visibility='hidden';}}/>:String(a?.order??1).padStart(2,'0')}{completed[n.id]&&<b className="check">✓</b>}</span><span className="node-title">{isRoot?title:a?.title}</span></button>})}
    </div>
  </div>;
}
