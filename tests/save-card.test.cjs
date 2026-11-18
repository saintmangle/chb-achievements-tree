const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const ts=require('typescript');
const {webcrypto,createHmac}=require('node:crypto');
test('card delivery requires signed owner, sends one captionless photo, and reports upstream failure',async()=>{
 let run,calls=0,fail=false;
 const secret='test-key',exp=String(Math.floor(Date.now()/1000)+3600);
 vm.runInNewContext(ts.transpileModule(fs.readFileSync('supabase/functions/save-achievement-card/index.ts','utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022}}).outputText,{
 Deno:{env:{get:k=>k==='APP_SIGNING_SECRET'?secret:'test-token'},serve:fn=>run=fn},crypto:webcrypto,TextEncoder,Response,File,Blob,FormData,AbortSignal,
 fetch:async(url,init)=>{calls++;assert.equal(init.body.get('chat_id'),'123');assert.equal(init.body.get('caption'),null);assert.ok(init.body.get('photo') instanceof File);return Response.json(fail?{ok:false,error_code:403}:{ok:true,result:{message_id:42}},{status:fail?403:200});}
 });
 function request({id='123',signature,invalid=false}={}){const data=new Uint8Array(24);data.set([137,80,78,71,13,10,26,10]);new DataView(data.buffer).setUint32(16,1000);new DataView(data.buffer).setUint32(20,600);if(invalid)data[0]=0;const form=new FormData();form.set('photo',new Blob([data],{type:'image/png'}),'card.png');return new Request('https://example.test',{method:'POST',headers:{'x-tg-id':id,'x-tg-exp':exp,'x-tg-sig':signature||createHmac('sha256',secret).update('123:'+exp).digest('hex')},body:form});}
 assert.equal((await run(request({id:'456'}))).status,401);
 assert.equal((await run(request({signature:'0'.repeat(64)}))).status,401);
 assert.equal((await run(request({invalid:true}))).status,400);
 assert.equal(calls,0);
 assert.deepEqual(await(await run(request())).json(),{ok:true,message_id:42});assert.equal(calls,1);
 fail=true;const response=await run(request());assert.equal(response.status,502);assert.equal((await response.json()).ok,false);assert.equal(calls,2);
});
