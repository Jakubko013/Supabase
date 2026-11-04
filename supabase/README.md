# Nastavení Supabase (jednorázově)

1. **Databáze:** SQL Editor → vložit a spustit `migrations/0001_init.sql`.
2. **Authentication → Sign In / Providers → Email:** zapnout Email, vypnout **Allow new users to sign up** (přístup jen na pozvánku), ponechat Confirm email.
3. **Authentication → Policies (Password):** minimální délka 12, vyžadovat malá/velká písmena a číslice, zapnout **Prevent use of leaked passwords** (je-li v plánu dostupné).
4. **Authentication → URL Configuration:** Site URL = adresa webu, Redirect URLs = `https://<doména>/app/` a `http://localhost:5173/app/`.
5. **Authentication → Email Templates:** odkaz musí vést přímo na aplikaci (ověření proběhne v prohlížeči):
   - Invite user: `<a href="{{ .SiteURL }}/app/?token_hash={{ .TokenHash }}&type=invite">Nastavit heslo</a>`
   - Reset password: `<a href="{{ .SiteURL }}/app/?token_hash={{ .TokenHash }}&type=recovery">Nastavit nové heslo</a>`
6. **Authentication → Rate Limits:** ponechat výchozí, případně zpřísnit sign-ins.
7. **Pozvání uživatele:** Authentication → Users → Invite user.
8. **Netlify → Environment variables:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (publishable klíč smí být veřejný; `secret` / `service_role` nikdy do klienta ani do repozitáře).
