const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
const output={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/lib/connectorPath.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS}}).outputText,{exports:output});
test('connector avoids text for wide and multiline titles across all anchor directions',()=>{
 for(const size of [{width:280,height:26},{width:120,height:80}]){
  const center={x:160,y:220},left=160-size.width/2-10,right=160+size.width/2+10,top=220-size.height/2-10,bottom=220+size.height/2+10;
  for(let x=0;x<=320;x+=8)for(let y=0;y<=440;y+=8){
   const path=output.connectorPath({x,y},center,size);
   if(x>=left&&x<=right&&y>=top&&y<=bottom){assert.equal(path,'');continue;}
   const tokens=path.split(' ');let px=+tokens[1],py=+tokens[2];
   for(let i=3;i<tokens.length;i+=2){const nx=tokens[i]==='H'?+tokens[i+1]:px,ny=tokens[i]==='V'?+tokens[i+1]:py;
    for(let step=0;step<=10;step++){const sx=px+(nx-px)*step/10,sy=py+(ny-py)*step/10;assert.ok(!(sx>left&&sx<right&&sy>top&&sy<bottom),path);}
    px=nx;py=ny;
   }
   assert.ok(px===left||px===right||py===top||py===bottom);
  }
 }
});
test('fixed square connector ends exactly on button border',()=>{
 const center={x:160,y:220},size={width:48,height:48};
 assert.equal(output.connectorPath({x:20,y:220},center,size,0),'M 20 220 H 136');
 assert.equal(output.connectorPath({x:300,y:220},center,size,0),'M 300 220 H 184');
 assert.equal(output.connectorPath({x:160,y:20},center,size,0),'M 160 20 V 196');
 assert.equal(output.connectorPath({x:160,y:400},center,size,0),'M 160 400 V 244');
 assert.equal(output.connectorPath(center,center,size,0),'');
});
