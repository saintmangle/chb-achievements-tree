const cors={'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type, x-tg-id, x-tg-exp, x-tg-sig','Access-Control-Allow-Methods':'POST, OPTIONS'};
const reply=(body:unknown,status=200)=>Response.json(body,{status,headers:cors});
Deno.serve(async(req)=>{
 if(req.method==='OPTIONS')return new Response(null,{headers:cors});
 if(req.method!=='POST')return reply({ok:false},405);
 const token=Deno.env.get('TELEGRAM_BOT_TOKEN'),secret=Deno.env.get('APP_SIGNING_SECRET');
 if(!token||!secret)return reply({ok:false,code:'NOT_CONFIGURED'},503);
 const id=req.headers.get('x-tg-id')||'',exp=req.headers.get('x-tg-exp')||'',sig=req.headers.get('x-tg-sig')||'';
 const now=Math.floor(Date.now()/1000);
 if(!/^[1-9][0-9]{0,15}$/.test(id)||!Number.isSafeInteger(Number(id))||!/^\d{10}$/.test(exp)||Number(exp)<now||Number(exp)>now+86460||! /^[a-f0-9]{64}$/.test(sig))return reply({ok:false},401);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
 const signature=Uint8Array.from(sig.match(/../g)!,x=>parseInt(x,16));
 if(!await crypto.subtle.verify('HMAC',key,signature,new TextEncoder().encode(id+':'+exp)))return reply({ok:false},401);
 if(Number(req.headers.get('content-length'))>5_000_000)return reply({ok:false},413);
 try{
  // Bound the streamed request too; content-length is not trusted.
  const reader=req.body?.getReader();if(!reader)return reply({ok:false},400);
  const chunks:Uint8Array[]=[];let length=0;
  while(true){const {value,done}=await reader.read();if(done)break;length+=value.length;if(length>5_000_000){await reader.cancel();return reply({ok:false},413);}chunks.push(value);}
  const body=new Uint8Array(length);let offset=0;for(const chunk of chunks){body.set(chunk,offset);offset+=chunk.length;}
  const form=await new Response(body,{headers:{'content-type':req.headers.get('content-type')||''}}).formData();
  const photo=form.get('photo');
  if(!(photo instanceof File)||photo.type!=='image/png'||photo.size<24||photo.size>4_000_000)return reply({ok:false},400);
  const bytes=new Uint8Array(await photo.arrayBuffer());
  if(![137,80,78,71,13,10,26,10].every((v,i)=>bytes[i]===v))return reply({ok:false},400);
  const dims=new DataView(bytes.buffer),width=dims.getUint32(16),height=dims.getUint32(20);
  if(!width||!height||width+height>10000||Math.max(width/height,height/width)>20)return reply({ok:false},400);
  const upload=new FormData();upload.set('chat_id',id);upload.set('photo',photo,'achievement.png');
  // No caption, text message, external image URL or caller-supplied recipient.
  const response=await fetch('https://api.telegram.org/bot'+token+'/sendPhoto',{method:'POST',body:upload,signal:AbortSignal.timeout(20000)});
  const result=await response.json();
  if(!response.ok||result.ok!==true)return reply({ok:false,code:result.error_code===403||result.error_code===400?'BOT_UNAVAILABLE':result.error_code===429?'RATE_LIMIT':'SEND_FAILED'},502);
  return reply({ok:true,message_id:result.result.message_id});
 }catch{return reply({ok:false,code:'SEND_UNCONFIRMED'},502);}
});
