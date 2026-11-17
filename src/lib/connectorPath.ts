type Point = {x:number;y:number};
// Route outside the padded text bounds, with no reversal under the caption.
export function connectorPath(anchor:Point,center:Point,size:{width:number;height:number}) {
 const left=center.x-size.width/2-10,right=center.x+size.width/2+10;
 const top=center.y-size.height/2-10,bottom=center.y+size.height/2+10;
 if(anchor.x>=left&&anchor.x<=right&&anchor.y>=top&&anchor.y<=bottom)return '';
 if(anchor.x<left||anchor.x>right){
  const endX=anchor.x<left?left:right,midX=(anchor.x+endX)/2;
  if(Math.abs(anchor.y-center.y)<4)return `M ${anchor.x} ${anchor.y} H ${endX}`;
  return `M ${anchor.x} ${anchor.y} H ${midX} V ${center.y} H ${endX}`;
 }
 const endY=anchor.y<top?top:bottom,midY=(anchor.y+endY)/2;
 if(Math.abs(anchor.x-center.x)<4)return `M ${anchor.x} ${anchor.y} V ${endY}`;
 return `M ${anchor.x} ${anchor.y} V ${midY} H ${center.x} V ${endY}`;
}
