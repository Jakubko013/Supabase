// Nákup klubové licence: vytvoří platební stránku Stripe (předplatné na 12 měsíců).
// Volá jen přihlášený správce klubu. Tajné klíče jsou v Supabase → Edge Functions → Secrets.
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
    if (!member || member.role !== 'admin') return json(req, { error: 'Licenci může koupit jen správce klubu.' }, 403);
    const { data: club } = await admin.from('clubs').select('id, license_until, stripe_customer_id, stripe_subscription_id').eq('id', member.club_id).single();
    if (!club) return json(req, { error: 'Klub nenalezen.' }, 404);
    if (club.stripe_subscription_id && club.license_until && new Date(club.license_until) > new Date())
      return json(req, { error: 'Licence je aktivní. Spravujte ji v části Platby a faktury.' }, 409);

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: Deno.env.get('STRIPE_PRICE_ID')!, quantity: 1 }],
      client_reference_id: club.id,
      metadata: { club_id: club.id },
      subscription_data: { metadata: { club_id: club.id } },
      ...(club.stripe_customer_id ? { customer: club.stripe_customer_id } : { customer_email: user.email }),
      billing_address_collection: 'required',
      tax_id_collection: { enabled: true },
      ...(club.stripe_customer_id ? { customer_update: { address: 'auto', name: 'auto' } } : {}),
      locale: 'cs',
      success_url: `${SITE_URL}?checkout=success#/club`,
      cancel_url: `${SITE_URL}#/club`,
    });
    return json(req, { url: session.url });
  } catch (e) {
    console.error('checkout', e);
    return json(req, { error: 'Platbu se nepodařilo připravit. Zkuste to znovu.' }, 500);
  }
});
