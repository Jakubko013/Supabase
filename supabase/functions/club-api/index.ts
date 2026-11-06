// VolleyStat – klubové akce v jedné funkci: { action: 'checkout' | 'portal' | 'invite' }.
// Volá jen přihlášený uživatel; přihlášení ověřuje funkce sama (Verify JWT na bráně vypnuté).
// Tajné klíče: Supabase → Edge Functions → Secrets (STRIPE_SECRET_KEY, STRIPE_PRICE_ID, SITE_URL).
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://volleystat.cz/app/';
const ORIGINS = (Deno.env.get('ALLOWED_ORIGINS') ?? 'https://volleystat.cz,https://www.volleystat.cz,http://localhost:5173').split(',');
const EMAIL = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,}$/;

/** Tajný klíč Supabase: nové klíče (SUPABASE_SECRET_KEYS = {"default": "sb_secret_…"}), jinak starý service_role. */
function secretKey(): string {
  try {
    const keys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>;
    const key = keys.default ?? Object.values(keys)[0];
    if (key) return key;
  } catch {
    // starý formát
  }
  return Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
}

let stripeClient: Stripe | null = null;
function stripe(): Stripe {
  const key = Deno.env.get('STRIPE_SECRET_KEY');
  if (!key) throw new Error('Chybí secret STRIPE_SECRET_KEY.');
  return (stripeClient ??= new Stripe(key, { httpClient: Stripe.createFetchHttpClient() }));
}

const cors = (req: Request) => {
  const origin = req.headers.get('Origin') ?? '';
  return {
    'Access-Control-Allow-Origin': ORIGINS.includes(origin) ? origin : ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
};

Deno.serve(async (req) => {
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json' } });
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors(req) });
  if (req.method !== 'POST') return json({ error: 'Nepovolená metoda.' }, 405);

  try {
    const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey());
    const token = (req.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
    const { data: { user } } = token ? await admin.auth.getUser(token) : { data: { user: null } };
    if (!user) return json({ error: 'Přihlaste se prosím znovu.' }, 401);

    const body = (await req.json().catch(() => ({}))) as { action?: string; email?: unknown };
    const { data: me } = await admin.from('club_members').select('club_id, role').eq('user_id', user.id).maybeSingle();
    if (!me || me.role !== 'admin') return json({ error: 'Tuto akci může provést jen správce klubu.' }, 403);
    const { data: club } = await admin
      .from('clubs')
      .select('id, seats, license_until, stripe_customer_id, stripe_subscription_id')
      .eq('id', me.club_id)
      .single();
    if (!club) return json({ error: 'Klub nenalezen.' }, 404);
    const active = !!club.license_until && new Date(club.license_until) > new Date();

    switch (body.action) {
      case 'checkout': {
        if (club.stripe_subscription_id && active) return json({ error: 'Licence je aktivní. Spravujte ji v části Platby a faktury.' }, 409);
        const price = Deno.env.get('STRIPE_PRICE_ID');
        if (!price) throw new Error('Chybí secret STRIPE_PRICE_ID.');
        const session = await stripe().checkout.sessions.create({
          mode: 'subscription',
          line_items: [{ price, quantity: 1 }],
          client_reference_id: club.id,
          metadata: { club_id: club.id },
          subscription_data: { metadata: { club_id: club.id } },
          ...(club.stripe_customer_id
            ? { customer: club.stripe_customer_id, customer_update: { address: 'auto' as const, name: 'auto' as const } }
            : { customer_email: user.email }),
          billing_address_collection: 'required',
          tax_id_collection: { enabled: true },
          locale: 'cs',
          success_url: `${SITE_URL}?checkout=success#/club`,
          cancel_url: `${SITE_URL}#/club`,
        });
        return json({ url: session.url });
      }

      case 'portal': {
        if (!club.stripe_customer_id) return json({ error: 'Klub zatím nemá žádné platby.' }, 404);
        const session = await stripe().billingPortal.sessions.create({ customer: club.stripe_customer_id, return_url: `${SITE_URL}#/club`, locale: 'cs' });
        return json({ url: session.url });
      }

      case 'invite': {
        const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
        if (!EMAIL.test(email) || email.length > 254) return json({ error: 'Zadejte platný e-mail.' }, 400);
        if (!active) return json({ error: 'Členy lze zvát jen s platnou licencí.' }, 402);
        const { count } = await admin.from('club_members').select('user_id', { count: 'exact', head: true }).eq('club_id', club.id);
        if ((count ?? 0) >= club.seats) return json({ error: `Licence je pro nejvýše ${club.seats} lidi.` }, 409);
        const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: SITE_URL });
        if (error || !invited.user) {
          // Účet už existuje – do klubu ho nepřevádíme automaticky (mohl by mít vlastní zápasy).
          const exists = error?.status === 422 || /already/i.test(error?.message ?? '');
          return json({ error: exists ? 'Tento e-mail už má účet. Napište nám a člena do klubu převedeme.' : 'Pozvánku se nepodařilo odeslat.' }, exists ? 409 : 500);
        }
        const { error: insErr } = await admin.from('club_members').insert({ club_id: club.id, user_id: invited.user.id, role: 'member', email });
        if (insErr) {
          console.error('invite insert', insErr);
          return json({ error: 'Člena se nepodařilo přidat do klubu.' }, 500);
        }
        return json({ ok: true });
      }

      default:
        return json({ error: 'Neznámá akce.' }, 400);
    }
  } catch (e) {
    console.error('club-api', e);
    return json({ error: e instanceof Error && e.message.startsWith('Chybí secret') ? e.message : 'Akce se nepodařila. Zkuste to znovu.' }, 500);
  }
});
