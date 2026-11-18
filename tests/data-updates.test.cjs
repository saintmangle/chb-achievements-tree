/* oxlint-disable unicorn/no-thenable -- Supabase query builders are intentionally thenable. */
const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const vm=require('node:vm');const ts=require('typescript');
test('mutations preserve local data, use server custom IDs and avoid catalog reloads',async()=>{
 const values=[],calls=[];let fail=false;
 const fixtures={achievement_branches:[{id:1,title:'Test'}],achievement_catalog:[{id:'1.1',branch_id:1,title:'Test',order:1}],user_progress:[],user_custom_achievements:[],achievement_notes:[],branch_visual_progress:[{branch_id:1,ratio:0.5}]};
 const supabase={rpc:()=>Promise.resolve({data:false,error:null}),from:table=>{let op='select',single=false;const q={select(){return q},order(){return q},eq(){return q},single(){single=true;return q},upsert(){op='upsert';return q},insert(){op='insert';return q},delete(){op='delete';return q},update(){op='update';return q},then(resolve,reject){calls.push({table,op});return Promise.resolve({error:fail?{message:'offline'}:null,data:single?{id:'server-id',text:'New',status:false,telegram_user_id:123,created_at:'now'}:fixtures[table]}).then(resolve,reject)}};return q}};
 const exports={};vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/hooks/useAppData.ts','utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText,{exports,crypto:require('node:crypto').webcrypto,require:name=>name==='react'?{useState:initial=>{const i=values.length;values.push(initial);return [initial,v=>values[i]=v]},useRef:current=>({current}),useCallback:f=>f,useEffect:()=>{}}:name.includes('supabase')?{supabase}:name.includes('useTelegramAuth')?{isDemo:false}:{branches:[],achievements:[]}});
 const app=exports.useAppData(123);await app.reload();calls.length=0;
 await app.saveNote('1.1','hello');assert.equal(values[0].notes['1.1'],'hello');assert.equal(calls.length,1);
 calls.length=0;await app.addCustom('New');assert.equal(values[0].custom[0].id,'server-id');assert.equal(calls.length,1);
 calls.length=0;await app.toggle('1.1');assert.equal(values[0].visuals[1],0.5);assert.equal(calls.length,3);assert.ok(calls.every(c=>['user_progress','branch_visual_progress'].includes(c.table)));
 fail=true;assert.equal(await app.saveNote('1.1','lost'),false);assert.equal(values[0].notes['1.1'],'hello');
});
