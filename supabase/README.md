# Nastavení Supabase (jednorázově)

1. **Databáze:** SQL Editor → vložit a spustit `migrations/0001_init.sql`.
2. **Authentication → Sign In / Providers → Email:** zapnout Email, vypnout **Allow new users to sign up** (přístup jen na pozvánku), ponechat Confirm email.
3. **Authentication → Policies (Password):** minimální délka 12, vyžadovat malá/velká písmena a číslice, zapnout **Prevent use of leaked passwords** (je-li v plánu dostupné).
4. **Authentication → URL Configuration:** Site URL = `https://volleystat.cz/app/` (adresa aplikace, končí `/app/`), Redirect URLs = `https://<doména>/app/` a `http://localhost:5173/app/`.
5. **Authentication → Email Templates:** odkaz musí vést přímo na aplikaci (ověření proběhne v prohlížeči):
   - Invite user: `<a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=invite">Nastavit heslo</a>`
   - Reset password: `<a href="{{ .SiteURL }}?token_hash={{ .TokenHash }}&type=recovery">Nastavit nové heslo</a>`
6. **Authentication → Rate Limits:** ponechat výchozí, případně zpřísnit sign-ins.
7. **Pozvání uživatele:** Authentication → Users → Invite user.
8. **Netlify → Environment variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable klíč smí být veřejný; `secret` / `service_role` nikdy do klienta ani do repozitáře).

## Klubové licence (Stripe) – zapnutí v tomto pořadí
1. **Vlastní SMTP (Resend)** musí fungovat – registrace posílá potvrzovací e-mail a výchozí limit Supabase jsou 2 e-maily/hod.
2. **SQL Editor → spustit `migrations/0002_clubs.sql`** (kluby, členové, licence, zkušební limit 2 zápasy). Hned potom nasadit novou verzi webu – stará verze aplikace s novou databází neukládá.
3. **Authentication → Sign In / Providers:** zapnout *Allow new users to sign up* (Confirm email nechat zapnuté).
4. **Stripe** (nejdřív Sandbox / Test mode):
   - Product catalog → produkt „Klubová licence VolleyStat“, cena **4 000 CZK, Recurring, Yearly** → zkopírovat Price ID (`price_…`).
   - Developers → Webhooks → endpoint `https://<projekt>.supabase.co/functions/v1/stripe-webhook`, události `checkout.session.completed`, `invoice.paid`, `customer.subscription.deleted` → Signing secret (`whsec_…`).
   - Settings → Business details (IČO, adresa); Settings → Invoices → patička „Nejsem plátce DPH.“; Settings → Billing → Customer portal zapnout (zrušení předplatného, faktury).
5. **Edge Functions → Secrets:** `STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL=https://volleystat.cz/app/` (volitelně `ALLOWED_ORIGINS`).
6. **Nasadit funkce** z `functions/` (`supabase functions deploy`, nebo Dashboard → Edge Functions → Deploy new function → Via editor): `checkout`, `portal`, `invite`, `stripe-webhook`. U **všech čtyř** vypnout **„Verify JWT“** – funkce si přihlášení ověřují samy, webhook ověřuje podpis Stripe.
7. Test: registrace → 2 zápasy → Klub → Koupit licenci (testovací karta `4242 4242 4242 4242`) → licence aktivní → pozvat člena.

Licenci ručně (např. pro sebe): `update clubs set license_until = now() + interval '1 year' where id = '<club_id>';`
