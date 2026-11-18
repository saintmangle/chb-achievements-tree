export async function shareCard(title:string, description:string) {
 await document.fonts.ready;
 const canvas=document.createElement('canvas');canvas.width=1000;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Не удалось создать карточку');
 function wrap(text:string,font:string){ctx!.font=font;const lines:string[]=[];for(const paragraph of text.split('\n')){let line='';for(const word of paragraph.split(' ')){if(ctx!.measureText(line+' '+word).width>840&&line){lines.push(line);line='';}for(const ch of (line?' ':'')+word){if(ctx!.measureText(line+ch).width>840){lines.push(line);line='';}line+=ch;}}lines.push(line);}return lines;}
 const headings=wrap(title,'24px "Press Start 2P"'),body=wrap(description,'28px Arial');canvas.height=260+headings.length*40+body.length*40;
 ctx.fillStyle='#858585';ctx.fillRect(0,0,1000,canvas.height);ctx.lineWidth=12;ctx.strokeStyle='#bababa';ctx.strokeRect(12,12,976,canvas.height-24);ctx.fillStyle='#333';ctx.fillRect(34,34,932,canvas.height-68);
 let y=90;ctx.fillStyle='#cdd7bc';ctx.font='16px "Press Start 2P"';ctx.fillText('CHB / АЧИВКА',80,y);y+=70;ctx.fillStyle='#fff';ctx.font='24px "Press Start 2P"';for(const line of headings){ctx.fillText(line,80,y);y+=40;}y+=20;ctx.font='28px Arial';for(const line of body){ctx.fillText(line,80,y);y+=40;}ctx.fillStyle='#bbb';ctx.font='22px Arial';ctx.fillText('@chb_achievements_bot',80,canvas.height-60);
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось создать PNG')),'image/png'));const file=new File([blob],'chb-achievement.png',{type:'image/png'});
 if(navigator.canShare?.({files:[file]})){try{await navigator.share({files:[file],text:'@chb_achievements_bot'});return 'shared';}catch(error){if((error as Error).name==='AbortError')throw error;}}
 const download=URL.createObjectURL(blob),a=document.createElement('a');a.href=download;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(download),30000);return 'downloaded';
}
