# VolleyStat

[![CI](https://github.com/Jakubko013/supabase/actions/workflows/ci.yml/badge.svg?branch=supabase)](https://github.com/Jakubko013/supabase/actions/workflows/ci.yml)

**[volleystat.cz](https://volleystat.cz)**: aplikace pro zápis volejbalové statistiky přímo během zápasu. Je navržená pro iPad u lavičky: jedno klepnutí zapíše jednu akci. Funguje i bez internetu a soupisky si sama stáhne z webu Českého volejbalového svazu. Zápasy se ukládají do účtu klubu a synchronizují mezi zařízeními. Aplikace se prodává jako roční klubová licence.

> **In English:** A volleyball scouting web app (React + TypeScript) with accounts, club licences and cloud sync on Supabase, payments via Stripe and hosting on Netlify. Every action is one tap, it keeps working offline, rosters are scraped from the Czech Volleyball Federation and match stats export to PDF/CSV. Android (Capacitor) and Windows (Electron) builds come from the same codebase.

| Zápis zápasu | Statistiky |
| --- | --- |
| ![Zápis zápasu na iPadu](docs/screenshots/zapis.png) | ![Statistiky po zápase](docs/screenshots/statistiky.png) |

| Soupiska | Export do PDF |
| --- | --- |
| ![Výběr hráčů na zápas](docs/screenshots/soupiska.png) | ![Statistika v PDF](docs/screenshots/pdf.png) |

*Snímky používají smyšlená jména z ukázkového zápasu.*

## Co aplikace umí

### Zápis a statistika
- **Soupisky z cvf.cz.** Aplikace načte soutěže dospělých pro aktuální sezónu. Po výběru týmu stáhne soupisku i s čísly dresů a posty. Chybějící čísla si pamatuje pro další zápasy.
- **Zápis jedním klepnutím** pro náš tým i pro soupeře:
  - podání (eso, v poli, chyba),
  - přihrávka,
  - útok (celkem, bod, chyba, zablokován),
  - blok a ostatní chyby.
- **Automatické skóre a sety.** Aplikace pozná konec setu podle pravidel (25 bodů, tie-break 15, rozdíl 2), ukazuje, kdo podává, a umí vrátit poslední akci.
- **Střídání podle pravidel.** Hráč a náhradník tvoří dvojici a smí se střídat jen mezi sebou. Na set je 8 střídání, libero se nepočítá.
- **Statistiky za zápas i po setech.** Sloupce jdou řadit, nejlepší hodnoty se zvýrazní. Export do PDF (sdílení přes WhatsApp, e-mail atd.), CSV a do schránky.

### Účty, kluby a licence
- **Úvodní web** na `/` s ukázkou, ceníkem a častými dotazy. Aplikace za přihlášením běží na `/app/`.
- **Registrace e-mailem a heslem:**
  - potvrzení e-mailem;
  - kontrola síly hesla a toho, zda heslo neuniklo (Have I Been Pwned, odesílá se jen 5 znaků otisku);
  - obnovení hesla.
  - Po odhlášení zůstane přihlašovací formulář prázdný.
- **Zkušební verze zdarma:** 2 zápasy. Export PDF a CSV je až s licencí.
- **Klubová licence** stojí 4 000 Kč na 12 měsíců a zahrnuje:
  - neomezený počet zápasů;
  - až 3 členy klubu, kteří se zvou e-mailem (nejvýš 6 pozvánek za období);
  - automatické obnovení předplatného.
  - Po vypršení licence lze data jen číst.
- **Platby přes Stripe** (karta, Apple Pay, Google Pay):
  - souhlas s obchodními podmínkami už v pokladně;
  - faktury a zrušení předplatného přes Stripe Customer Portal;
  - ochrana proti dvojímu nákupu;
  - po vrácení peněz se licence sama ukončí.
- **Smazání účtu** přímo v aplikaci (Klub → Smazat účet). Předplatné se při tom zruší.

### Synchronizace a provoz
- **Cloud po klubech.** Zápasy se ukládají do databáze klubu a stahují se na všechna zařízení.
- **Offline fronta.** Bez internetu se změny řadí do fronty vázané na klub a odešlou se po připojení.
- **Varování při souběžné úpravě.** Když stejný zápas právě upravuje jiný člen klubu, aplikace na to upozorní.
- **Vždy aktuální verze.** Aplikace nemá service worker ani offline cache (starý se sám odregistruje). HTML se nekešuje a podle `/app/version.json` se při nové verzi jednou obnoví.
- **Právní stránky:** [ochrana osobních údajů](public/soukromi.html) a [obchodní podmínky](public/obchodni-podminky.html).

## Bezpečnost

- **Přístup hlídá databáze.** Row Level Security pustí každého jen k datům jeho klubu. Limity zkušební verze, počet členů i režim jen pro čtení po vypršení vynucuje databáze, ne klient.
- **Klient zná jen veřejný (publishable) klíč.** Tajné klíče (Stripe, Supabase secret) jsou jen v Edge Function.
- **Jediná Edge Function `club-api`** obstarává pokladnu, zákaznický portál, pozvánky a smazání účtu. Přijímá i webhook Stripe s ověřeným podpisem `Stripe-Signature` a hlídá povolené originy.
- **Ochrana registrace** proti opakovanému zakládání zkušebních účtů:
  - Auth Hook „Before User Created“ blokuje jednorázové schránky a aliasy už registrované adresy (`jan+1@gmail.com`, `j.an@gmail.com`);
  - z jedné IP adresy jdou založit nejvýš 3 účty za 30 dní;
  - Cloudflare Turnstile ověřuje, že formulář vyplňuje člověk.
- **Hlavičky na Netlify:** CSP, HSTS, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy` (`public/_headers`). Stará adresa Netlify přesměruje na volleystat.cz kódem 301.

## Architektura

```
Prohlížeč (React PWA)  ──►  Netlify (web, /cvf proxy, hlavičky)
        │
        ├──►  Supabase Auth  (e-mail + heslo, SMTP Resend, Turnstile, Auth Hook)
        ├──►  Supabase Postgres + RLS  (kluby, členové, zápasy)
        └──►  Edge Function club-api  ──►  Stripe (Checkout, Portal)
                        ▲
                Stripe webhook (platba, obnovení, refundace, zrušení)
```

| Služba | Použití |
| --- | --- |
| **Supabase** (EU, Stockholm) | Postgres, Auth, Edge Functions |
| **Stripe** | Platby, předplatné, faktury |
| **Netlify** | Hosting, DNS, proxy na cvf.cz |
| **Resend** | Transakční e-maily z `noreply@volleystat.cz` |
| **Cloudflare Turnstile** | Ochrana formulářů před roboty |
| **ImprovMX** | Přeposílání `info@volleystat.cz` |

## Technologie

- **React 19 + TypeScript** (strict), **Vite**. Žádná UI knihovna, vlastní CSS s tokeny.
- **Supabase JS** pro Auth, databázi a volání Edge Function. **Deno + Stripe SDK** na serveru.
- **Capacitor** pro iOS a Android, **Electron** pro Windows.
- **Vitest** pro testy logiky (45 testů). **GitHub Actions** pro testy a buildy Android, iOS a Windows.

## Zajímavá řešení

- **Zápas jako seznam akcí (event sourcing).** Ukládají se jen jednotlivé akce. Skóre, sety, podání i všechny statistiky se z nich dopočítají, takže vracení akcí je triviální a data jsou vždy konzistentní ([`src/stats.ts`](src/stats.ts)). Zápas mění jen funkce `apply` v [`src/App.tsx`](src/App.tsx), a ta zároveň řadí změnu k odeslání na server.
- **Jedna výměna zapsaná z obou stran.** Když se zapíše naše eso i chyba přihrávky soupeře, bod se započítá jen jednou.
- **Licence v databázi.** Funkce `club_can_write` a `club_can_save_match` v RLS pravidlech rozhodují, kdo smí zapisovat. Trigger počítá založené zápasy zkušební verze, takže limit nejde obejít smazáním zápasu ([`supabase/migrations/0002_clubs.sql`](supabase/migrations/0002_clubs.sql)).
- **Webhook i API v jedné funkci.** Požadavek se pozná podle hlavičky `Stripe-Signature`. Události `invoice.paid` prodlužují licenci, `charge.refunded` ji ukončí a zruší předplatné ([`supabase/functions/club-api/index.ts`](supabase/functions/club-api/index.ts)).
- **Stahování z cvf.cz bez vlastního backendu.** Prohlížeč nesmí cvf.cz volat přímo (CORS), proto každá platforma jde jinou cestou ([`src/cvf.ts`](src/cvf.ts)):
  - web přes přepis na Netlify;
  - Windows přes hlavní proces Electronu;
  - Android přes nativní HTTP Capacitoru.
- **PDF bez knihovny.** Tabulka se vykreslí do canvasu, takže česká diakritika funguje bez vkládání fontů. Pak se vloží do ručně sestaveného PDF ([`src/pdf.ts`](src/pdf.ts)).
- **Rozložení pro iPad.** Oba týmy (2 × 7 hráčů) se vejdou bez posouvání i na iPad mini.
- **Přístupnost.** Popisky pro čtečky obrazovky, viditelný fokus, dostatečně velké dotykové cíle a respektování „omezit pohyb“.

## Spuštění

```bash
npm install
cp .env.example .env   # nebo vytvořte .env ručně, viz níže
npm run dev            # http://localhost:5173
npx tsc --noEmit && npx vitest run && npm run build   # kontrola před nasazením
```

### Proměnné prostředí (klient, veřejné)

| Proměnná | Význam |
| --- | --- |
| `VITE_SUPABASE_URL` | URL projektu Supabase |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Publishable klíč (nikdy ne secret / service_role) |
| `VITE_TURNSTILE_SITE_KEY` | Veřejný klíč Cloudflare Turnstile (bez něj se widget nezobrazí) |
| `VITE_FN_CLUB_API` | Slug Edge Function (výchozí `hyper-processor`) |
| `VITE_CVF_PROXY` | Adresa proxy na cvf.cz při jiném hostingu než Netlify |

### Secrets Edge Function (jen v Supabase)

`STRIPE_SECRET_KEY`, `STRIPE_PRICE_ID`, `STRIPE_WEBHOOK_SECRET`, `SITE_URL`, `ALLOWED_ORIGINS`. Klíč Supabase si funkce bere z `SUPABASE_SECRET_KEYS`, případně z `SUPABASE_SERVICE_ROLE_KEY`.

## Struktura

| Soubor | Účel |
| --- | --- |
| `index.html`, `public/site.css`, `public/site.js` | Úvodní web s ceníkem |
| `app/index.html`, `src/main.tsx` | Vstup aplikace, kontrola verze |
| `src/App.tsx` | Stav aplikace, routy, funkce `apply` |
| `src/auth.ts`, `src/screens/Auth.tsx` | Přihlášení, registrace, obnovení hesla |
| `src/club.ts`, `src/screens/ClubView.tsx` | Klub, licence, členové, platby, smazání účtu |
| `src/sync.ts` | Synchronizace po klubech, offline fronta |
| `src/components/Turnstile.tsx` | Ochrana proti robotům |
| `src/stats.ts`, `src/subs.ts`, `src/report.ts` | Skóre, statistiky, střídání, tabulky a CSV |
| `src/pdf.ts`, `src/cvf.ts`, `src/backup.ts` | Export PDF, soupisky z cvf.cz, zálohy |
| `supabase/migrations/0001–0004` | Schéma: zápasy, kluby a licence, audit úprav, ochrana registrace |
| `supabase/functions/club-api/` | Edge Function: Stripe pokladna, portál, pozvánky, webhook |
| `public/_headers`, `public/_redirects` | Bezpečnostní hlavičky, cache, přesměrování, proxy cvf.cz |
| `public/soukromi.html`, `public/obchodni-podminky.html` | Právní informace |
| `electron/`, `ios/`, `android/` | Nativní aplikace |

## Nasazení

- **Web:** Netlify je napojené na větev `supabase` a po pushnutí ji samo nasadí (nastavení v `netlify.toml`). Proměnné `VITE_*` se nastavují v Netlify.
- **Supabase:**
  1. spustit migrace,
  2. zapnout Auth Hook „Before User Created“,
  3. nastavit SMTP a Turnstile,
  4. nasadit Edge Function a webhook Stripe.

  Postup krok za krokem je v [`supabase/README.md`](supabase/README.md).
- **Android / iOS / Windows:** sestavují se ve workflows v `.github/workflows/`. Lokálně:
  - `npm run android:sync && npx cap open android`
  - `npm run build:native && npx cap sync ios && npx cap open ios`
  - `npm run electron:build`

  Nativní verze zatím neřeší přihlášení ani licence.
