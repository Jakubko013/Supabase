// Správa předplatného (faktury, karta, zrušení) na stránce Stripe. Jen pro správce klubu.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://volleystat.cz/app/';
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://volleystat.cz,https://www.volleystat.cz,http://localhost:5173').split(',');

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

    const admin = createClient(url, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const { data: member } = await admin.from('club_members').select('club_id, role').eq('user_id', user.id).maybeSingle();
    if (!member || member.role !== 'admin') return json(req, { error: 'Platby spravuje jen správce klubu.' }, 403);
    const { data: club } = await admin.from('clubs').select('stripe_customer_id').eq('id', member.club_id).single();
    if (!club?.stripe_customer_id) return json(req, { error: 'Klub zatím nemá žádné platby.' }, 404);

    const session = await stripe.billingPortal.sessions.create({ customer: club.stripe_customer_id, return_url: `${SITE_URL}#/club`, locale: 'cs' });
    return json(req, { url: session.url });
  } catch (e) {
    console.error('portal', e);
    return json(req, { error: 'Správu plateb se nepodařilo otevřít.' }, 500);
  }
});
