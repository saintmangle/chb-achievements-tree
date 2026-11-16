const {test}=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const {createHmac}=require('node:crypto');const {PGlite}=require('@electric-sql/pglite');const {pgcrypto}=require('@electric-sql/pglite/contrib/pgcrypto');
test('migrations preserve progress and enforce private data, admin graph validation and custom limit',async()=>{
 const db=new PGlite({extensions:{pgcrypto}});const secret='test-only-signing-secret';
 const scalar=async(sql,args)=>(await db.query(sql,args)).rows[0];
 async function login(id,valid=true){const exp=Math.floor(Date.now()/1000)+3600;const sig=valid?createHmac('sha256',secret).update(`${id}:${exp}`).digest('hex'):'invalid';await db.query("select set_config('request.headers',$1,false)",[JSON.stringify({'x-tg-id':String(id),'x-tg-exp':String(exp),'x-tg-sig':sig})]);await db.exec('set role anon');}
 await db.exec('create role anon;create role authenticated;create schema extensions;');
 for(const f of fs.readdirSync('supabase/migrations').sort()){
  await db.exec(fs.readFileSync('supabase/migrations/'+f,'utf8'));
  if(f==='0002_fix_verify_tg_auth_search_path.sql'){
   await db.query('insert into app_secrets values ($1,$2)',['app_signing_secret',secret]);
   await db.exec("insert into user_progress(telegram_user_id,achievement_id) values(101,'1.1'); grant select,insert,update,delete on user_progress,user_custom_achievements to anon,authenticated;");
  }
 }
 assert.equal((await scalar('select count(*)::int as n from achievement_catalog')).n,266);
 assert.equal((await scalar('select count(*)::int as n from user_progress')).n,1);
 await db.exec('insert into app_admins values(999)');
 await login(101);
 assert.equal((await scalar('select count(*)::int as n from user_progress')).n,1);
 assert.equal((await scalar('select count(*)::int as n from achievement_catalog')).n,266);
 await db.exec("insert into achievement_notes values(101,'1.1','private story')");
 assert.ok((await scalar('select ratio from branch_visual_progress where branch_id=1')).ratio>0);
 await assert.rejects(db.exec("insert into achievement_catalog(id,branch_id,title) values('hacked',1,'No')"));
 await assert.rejects(db.query('select admin_save_catalog($1::jsonb,$2::jsonb)',['[]','[]']));
 await assert.rejects(db.exec("insert into achievement_notes values(102,'1.1','No')"));
 await assert.rejects(db.exec("insert into achievement_notes values(101,'missing','No')"));
 await login(102);
 assert.equal((await scalar('select count(*)::int as n from achievement_notes')).n,0);
 assert.equal((await scalar('select count(*)::int as n from user_progress')).n,0);
 for(let i=0;i<67;i++)await db.query('insert into user_custom_achievements(telegram_user_id,text) values(102,$1)',['custom '+i]);
 await assert.rejects(db.exec("insert into user_custom_achievements(telegram_user_id,text) values(102,'68')"),/67/);
 const custom=(await scalar('select id from user_custom_achievements limit 1')).id;
 await db.query('insert into achievement_notes values(102,$1,$2)',[custom,'own custom note']);
 await db.query('delete from user_custom_achievements where id=$1',[custom]);
 assert.equal((await scalar('select count(*)::int as n from achievement_notes')).n,0);
 await login(101,false);
 assert.equal((await scalar('select count(*)::int as n from achievement_catalog')).n,0);
 assert.equal((await scalar('select is_app_admin() as admin')).admin,false);
 await login(999);
 assert.equal((await scalar('select is_app_admin() as admin')).admin,true);
 const a={id:'test.a',branch_id:1,order:99,title:'Test A',description:'',requires:null};
 await db.query('select admin_save_catalog($1::jsonb)',[JSON.stringify([a,{...a,id:'test.b',requires:'test.a'}])]);
 await assert.rejects(db.query('select admin_save_catalog($1::jsonb)',[JSON.stringify([{...a,requires:'test.b'}])]),/Циклическая/);
 await assert.rejects(db.query('select admin_save_catalog($1::jsonb)',[JSON.stringify([{...a,active:false}])]),/Предшественник/);
 await assert.rejects(db.query('select admin_save_catalog($1::jsonb)',[JSON.stringify([{...a,requires:'2.1'}])]),/Предшественник/);
 await login(101);
 const before=(await scalar('select ratio from branch_visual_progress where branch_id=1')).ratio;
 await db.exec("insert into user_progress(telegram_user_id,achievement_id) values(101,'test.b')");
 assert.ok((await scalar('select ratio from branch_visual_progress where branch_id=1')).ratio>before);
 assert.equal((await scalar("select count(*)::int as n from user_progress where achievement_id='test.a'")).n,0);
 await db.exec("delete from user_progress where achievement_id='test.b'");
 assert.ok(Math.abs((await scalar('select ratio from branch_visual_progress where branch_id=1')).ratio-before)<1e-10);
 await db.close();
});
