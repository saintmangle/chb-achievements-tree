const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');const {webcrypto,createHmac}=require('node:crypto');
function handler(file,env){let serve;vm.runInNewContext(ts.transpileModule(fs.readFileSync(file,'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{Deno:{env:{get:k=>env[k]},serve:fn=>serve=fn},crypto:webcrypto,TextEncoder,URLSearchParams,URL,Response,atob});return serve;}
const request=(body,secret)=>new Request('https://example.test',{method:'POST',headers:{'content-type':'application/json',...(secret?{'x-telegram-bot-api-secret-token':secret}:{})},body:JSON.stringify(body)});
test('bot verifies webhook secret and preserves achievement link without private notes',async()=>{
 const run=handler('supabase/functions/telegram-bot/index.ts',{TELEGRAM_WEBHOOK_SECRET:'test-secret',MINI_APP_URL:'https://example.test/app/'}),update={message:{chat:{id:123,type:'private'},text:'/start a_Ni4x'}};
 assert.equal((await run(request(update))).status,401);
 const result=await(await run(request(update,'test-secret'))).json();assert.equal(result.chat_id,123);assert.equal(result.text,'папочка бота @chbland\n\nпросто нажми кнопочку снизу');assert.equal(result.reply_markup.inline_keyboard[0][0].web_app.url,'https://example.test/app/?achievement=6.1');
 assert.equal(await(await run(request({message:{chat:{id:123,type:'group'},text:'/start'}},'test-secret'))).text(),'OK');
});
test('Telegram auth accepts genuine signature and rejects forged, expired and future data',async()=>{
 const token='test-bot-token',secret='test-proof-key',run=handler('supabase/functions/verify-init-data/index.ts',{TELEGRAM_BOT_TOKEN:token,APP_SIGNING_SECRET:secret});
 function init(date){const p=new URLSearchParams({auth_date:String(date),query_id:'test',user:JSON.stringify({id:123,first_name:'Test'})});const key=createHmac('sha256','WebAppData').update(token).digest();const content=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${v}`).join('\n');p.set('hash',createHmac('sha256',key).update(content).digest('hex'));return p.toString();}
 const now=Math.floor(Date.now()/1000),valid=await run(request({initData:init(now)}));assert.equal(valid.status,200);const proof=await valid.json();assert.equal(proof.telegram_user_id,123);assert.equal(proof.sig,createHmac('sha256',secret).update(`123:${proof.exp}`).digest('hex'));
 for(const value of [init(now-90000),init(now+3600),init(now).replace('query_id=test','query_id=forged')])assert.equal((await run(request({initData:value}))).status,401);
});
