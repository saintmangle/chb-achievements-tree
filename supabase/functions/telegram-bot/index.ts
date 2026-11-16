// Telegram webhook response invokes sendMessage without exposing bot credentials.
Deno.serve(async (req) => {
 const secret=Deno.env.get('TELEGRAM_WEBHOOK_SECRET');
 if(req.method!=='POST')return new Response('Method not allowed',{status:405});
 if(!secret || req.headers.get('x-telegram-bot-api-secret-token')!==secret)return new Response('Unauthorized',{status:401});
 const appUrl=Deno.env.get('MINI_APP_URL');
 if(!appUrl)return new Response('Missing MINI_APP_URL',{status:503});
 let update;try{update=await req.json();}catch{return new Response('Invalid JSON',{status:400});}
 const message=update.message;
 const match=typeof message?.text==='string'?message.text.match(/^\/start(?:@chb_achievements_bot)?(?:\s+(\S+))?\s*$/i):null;
 if(!match || message.chat?.type!=='private')return new Response('OK');
 const url=new URL(appUrl);
 if(match[1]&&/^a_[A-Za-z0-9_-]{1,62}$/.test(match[1])){
  try{const id=atob(match[1].slice(2).replaceAll('-','+').replaceAll('_','/'));if(/^[a-zA-Z0-9._-]{1,46}$/.test(id))url.searchParams.set('achievement',id);}catch{/* Open the tree for malformed links. */}
 }
 return Response.json({method:'sendMessage',chat_id:message.chat.id,text:'папочка бота @chbland\n\nпросто нажми кнопочку снизу',reply_markup:{inline_keyboard:[[{text:url.searchParams.has('achievement')?'Посмотреть ачивку 🌳':'Открыть дерево 🌳',web_app:{url:url.href}}]]}});
});
