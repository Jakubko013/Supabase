-- Volejbal Statistika: klubové licence.
-- Zápasy a soupisky patří klubu; vidí je všichni jeho členové (max. `seats` lidí).
-- Licence: license_until > now() = plný přístup. Bez licence (NULL) = zkušební verze na 2 zápasy.
-- Licence, která vypršela = jen čtení. Licence nastavuje výhradně server (webhook Stripe přes service_role).

create table public.clubs (
  id                      uuid primary key default gen_random_uuid(),
  name                    text not null default 'Můj klub' check (char_length(name) between 1 and 120),
  seats                   int  not null default 3 check (seats between 1 and 50),
  license_until           timestamptz,
  matches_created         int  not null default 0,
  stripe_customer_id      text unique,
  stripe_subscription_id  text,
  created_at              timestamptz not null default now()
);

-- Každý uživatel je nejvýše v jednom klubu.
create table public.club_members (
  club_id     uuid not null references public.clubs (id) on delete cascade,
  user_id     uuid not null unique references auth.users (id) on delete cascade,
  role        text not null default 'member' check (role in ('admin', 'member')),
  email       text,
  created_at  timestamptz not null default now(),
  primary key (club_id, user_id)
);

alter table public.clubs enable row level security;
alter table public.club_members enable row level security;

-- ---------- Pomocné funkce (security definer: čtou tabulky bez RLS, vrací jen informace o volajícím) ----------

create function public.my_club_id() returns uuid language sql stable security definer set search_path = '' as $$
  select club_id from public.club_members where user_id = (select auth.uid())
$$;

create function public.is_club_admin() returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.club_members where user_id = (select auth.uid()) and role = 'admin')
$$;

/** Zápis: platná licence, nebo zkušební verze (licence nikdy nebyla). Po vypršení licence jen čtení. */
create function public.club_can_write(c uuid) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.clubs where id = c and (license_until is null or license_until > now()))
$$;

-- První přihlášení: založí uživateli vlastní klub ve zkušební verzi (pokud ještě v žádném není).
create function public.ensure_club() returns uuid language plpgsql security definer set search_path = '' as $$
declare
  uid uuid := (select auth.uid());
  cid uuid;
begin
  if uid is null then
    raise exception 'not authenticated';
  end if;
  select club_id into cid from public.club_members where user_id = uid;
  if cid is null then
    insert into public.clubs default values returning id into cid;
    insert into public.club_members (club_id, user_id, role, email)
      values (cid, uid, 'admin', (select email from auth.users where id = uid));
  end if;
  return cid;
end $$;

revoke all on function public.my_club_id(), public.is_club_admin(), public.club_can_write(uuid), public.ensure_club() from public, anon;
grant execute on function public.my_club_id(), public.is_club_admin(), public.club_can_write(uuid), public.ensure_club() to authenticated;

-- ---------- Převod stávajících dat: každý uživatel s daty dostane vlastní klub ----------

alter table public.matches add column club_id uuid references public.clubs (id) on delete cascade;
alter table public.rosters add column club_id uuid references public.clubs (id) on delete cascade;

do $$
declare
  r record;
  cid uuid;
begin
  for r in select user_id from public.matches union select user_id from public.rosters loop
    insert into public.clubs (matches_created) values ((select count(*) from public.matches where user_id = r.user_id)) returning id into cid;
    insert into public.club_members (club_id, user_id, role, email) values (cid, r.user_id, 'admin', (select email from auth.users where id = r.user_id));
    update public.matches set club_id = cid where user_id = r.user_id;
    update public.rosters set club_id = cid where user_id = r.user_id;
  end loop;
end $$;

-- Klíč je nově (club_id, id); user_id zůstává jako autor (po smazání účtu se zápas klubu neztratí).
drop policy matches_select on public.matches;
drop policy matches_insert on public.matches;
drop policy matches_update on public.matches;
drop policy matches_delete on public.matches;
drop policy rosters_select on public.rosters;
drop policy rosters_insert on public.rosters;
drop policy rosters_update on public.rosters;
drop policy rosters_delete on public.rosters;

