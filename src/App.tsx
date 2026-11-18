import { useEffect, useRef, useState } from 'react';
import { useTelegramAuth, isDemo } from './hooks/useTelegramAuth';
import { useAppData } from './hooks/useAppData';
import { TreeHome } from './components/TreeHome';
import { AchievementGraph } from './components/AchievementGraph';
import { AdminPanel } from './components/AdminPanel';
import { shareCard } from './lib/shareCard';
import { decodeAchievement } from './lib/sharing';
import { getTelegramWebApp } from './lib/telegram';
export default function App() {
 const auth=useTelegramAuth(), app=useAppData(auth.identity?.telegramUserId??null);
 const {data,busy}=app;
 const [branch,setBranch]=useState<number|null>(null),[cloud,setCloud]=useState<number|null>(null),[selected,setSelected]=useState<string|null>(null),[admin,setAdmin]=useState(false),[draft,setDraft]=useState(''),[customText,setCustomText]=useState(''),[notice,setNotice]=useState('');
 const savingCard=useRef(false);
 const [saving,setSaving]=useState(false);
 const linked=useRef(false), card=useRef<HTMLElement>(null);
 useEffect(()=>{if(selected)card.current?.scrollIntoView({block:"nearest"});},[selected]);
 const branches=data.branches.filter(b=>b.active!==false), active=data.achievements.filter(a=>a.active!==false);
 const current=branches.find(b=>b.id===branch), personal=branch===15;
 const items=personal?data.custom.map((a,i)=>({id:a.id,branch_id:15,order:i+1,title:a.text,description:'',requires:null})):active.filter(a=>a.branch_id===branch);
 const completed=personal?Object.fromEntries(data.custom.map(a=>[a.id,a.status])):data.progress;
 const chosen=items.find(a=>a.id===selected);
 function leave(){if(chosen&&draft!==(data.notes[chosen.id]||'')&&!window.confirm('Заметка не сохранена. Выйти?'))return false;setSelected(null);setNotice('');return true;}
 function open(id:number){if(leave()){setBranch(id);setAdmin(false);}}
 useEffect(()=>{setDraft(selected?data.notes[selected]||'':'');},[selected]);
 useEffect(()=>{if(app.loading||!app.ready||linked.current||!auth.identity)return;linked.current=true;const params=new URLSearchParams(location.search);const start=getTelegramWebApp()?.initDataUnsafe.start_param||params.get('tgWebAppStartParam');const id=params.get('achievement')||(typeof start==='string'?decodeAchievement(start):null);if(id){const a=data.achievements.find(a=>a.id===id&&a.active!==false);if(a){setBranch(a.branch_id);setSelected(id);}else setNotice('Это достижение пока недоступно.');}},[app.loading,app.ready,auth.identity,data.achievements]);
 useEffect(()=>{const back=getTelegramWebApp()?.BackButton;if(!back)return;const handler=()=>{if(admin)setAdmin(false);else if(leave())setBranch(null);};if(branch!==null||admin)back.show();else back.hide();back.onClick(handler);return()=>back.offClick(handler);});
 if(auth.status!=='ready')return <main className="gate"><h1>Ачивки в реальной жизни</h1><p>{auth.status==='loading'?'Открываем дерево…':auth.error||'Открой миниапку через Telegram, чтобы сохранить свой прогресс.'}</p></main>;
 if(app.loading)return <main className="gate"><p>Собираем твоё дерево…</p></main>;
 if(!app.ready)return <main className="gate"><h1>Не удалось открыть дерево</h1><p role="alert">{app.error}</p><button onClick={()=>void app.reload().catch(e=>app.setError(e.message))}>Повторить загрузку</button></main>;
 const ratios={...data.visuals};for(const b of branches){if(ratios[b.id]===undefined){const list=active.filter(a=>a.branch_id===b.id);ratios[b.id]=list.length?list.filter(a=>data.progress[a.id]).length/list.length:0;}}
 return <main className="app">
 {isDemo&&<div className="demo">Демо · данные хранятся только в этом браузере</div>}
 <header><span className="brand">CHB</span><span className="counter">{active.filter(a=>data.progress[a.id]).length} / {active.length}</span></header>
 {app.error&&<div className="error" role="alert">{app.error}<button onClick={()=>{app.setError('');void app.reload().catch(e=>app.setError(e.message));}}>Повторить загрузку</button></div>}
 {notice&&!chosen&&<p className="notice" role="status">{notice}</p>}
 {admin?<AdminPanel achievements={data.achievements} branches={data.branches} busy={busy} onSave={app.saveCatalog} onClose={()=>setAdmin(false)}/>:branch===null?<>
 <TreeHome branches={branches} selected={cloud} ratios={ratios} onSelect={setCloud} onOpen={open}/>

 <div className="home-actions"><label>Все ветви<select value={cloud??""} onChange={e=>setCloud(e.target.value?Number(e.target.value):null)}><option value="" disabled>Выбрать ветвь…</option>{branches.map(b=><option key={b.id} value={b.id}>{b.title}</option>)}</select></label><button disabled={cloud===null} onClick={()=>{if(cloud!==null)open(cloud);}}>Перейти к ветви</button><button className="personal-home" onClick={()=>open(15)}>＋ Мои достижения <small>{data.custom.length}/67</small></button></div>
 </>:<section className="branch-screen" style={current?.background_url?{backgroundImage:`linear-gradient(#1b211ee6,#1b211ee6),url("${current.background_url.replaceAll('"','%22')}")`}:undefined}>
 <div className="toolbar"><button onClick={()=>{if(leave())setBranch(null);}}>← Дерево</button><span className="muted">{items.filter(a=>completed[a.id]).length} / {items.length}</span></div>
 <div className="branch-nav"><button aria-label="Предыдущая ветвь" onClick={()=>open(branches[(branches.findIndex(b=>b.id===branch)-1+branches.length)%branches.length].id)}>‹</button><select aria-label="Ветвь" value={branch} onChange={e=>open(Number(e.target.value))}>{branches.map(b=><option key={b.id} value={b.id}>{b.title}</option>)}</select><button aria-label="Следующая ветвь" onClick={()=>open(branches[(branches.findIndex(b=>b.id===branch)+1)%branches.length].id)}>›</button></div>
 <AchievementGraph items={items} title={current?.title||'Мои достижения'} selected={selected} completed={completed} onSelect={id=>{if(leave())setSelected(id);}}/>
 {personal&&<form className="custom-form" onSubmit={async e=>{e.preventDefault();if(await app.addCustom(customText))setCustomText('');}}><label>Своя ачивка · {data.custom.length}/67<input maxLength={280} required value={customText} onChange={e=>setCustomText(e.target.value)} placeholder="Что хочется однажды отметить?"/></label><button className="primary" disabled={busy||data.custom.length>=67||!customText.trim()}>Добавить</button></form>}
 {chosen&&<article ref={card} className="achievement-card" key={chosen.id}><button className="close" aria-label="Закрыть достижение" onClick={leave}>×</button><small>{completed[chosen.id]?'✓ ВЫПОЛНЕНО':'ЕЩЁ ВПЕРЕДИ'}</small><h2>{chosen.title}</h2><p>{chosen.description}</p>{chosen.requires&&<p className="muted">Продолжение: {active.find(a=>a.id===chosen.requires)?.title}</p>}<button className={'primary '+(completed[chosen.id]?'completed':'')} disabled={busy} onClick={()=>void(personal?app.toggleCustom(chosen.id):app.toggle(chosen.id))}>{completed[chosen.id]?'Снять отметку':'Выполнено'}</button>
 <details key={chosen.id+"-note"} className="note-editor"><summary>{data.notes[chosen.id]?"Редактировать заметку":"Добавить заметку"}</summary><label>Личная заметка<textarea maxLength={4000} value={draft} onChange={e=>setDraft(e.target.value)} placeholder="Когда это было? Что хочется запомнить?"/></label><button disabled={busy||draft===(data.notes[chosen.id]||'')} onClick={async()=>{if(await app.saveNote(chosen.id,draft))setNotice('Заметка сохранена');}}>Сохранить заметку</button></details><div className="card-actions">{!personal&&<button disabled={busy||saving} onClick={async()=>{
 if(savingCard.current)return;savingCard.current=true;setSaving(true);setNotice('');
 try{await shareCard(chosen.title,chosen.description);setNotice('Сохранено в чат');}
 catch(e){setNotice(e instanceof Error?e.message:'Не удалось сохранить ачивку.');}
 finally{savingCard.current=false;setSaving(false);}
}}>{saving?'Сохраняем…':'Сохранить ачивку'}</button>}{personal&&<button className="danger" disabled={busy} onClick={async()=>{if(window.confirm('Удалить личную ачивку?')&&await app.removeCustom(chosen.id))setSelected(null);}}>Удалить</button>}</div>{notice&&<p className="notice" role="status">{notice}</p>}</article>}
 </section>}
 {data.admin&&!admin&&<footer><button onClick={()=>{if(leave())setAdmin(true);}}>Мастерская</button></footer>}
 </main>;
}
