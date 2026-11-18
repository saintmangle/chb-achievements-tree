import { getTelegramAuthProof, supabase } from './supabase';
export async function shareCard(title:string, description:string) {
 await document.fonts.ready;
 const canvas=document.createElement('canvas');canvas.width=1000;
 const ctx=canvas.getContext('2d');if(!ctx)throw new Error('Не удалось создать карточку');
 function wrap(text:string,font:string){ctx!.font=font;const lines:string[]=[];for(const paragraph of text.split('\n')){let line='';for(const word of paragraph.split(' ')){if(ctx!.measureText(line+' '+word).width>840&&line){lines.push(line);line='';}for(const ch of (line?' ':'')+word){if(ctx!.measureText(line+ch).width>840){lines.push(line);line='';}line+=ch;}}lines.push(line);}return lines;}
 const headings=wrap(title,'24px "Press Start 2P"'),body=wrap(description,'28px Arial');canvas.height=260+headings.length*40+body.length*40;
 ctx.fillStyle='#858585';ctx.fillRect(0,0,1000,canvas.height);ctx.lineWidth=12;ctx.strokeStyle='#bababa';ctx.strokeRect(12,12,976,canvas.height-24);ctx.fillStyle='#333';ctx.fillRect(34,34,932,canvas.height-68);
 let y=90;ctx.fillStyle='#cdd7bc';ctx.font='16px "Press Start 2P"';ctx.fillText('CHB / АЧИВКА',80,y);y+=70;ctx.fillStyle='#fff';ctx.font='24px "Press Start 2P"';for(const line of headings){ctx.fillText(line,80,y);y+=40;}y+=20;ctx.font='28px Arial';for(const line of body){ctx.fillText(line,80,y);y+=40;}ctx.fillStyle='#bbb';ctx.font='22px Arial';ctx.fillText('@chb_achievements_bot',80,canvas.height-60);
 const blob=await new Promise<Blob>((resolve,reject)=>canvas.toBlob(b=>b?resolve(b):reject(new Error('Не удалось создать PNG')),'image/png'));
 if(!getTelegramAuthProof())throw new Error('Открой миниапку через Telegram.');
 const form=new FormData();form.append('photo',blob,'achievement.png');
 const {data,error}=await supabase.functions.invoke('save-achievement-card',{body:form});
 if(error||data?.ok!==true){
  let detail=data;
  if(error&&'context' in error&&error.context instanceof Response){try{detail=await error.context.json();}catch{/* Generic transport error below. */}}
  throw new Error(detail?.code==='BOT_UNAVAILABLE'?'Запусти бота командой /start, затем попробуй ещё раз.':detail?.code==='RATE_LIMIT'?'Слишком часто. Попробуй чуть позже.':'Не удалось подтвердить отправку. Проверь чат с ботом перед повторной попыткой.');
 }
 return 'saved';
}
