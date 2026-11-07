-- Volejbal Statistika: ochrana zkušební verze proti opakovanému zakládání účtů.
-- Kontrolu provádí Auth Hook „Before User Created“ (Supabase → Authentication → Auth Hooks → Postgres function
-- public.hook_before_user_created). Odmítne:
--   • jednorázové e-mailové schránky,
--   • aliasy už registrované adresy (jan+1@gmail.com, j.an@gmail.com = jan@gmail.com),
--   • víc než 3 nové účty z jedné IP adresy za 30 dní (pozvaní členové klubu se nepočítají).
-- IP adresy se ukládají jen kvůli této ochraně a po 30 dnech se mažou.

create table public.blocked_email_domains (domain text primary key);
create table public.signup_ips (ip inet not null, created_at timestamptz not null default now());
create index signup_ips_ip_time on public.signup_ips (ip, created_at);

-- Klient k tabulkám nemá žádný přístup (RLS bez pravidel).
alter table public.blocked_email_domains enable row level security;
alter table public.signup_ips enable row level security;
revoke all on public.blocked_email_domains, public.signup_ips from anon, authenticated, public;

insert into public.blocked_email_domains (domain) values
  ('10minutemail.com'), ('10minutemail.net'), ('20minutemail.com'), ('33mail.com'), ('anonaddy.me'), ('burnermail.io'),
  ('discard.email'), ('dispostable.com'), ('dropmail.me'), ('emailondeck.com'), ('fakeinbox.com'), ('fakemail.net'),
  ('getairmail.com'), ('getnada.com'), ('guerrillamail.com'), ('guerrillamail.net'), ('guerrillamail.org'), ('guerrillamail.biz'),
  ('guerrillamail.de'), ('guerrillamailblock.com'), ('grr.la'), ('sharklasers.com'), ('spam4.me'), ('pokemail.net'),
  ('harakirimail.com'), ('incognitomail.org'), ('inboxkitten.com'), ('jetable.org'), ('linshiyouxiang.net'), ('mail.tm'),
  ('mail-temp.com'), ('mailcatch.com'), ('maildrop.cc'), ('mailinator.com'), ('mailinator.net'), ('mailinator2.com'),
  ('mailnesia.com'), ('mailnull.com'), ('mailpoof.com'), ('mailsac.com'), ('mintemail.com'), ('moakt.com'), ('mohmal.com'),
  ('mytemp.email'), ('nada.email'), ('emailnax.com'), ('mvrht.net'), ('nowmymail.com'), ('one-time.email'), ('spamgourmet.com'),
  ('spambox.us'), ('spamdecoy.net'), ('tempail.com'), ('tempinbox.com'), ('temp-mail.org'), ('temp-mail.io'), ('tempmail.com'),
  ('tempmail.net'), ('tempmail.dev'), ('tempmailo.com'), ('tempr.email'), ('throwawaymail.com'), ('trashmail.com'),
  ('trashmail.de'), ('trashmail.net'), ('trash-mail.com'), ('wegwerfmail.de'), ('wegwerfmail.net'), ('yopmail.com'),
  ('yopmail.fr'), ('yopmail.net'), ('cool.fr.nf'), ('jetable.fr.nf'), ('courriel.fr.nf'), ('emltmp.com'), ('tmpmail.org'),
  ('tmpmail.net'), ('tmail.ws'), ('minuteinbox.com'), ('fexpost.com'), ('fexbox.org'), ('rover.info'), ('vomoto.com'),
  ('byom.de'), ('muellmail.com'), ('spambog.com'), ('spambog.de'), ('trbvm.com'), ('emailfake.com'), ('crazymailing.com'),
  ('mailto.plus'), ('tempmail.plus'), ('chitthi.in'), ('luxusmail.org'), ('tmails.net'), ('inboxbear.com'), ('mailforspam.com')
on conflict do nothing;

/** Kanonický tvar adresy: malá písmena, bez „+přípony“; u Gmailu i bez teček a googlemail.com = gmail.com. */
create function public.normalize_email(addr text) returns text language sql immutable set search_path = '' as $$
  select case
    when split_part(lower(addr), '@', 2) in ('gmail.com', 'googlemail.com')
      then replace(split_part(split_part(lower(addr), '@', 1), '+', 1), '.', '') || '@gmail.com'
    else split_part(split_part(lower(addr), '@', 1), '+', 1) || '@' || split_part(lower(addr), '@', 2)
  end
$$;

create function public.hook_before_user_created(event jsonb) returns jsonb language plpgsql set search_path = '' as $$
declare
  v_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
  v_domain text := split_part(v_email, '@', 2);
  v_invited boolean := coalesce(event -> 'user' -> 'user_metadata' ->> 'invited', '') = 'true'
                       or coalesce(event -> 'user' ->> 'invited_at', '') <> '';
  v_ip inet;
begin
  if v_email = '' then
    return '{}'::jsonb;
  end if;

  if exists (select 1 from public.blocked_email_domains d where v_domain = d.domain or v_domain like '%.' || d.domain) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400,
      'message', 'Jednorázové e-mailové adresy nelze použít. Zaregistrujte se prosím svým běžným e-mailem.'));
  end if;

  if exists (select 1 from auth.users u where public.normalize_email(u.email) = public.normalize_email(v_email)) then
    return jsonb_build_object('error', jsonb_build_object('http_code', 400,
      'message', 'Účet s touto e-mailovou adresou už existuje. Přihlaste se, nebo si obnovte heslo.'));
  end if;

  if not v_invited then
    begin
      v_ip := nullif(event -> 'metadata' ->> 'ip_address', '')::inet;
    exception when others then
      v_ip := null;
    end;
    if v_ip is not null then
      delete from public.signup_ips where created_at < now() - interval '30 days';
      if (select count(*) from public.signup_ips s where s.ip = v_ip) >= 3 then
        return jsonb_build_object('error', jsonb_build_object('http_code', 429,
          'message', 'Z této sítě bylo v poslední době založeno příliš mnoho účtů. Zkuste to později nebo nám napište na info@volleystat.cz.'));
      end if;
      insert into public.signup_ips (ip) values (v_ip);
    end if;
  end if;

  return '{}'::jsonb;
end $$;

-- Hook volá jen Supabase Auth.
revoke all on function public.hook_before_user_created(jsonb) from public, anon, authenticated;
grant usage on schema public to supabase_auth_admin;
grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
grant execute on function public.normalize_email(text) to supabase_auth_admin;
grant select on public.blocked_email_domains to supabase_auth_admin;
grant select, insert, delete on public.signup_ips to supabase_auth_admin;
create policy auth_admin_domains on public.blocked_email_domains for select to supabase_auth_admin using (true);
create policy auth_admin_ips on public.signup_ips for all to supabase_auth_admin using (true) with check (true);
