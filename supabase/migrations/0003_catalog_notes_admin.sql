-- Additive migration. Existing progress and custom achievement IDs are preserved.
create or replace function public.current_telegram_user_id() returns bigint
language plpgsql stable security definer set search_path=public,extensions as $$
declare uid bigint;
begin
 uid := (nullif(current_setting('request.headers',true),'')::jsonb->>'x-tg-id')::bigint;
 if uid > 0 and public.verify_tg_auth(uid) then return uid; end if;
 return null;
exception when others then return null;
end $$;
revoke all on function public.current_telegram_user_id() from public;
grant execute on function public.current_telegram_user_id() to anon,authenticated;
create table public.app_admins(telegram_user_id bigint primary key check(telegram_user_id>0));
alter table public.app_admins enable row level security;
revoke all on public.app_admins from anon,authenticated;
create function public.is_app_admin() returns boolean language sql stable security definer set search_path=public as $$
 select exists(select 1 from public.app_admins where telegram_user_id=public.current_telegram_user_id());
$$;
revoke all on function public.is_app_admin() from public;
grant execute on function public.is_app_admin() to anon,authenticated;
create table public.achievement_branches(
 id integer primary key check(id>0),title text not null check(length(trim(title)) between 1 and 240),sort_order integer not null default 0,
 color text,background_url text check(background_url is null or background_url ~ '^(https://|art/)'),active boolean not null default true
);
create table public.achievement_catalog(
 id text primary key check(id <> '__root__' and id ~ '^[a-zA-Z0-9._-]{1,46}$'), branch_id integer not null references public.achievement_branches(id) check(branch_id<>15),
 "order" integer not null default 0 check("order">=0),title text not null check(length(trim(title)) between 1 and 240),description text not null default '' check(length(description)<=3000),
 requires text references public.achievement_catalog(id) deferrable initially deferred,
 icon_url text check(icon_url is null or icon_url ~ '^(https://|art/)'),active boolean not null default true,
 check(requires is null or requires<>id)
);
alter table public.achievement_branches enable row level security;
alter table public.achievement_catalog enable row level security;
create policy "verified catalog branches" on public.achievement_branches for select using(public.current_telegram_user_id() is not null and (active or public.is_app_admin()));
create policy "verified catalog" on public.achievement_catalog for select using(public.current_telegram_user_id() is not null and (active or public.is_app_admin()));
revoke all on public.achievement_branches,public.achievement_catalog from anon,authenticated;
grant select on public.achievement_branches,public.achievement_catalog to anon,authenticated;
create table public.achievement_notes(
 telegram_user_id bigint not null,achievement_id text not null,note text not null default '' check(length(note)<=4000),primary key(telegram_user_id,achievement_id)
);
alter table public.achievement_notes enable row level security;
create policy "private notes" on public.achievement_notes for all using(telegram_user_id=public.current_telegram_user_id()) with check(telegram_user_id=public.current_telegram_user_id() and (exists(select 1 from public.achievement_catalog where id=achievement_id) or exists(select 1 from public.user_custom_achievements where id::text=achievement_id and telegram_user_id=public.current_telegram_user_id())));
grant select,insert,update,delete on public.achievement_notes to anon,authenticated;
create table public.branch_visual_progress(
 telegram_user_id bigint not null,branch_id integer not null references public.achievement_branches(id),ratio double precision not null default 0 check(ratio between 0 and 1),primary key(telegram_user_id,branch_id)
);
alter table public.branch_visual_progress enable row level security;
create policy "own foliage" on public.branch_visual_progress for select using(telegram_user_id=public.current_telegram_user_id());
revoke all on public.branch_visual_progress from anon,authenticated;
grant select on public.branch_visual_progress to anon,authenticated;
create function public.enforce_custom_limit() returns trigger language plpgsql security definer set search_path=public as $$
begin
 perform pg_advisory_xact_lock(hashtextextended('custom:'||new.telegram_user_id::text,0));
 if (select count(*) from public.user_custom_achievements where telegram_user_id=new.telegram_user_id and id<>new.id)>=67 then raise exception 'Лимит: 67 личных достижений'; end if;
 return new;
