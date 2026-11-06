// Pozvání člena do klubu. Jen správce, jen s platnou licencí, nejvýše `seats` členů.
import { createClient } from 'npm:@supabase/supabase-js@2';

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://volleystat.cz/app/';
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://volleystat.cz,https://www.volleystat.cz,http://localhost:5173').split(',');
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

const cors = (req: Request) => {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
};
const json = (req: Request, body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return json(req, { error: 'Nepovolená metoda.' }, 405);
  try {
    const url = Deno.env.get('SUPABASE_URL')!;
    const asUser = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, { global: { headers: { Authorization: req.headers.get('Authorization') ?? '' } } });
    const { data: { user } } = await asUser.auth.getUser();
    if (!user) return json(req, { error: 'Přihlaste se prosím znovu.' }, 401);

    const { email: raw } = await req.json().catch(() => ({}));
    const email = typeof raw === 'string' ? raw.trim().toLowerCase() : '';
    if (!EMAIL.test(email) || email.length > 254) return json(req, { error: 'Zadejte platný e-mail.' }, 400);

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: me } = await admin.from('club_members').select('club_id, role').eq('user_id', user.id).maybeSingle();
    if (!me || me.role !== 'admin') return json(req, { error: 'Členy zve jen správce klubu.' }, 403);
    const { data: club } = await admin.from('clubs').select('seats, license_until').eq('id', me.club_id).single();
    if (!club?.license_until || new Date(club.license_until) <= new Date()) return json(req, { error: 'Členy lze zvát jen s platnou licencí.' }, 402);
    const { count } = await admin.from('club_members').select('user_id', { count: 'exact', head: true }).eq('club_id', me.club_id);
    if ((count ?? 0) >= club.seats) return json(req, { error: `Licence je pro nejvýše ${club.seats} lidi.` }, 409);

    const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: SITE_URL });
    if (error || !invited.user) {
      // Účet už existuje – do klubu ho nepřevádíme automaticky (mohl by mít vlastní zápasy).
      const exists = error?.status === 422 || /already/i.test(error?.message ?? '');
      return json(req, { error: exists ? 'Tento e-mail už má účet. Napište nám a člena do klubu převedeme.' : 'Pozvánku se nepodařilo odeslat.' }, exists ? 409 : 500);
    }
    const { error: insErr } = await admin.from('club_members').insert({ club_id: me.club_id, user_id: invited.user.id, role: 'member', email });
    if (insErr) {
      console.error('invite insert', insErr);
      return json(req, { error: 'Člena se nepodařilo přidat do klubu.' }, 500);
    }
    return json(req, { ok: true });
  } catch (e) {
    console.error('invite', e);
    return json(req, { error: 'Pozvánku se nepodařilo odeslat.' }, 500);
  }
});
