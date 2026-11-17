import { connectorPath } from '../lib/connectorPath';
import { useEffect, useRef, useState, type ReactNode } from 'react';
type Point = { x:number; y:number };
type Selection = { x:number; y:number; title:string; onOpen:()=>void };
export function TreeViewport({children,selection}:{children:ReactNode;selection?:Selection}) {
 const box=useRef<HTMLDivElement>(null), points=useRef(new Map<number,Point>()), moved=useRef(false);
 const [size,setSize]=useState({width:320,height:450}), [view,setView]=useState({zoom:1.15,x:0,y:0});
 const label=useRef<HTMLButtonElement>(null);
 const [labelSize,setLabelSize]=useState({width:240,height:48});
 useEffect(()=>{const el=label.current;if(!el)return;const observer=new ResizeObserver(([entry])=>setLabelSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(el);return()=>observer.disconnect();},[selection?.title]);
 const fit=Math.min(size.width/800,size.height/1000), scale=fit*view.zoom;
 const limit=(v:typeof view)=>({...v,x:Math.max(-Math.max(0,(800*fit*v.zoom-size.width)/2)-size.width*.2,Math.min(Math.max(0,(800*fit*v.zoom-size.width)/2)+size.width*.2,v.x)),y:Math.max(-Math.max(0,(1000*fit*v.zoom-size.height)/2)-size.height*.2,Math.min(Math.max(0,(1000*fit*v.zoom-size.height)/2)+size.height*.2,v.y))});
 function zoomBy(factor:number,at:Point={x:0,y:0}) {setView(v=>{const zoom=Math.max(.75,Math.min(3.5,v.zoom*factor)),r=zoom/v.zoom;return limit({zoom,x:at.x-(at.x-v.x)*r,y:at.y-(at.y-v.y)*r});});}
 useEffect(()=>{const el=box.current;if(!el)return;const observer=new ResizeObserver(([entry])=>setSize({width:entry.contentRect.width,height:entry.contentRect.height}));observer.observe(el);return()=>observer.disconnect();},[]);
 useEffect(()=>{const el=box.current;if(!el)return;function wheel(e:WheelEvent){e.preventDefault();const r=el!.getBoundingClientRect();zoomBy(Math.exp(-e.deltaY*.002),{x:e.clientX-r.left-r.width/2,y:e.clientY-r.top-r.height/2});}el.addEventListener('wheel',wheel,{passive:false});return()=>el.removeEventListener('wheel',wheel);});
 const anchor=selection?{x:size.width/2+view.x+(selection.x-400)*scale,y:size.height/2+view.y+(selection.y-500)*scale}:null;
 const line=anchor&&anchor.x>=0&&anchor.x<=size.width&&anchor.y>=0&&anchor.y<=size.height?connectorPath(anchor,{x:size.width/2,y:size.height/2},labelSize):'';
 return <div className="tree-window"><div className="tree-camera" ref={box}
 onPointerDown={e=>{if(e.button!==0)return;if(!points.current.size)moved.current=false;points.current.set(e.pointerId,{x:e.clientX,y:e.clientY});if(points.current.size>1)moved.current=true;}}
 onPointerMove={e=>{const prev=points.current.get(e.pointerId);if(!prev)return;const next={x:e.clientX,y:e.clientY};const other=[...points.current.entries()].find(([id])=>id!==e.pointerId)?.[1];if(Math.hypot(next.x-prev.x,next.y-prev.y)<3&&!moved.current)return;moved.current=true;e.currentTarget.setPointerCapture(e.pointerId);points.current.set(e.pointerId,next);if(other){const before=Math.hypot(prev.x-other.x,prev.y-other.y),after=Math.hypot(next.x-other.x,next.y-other.y);const r=e.currentTarget.getBoundingClientRect();if(before>0)zoomBy(after/before,{x:(prev.x+other.x)/2-r.left-r.width/2,y:(prev.y+other.y)/2-r.top-r.height/2});setView(v=>limit({...v,x:v.x+(next.x-prev.x)/2,y:v.y+(next.y-prev.y)/2}));}else setView(v=>limit({...v,x:v.x+next.x-prev.x,y:v.y+next.y-prev.y}));}}
 onPointerUp={e=>points.current.delete(e.pointerId)} onPointerCancel={e=>{points.current.delete(e.pointerId);moved.current=true;}}
 onClickCapture={e=>{if(moved.current){e.preventDefault();e.stopPropagation();}}}>
 <div className="tree-stage" style={{transform:`translate(-50%,-50%) translate(${view.x}px,${view.y}px) scale(${scale})`}}>{children}</div>
 {anchor&&line&&<svg className="tree-connector" width="100%" height="100%" aria-hidden="true"><path d={line} stroke="#252525" strokeWidth="6" fill="none"/><path d={line} stroke="#f2f0d7" strokeWidth="2" fill="none"/><circle cx={anchor.x} cy={anchor.y} r="4" fill="#f2f0d7" stroke="#252525" strokeWidth="2"/></svg>}
 </div>{selection&&<button ref={label} className="tree-selection-title" onClick={selection.onOpen} aria-label={`Открыть: ${selection.title}`}>{selection.title}</button>}<div className="tree-zoom"><button aria-label="Отдалить дерево" disabled={view.zoom<=.75} onClick={()=>zoomBy(1/1.25)}>−</button><button aria-label="Показать всё дерево" onClick={()=>setView({zoom:1,x:0,y:0})}>↺</button><button aria-label="Приблизить дерево" disabled={view.zoom>=3.5} onClick={()=>zoomBy(1.25)}>+</button></div></div>;
}
