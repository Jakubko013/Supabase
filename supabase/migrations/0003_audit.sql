-- Volejbal Statistika: úpravy po auditu.
-- 1) Kdo zápas naposledy upravil – aplikace varuje, když zápas souběžně zapisuje jiný člen klubu.
-- 2) Počítadlo pozvánek v aktuálním licenčním období – licence je pro 3 lidi, ne pro neomezenou „rotaci“ členů.

alter table public.matches add column updated_by uuid references auth.users (id) on delete set null;

-- Hodnotu nastavuje databáze podle přihlášeného uživatele, klient ji nepodvrhne.
create function public.stamp_match_editor() returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_by := (select auth.uid());
  return new;
end $$;
revoke all on function public.stamp_match_editor() from public, anon, authenticated;
create trigger matches_stamp_editor before insert or update on public.matches for each row execute function public.stamp_match_editor();

-- Pozvánky odeslané v aktuálním licenčním období; po zaplacení dalšího období je server vynuluje.
alter table public.clubs add column invites_used int not null default 0;