end $$;
create trigger custom_limit before insert or update of telegram_user_id on public.user_custom_achievements for each row execute function public.enforce_custom_limit();
create function public.update_foliage_progress() returns trigger language plpgsql security definer set search_path=public as $$
declare uid bigint;aid text;bid integer;total integer;actual double precision;step double precision;
begin
 if TG_OP='DELETE' then uid:=old.telegram_user_id;aid:=old.achievement_id;else uid:=new.telegram_user_id;aid:=new.achievement_id;end if;
 select branch_id into bid from public.achievement_catalog where id=aid and active;
 if bid is null then return null;end if;
 perform pg_advisory_xact_lock(hashtextextended('foliage:'||uid::text||':'||bid::text,0));
 select count(*) into total from public.achievement_catalog where branch_id=bid and active;
 select count(*)::double precision / greatest(total,1) into actual from public.user_progress p join public.achievement_catalog a on a.id=p.achievement_id where p.telegram_user_id=uid and a.branch_id=bid and a.active;
 step:=case when TG_OP='DELETE' then -1.0 else 1.0 end/greatest(total,1);
 insert into public.branch_visual_progress(telegram_user_id,branch_id,ratio) values(uid,bid,actual)
 on conflict(telegram_user_id,branch_id) do update set ratio=least(1,greatest(actual,public.branch_visual_progress.ratio+step));
 return null;
end $$;
create trigger foliage_progress after insert or delete on public.user_progress for each row execute function public.update_foliage_progress();
create function public.clean_custom_notes() returns trigger language plpgsql security definer set search_path=public as $$
begin delete from public.achievement_notes where telegram_user_id=old.telegram_user_id and achievement_id=old.id::text;return old;end $$;
create trigger remove_custom_notes after delete on public.user_custom_achievements for each row execute function public.clean_custom_notes();
create function public.admin_save_catalog(p_achievements jsonb default '[]',p_branches jsonb default '[]') returns void
language plpgsql security definer set search_path=public as $$
declare row jsonb;
begin
 if not public.is_app_admin() then raise exception 'Доступ только для администратора';end if;
 if jsonb_typeof(p_achievements)<>'array' or jsonb_typeof(p_branches)<>'array' or jsonb_array_length(p_achievements)>300 or jsonb_array_length(p_branches)>50 then raise exception 'Некорректный список';end if;
 perform pg_advisory_xact_lock(hashtextextended('catalog-edit',0));
 for row in select * from jsonb_array_elements(p_branches) loop
 insert into public.achievement_branches(id,title,sort_order,color,background_url,active) values((row->>'id')::integer,row->>'title',coalesce((row->>'sort_order')::integer,(row->>'id')::integer),row->>'color',nullif(row->>'background_url',''),coalesce((row->>'active')::boolean,true))
 on conflict(id) do update set title=excluded.title,sort_order=excluded.sort_order,color=excluded.color,background_url=excluded.background_url,active=excluded.active;
 end loop;
 for row in select * from jsonb_array_elements(p_achievements) loop
 insert into public.achievement_catalog(id,branch_id,"order",title,description,requires,icon_url,active) values(row->>'id',(row->>'branch_id')::integer,coalesce((row->>'order')::integer,0),row->>'title',coalesce(row->>'description',''),nullif(row->>'requires',''),nullif(row->>'icon_url',''),coalesce((row->>'active')::boolean,true))
 on conflict(id) do update set branch_id=excluded.branch_id,"order"=excluded."order",title=excluded.title,description=excluded.description,requires=excluded.requires,icon_url=excluded.icon_url,active=excluded.active;
 end loop;
 if exists(select 1 from public.achievement_catalog a left join public.achievement_catalog p on a.requires=p.id where a.requires is not null and (p.id is null or a.branch_id<>p.branch_id or (a.active and not p.active))) then raise exception 'Предшественник должен существовать в той же ветви и быть видимым';end if;
 if exists(with recursive walk as(select id,requires,array[id] as path,false as cycle from public.achievement_catalog union all select w.id,a.requires,w.path||a.id,a.id=any(w.path) from walk w join public.achievement_catalog a on a.id=w.requires where not w.cycle) select 1 from walk where cycle) then raise exception 'Циклическая связь достижений';end if;
end $$;
revoke all on function public.admin_save_catalog(jsonb,jsonb) from public;
grant execute on function public.admin_save_catalog(jsonb,jsonb) to anon,authenticated;
revoke all on function public.enforce_custom_limit(),public.update_foliage_progress(),public.clean_custom_notes() from public;