alter table public.matches drop constraint matches_pkey;
alter table public.matches alter column club_id set not null;
alter table public.matches add primary key (club_id, id);
alter table public.matches alter column user_id drop not null;
alter table public.matches alter column user_id set default auth.uid();
alter table public.matches drop constraint matches_user_id_fkey;
alter table public.matches add constraint matches_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

alter table public.rosters drop constraint rosters_pkey;
alter table public.rosters alter column club_id set not null;
alter table public.rosters add primary key (club_id, team);
alter table public.rosters alter column user_id drop not null;
alter table public.rosters alter column user_id set default auth.uid();
alter table public.rosters drop constraint rosters_user_id_fkey;
alter table public.rosters add constraint rosters_user_id_fkey foreign key (user_id) references auth.users (id) on delete set null;

-- Počítadlo založených zápasů (zkušební verze) – mazáním se nevynuluje.
create function public.count_created_match() returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.clubs set matches_created = matches_created + 1 where id = new.club_id;
  return new;
end $$;
revoke all on function public.count_created_match() from public, anon, authenticated;
create trigger matches_count after insert on public.matches for each row execute function public.count_created_match();

/** Nový zápas: platná licence, nebo zkušební verze s méně než 2 založenými zápasy (počítají se i smazané).
    Úprava existujícího zápasu (upsert) projde vždy, když klub smí zapisovat. */
create function public.club_can_save_match(c uuid, match_id text) returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.clubs
    where id = c and (
      license_until > now()
      or (license_until is null and (matches_created < 2 or exists (select 1 from public.matches m where m.club_id = c and m.id = match_id)))
    )
  )
$$;

revoke all on function public.club_can_save_match(uuid, text) from public, anon;
grant execute on function public.club_can_save_match(uuid, text) to authenticated;

-- ---------- Přístupová pravidla ----------

create policy matches_select on public.matches for select to authenticated using (club_id = (select public.my_club_id()));
create policy matches_insert on public.matches for insert to authenticated
  with check (club_id = (select public.my_club_id()) and public.club_can_save_match(club_id, id));
create policy matches_update on public.matches for update to authenticated
  using (club_id = (select public.my_club_id()))
  with check (club_id = (select public.my_club_id()) and public.club_can_write(club_id));
create policy matches_delete on public.matches for delete to authenticated using (club_id = (select public.my_club_id()));

create policy rosters_select on public.rosters for select to authenticated using (club_id = (select public.my_club_id()));
create policy rosters_insert on public.rosters for insert to authenticated
  with check (club_id = (select public.my_club_id()) and public.club_can_write(club_id));
create policy rosters_update on public.rosters for update to authenticated
  using (club_id = (select public.my_club_id()))
  with check (club_id = (select public.my_club_id()) and public.club_can_write(club_id));
create policy rosters_delete on public.rosters for delete to authenticated using (club_id = (select public.my_club_id()));

-- Klub: členové vidí svůj klub; správce smí změnit jen název. Licenci a Stripe údaje mění jen server.
revoke all on public.clubs, public.club_members from anon, public;
grant select on public.clubs, public.club_members to authenticated;
grant update (name) on public.clubs to authenticated;
grant delete on public.club_members to authenticated;

create policy clubs_select on public.clubs for select to authenticated using (id = (select public.my_club_id()));
create policy clubs_update on public.clubs for update to authenticated
  using (id = (select public.my_club_id()) and (select public.is_club_admin()))
  with check (id = (select public.my_club_id()));

create policy members_select on public.club_members for select to authenticated using (club_id = (select public.my_club_id()));
-- Správce může odebrat člena (ne sebe); přidávání členů jen přes serverovou funkci (hlídá počet míst).
create policy members_delete on public.club_members for delete to authenticated
  using (club_id = (select public.my_club_id()) and (select public.is_club_admin()) and user_id <> (select auth.uid()));
