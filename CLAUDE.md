# Volejbal Statistika – kontext projektu

Komunikace s uživatelem česky, kód a identifikátory anglicky.

## Co to je
React 19 + TypeScript + Vite PWA pro zápis volejbalové statistiky (README.md). Nově: úvodní web na `/` a aplikace za přihlášením na `/app/`.
Základ vychází z `~/Downloads/volleyball-stat 2` (v1.1.0); originál se nemění.

## Stav (2026-11-04)
Hotovo a ověřeno (typecheck, 42 testů, build web i native):
- Supabase Auth e-mail + heslo, jen na pozvánku (`src/auth.ts`, `src/screens/Auth.tsx`, `src/password.ts`).
- Klient `src/supabase.ts`; env `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` (`.env.local`, gitignorováno; šablona `.env.example`).
- Data po uživatelích: `supabase/migrations/0001_init.sql` (RLS), synchronizace s offline frontou v `src/sync.ts`, cache oddělená podle uživatele v `src/storage.ts`, orchestrace v `src/App.tsx`.
- Úvodní web `index.html` + `public/site.css`, aplikace `app/index.html`, bezpečnostní hlavičky `public/_headers`, PWA scope `/app/` (`vite.config.ts`).

## Zbývá
- Uživatel musí v Supabase dashboardu provést kroky ze `supabase/README.md` (migrace, vypnutá registrace, e-mailové šablony, URL, politika hesel) a nastavit env na Netlify. Nic z toho zatím není ověřeno proti živé službě.
- Přihlášení proti skutečnému Supabase otestovat (pozvánka → nastavení hesla → zápas → druhé zařízení → RLS).
- MFA (TOTP), zvlášť pro admina.
- Android / iOS / Windows: auth zatím neřešen (native build jen zkopíruje `dist/app/index.html` do `dist/index.html`).
- Vzhled (barvy, branding) se doladí později.
- Otevřené body z `docs/AUDIT-2026-10.md` (dnes ve složce Downloads, ne v tomto projektu).

## Pravidla
- Do klienta nikdy `secret` / `service_role` klíč. Jen publishable.
- Zápasy mění jen funkce `apply` v `src/App.tsx` (jinak se změna neodešle na server).
- Před hotovo: `npx tsc --noEmit && npx vitest run && npm run build`.
- Necommitovat bez vyžádání.
