import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string | undefined;

/** Typ odkazu z e-mailu (pozvánka / reset hesla) – musí se přečíst dřív, než Supabase hash z adresy odstraní. */
const hashParams = new URLSearchParams(window.location.hash.replace(/^#\/?/, ''));
export const initialHashLinkType = hashParams.get('type');

/** Bez konfigurace (např. chybějící env při buildu) se aplikace nespustí – nikdy nepadá do „nepřihlášeného“ provozu. */
export const supabase = url && key ? createClient(url, key, { auth: { persistSession: true, autoRefreshToken: true, storageKey: 'vs:auth' } }) : null;
