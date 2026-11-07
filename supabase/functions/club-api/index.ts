// VolleyStat – celý server v jedné funkci:
//  • aplikace (přihlášený správce klubu): { action: 'checkout' | 'portal' | 'invite' },
//  • webhook Stripe (hlavička Stripe-Signature): po zaplacení prodlouží licenci, po úplném refundu ji ukončí.
//  • smazání účtu (každý uživatel): { action: 'delete_account' }.
// Přihlášení i podpis ověřuje funkce sama (Verify JWT na bráně vypnuté).
// Tajné klíče: Supabase → Edge Functions → Secrets (STRIPE_SECRET_KEY, STRIPE_PRICE_ID, STRIPE_WEBHOOK_SECRET, SITE_URL).
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@18'; // API 2025-08-27.basil – vyžaduje ji Managed Payments

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

/** Zruší všechna běžící předplatná zákazníka (refund, smazání účtu) – jinak by se za rok znovu strhla platba. */
async function cancelSubscriptions(customer: string): Promise<void> {
  const subs = await stripe().subscriptions.list({ customer, status: 'all', limit: 20 });
  for (const sub of subs.data) {
    if (['active', 'trialing', 'past_due', 'unpaid', 'incomplete'].includes(sub.status)) await stripe().subscriptions.cancel(sub.id);
  }
}

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === 'string' ? v : v?.id ?? null);

/** Webhook Stripe: pravost ověřuje podpis (STRIPE_WEBHOOK_SECRET), ne přihlášení. */
async function handleWebhook(req: Request, signature: string): Promise<Response> {
  const secret = Deno.env.get('STRIPE_WEBHOOK_SECRET');
  if (!secret) return new Response('Chybí secret STRIPE_WEBHOOK_SECRET.', { status: 500 });
  let event: Stripe.Event;
  try {
    event = await stripe().webhooks.constructEventAsync(await req.text(), signature, secret, undefined, Stripe.createSubtleCryptoProvider());
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey());
  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const s = event.data.object;
        const clubId = s.client_reference_id ?? s.metadata?.club_id;
        if (clubId) await admin.from('clubs').update({ stripe_customer_id: idOf(s.customer), stripe_subscription_id: idOf(s.subscription) }).eq('id', clubId);
        break;
      }
      case 'invoice.paid': {
        const inv = event.data.object;
        // Klub podle zákazníka, jinak podle metadat předplatného (webhooky nemusí dorazit v pořadí).
        let clubId: string | null = null;
        const customer = idOf(inv.customer);
        if (customer) {
          const { data } = await admin.from('clubs').select('id').eq('stripe_customer_id', customer).maybeSingle();
          clubId = data?.id ?? null;
        }
        clubId ??= inv.parent?.subscription_details?.metadata?.club_id ?? null;
        const periodEnd = Math.max(0, ...inv.lines.data.map((l) => l.period?.end ?? 0));
        if (!clubId || !periodEnd) {
          console.error('invoice.paid bez klubu nebo období', inv.id);
          break;
        }
        const { data: club } = await admin.from('clubs').select('license_until, stripe_customer_id').eq('id', clubId).single();
        const until = new Date(periodEnd * 1000);
        const current = club?.license_until ? new Date(club.license_until) : null;
        await admin
          .from('clubs')
          .update({
            license_until: (current && current > until ? current : until).toISOString(),
            ...(club?.stripe_customer_id ? {} : { stripe_customer_id: customer }),
          })
          .eq('id', clubId);
        // Nové licenční období = nové pozvánky (sloupec z migrace 0003; bez ní se krok přeskočí).
        if (!current || until > current) await admin.from('clubs').update({ invites_used: 0 }).eq('id', clubId);
        break;
      }
      case 'charge.refunded': {
        // Úplné vrácení platby (např. odstoupení do 14 dnů): licence končí hned a předplatné se zruší, aby se znovu nestrhlo.
        const ch = event.data.object;
        const customer = idOf(ch.customer);
        if (!ch.refunded || !customer) break;
        const { data: club } = await admin.from('clubs').select('id').eq('stripe_customer_id', customer).maybeSingle();
        if (!club) {
          console.error('charge.refunded bez klubu', ch.id);
          break;
        }
        await cancelSubscriptions(customer);
        await admin.from('clubs').update({ license_until: new Date().toISOString(), stripe_subscription_id: null }).eq('id', club.id);
        break;
      }
      case 'customer.subscription.deleted': {
        // Licence platí do konce zaplaceného období; jen zapomeneme zrušené předplatné.
        await admin.from('clubs').update({ stripe_subscription_id: null }).eq('stripe_subscription_id', event.data.object.id);
        break;
      }
    }
    return new Response('ok');
  } catch (e) {
    console.error('webhook', event.type, e);
    return new Response('Error', { status: 500 }); // Stripe to zkusí znovu
  }
}

Deno.serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature');
  if (signature && req.method === 'POST') return handleWebhook(req, signature);
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

    if (body.action === 'delete_account') {
      // Právo na výmaz (GDPR). Správce klubu s dalšími členy musí členy nejdřív odebrat – jinak by jim zmizela data klubu.
      if (me?.role === 'admin') {
        const { count } = await admin.from('club_members').select('user_id', { count: 'exact', head: true }).eq('club_id', me.club_id);
        if ((count ?? 0) > 1) return json({ error: 'Nejdřív odeberte ostatní členy klubu.' }, 409);
        const { data: own } = await admin.from('clubs').select('stripe_customer_id').eq('id', me.club_id).single();
        if (own?.stripe_customer_id) await cancelSubscriptions(own.stripe_customer_id);
        const { error: clubErr } = await admin.from('clubs').delete().eq('id', me.club_id); // smaže i zápasy a soupisky klubu
        if (clubErr) throw clubErr;
      }
      const { error: delErr } = await admin.auth.admin.deleteUser(user.id);
      if (delErr) throw delErr;
      return json({ ok: true });
    }

    if (!me || me.role !== 'admin') return json({ error: 'Tuto akci může provést jen správce klubu.' }, 403);
    const { data: club } = await admin.from('clubs').select('*').eq('id', me.club_id).single();
    if (!club) return json({ error: 'Klub nenalezen.' }, 404);
    const active = !!club.license_until && new Date(club.license_until) > new Date();

    switch (body.action) {
      case 'checkout': {
        if (active) return json({ error: 'Licence je aktivní. Obnovuje se automaticky – spravujte ji v části Platby a faktury.' }, 409);
        // Ochrana proti dvojí platbě: rozhoduje Stripe, ne jen naše databáze (webhook se mohl zpozdit).
        if (club.stripe_customer_id) {
          const subs = await stripe().subscriptions.list({ customer: club.stripe_customer_id, status: 'all', limit: 20 });
          if (subs.data.some((sub) => ['active', 'trialing', 'past_due', 'incomplete'].includes(sub.status)))
            return json({ error: 'Klub už má předplatné. Pokud licence nesvítí jako aktivní, obnovte stránku za minutu.' }, 409);
        }
        const price = Deno.env.get('STRIPE_PRICE_ID');
        if (!price) throw new Error('Chybí secret STRIPE_PRICE_ID.');
        const params: Stripe.Checkout.SessionCreateParams = {
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
          // Výslovný souhlas s obchodními podmínkami a se zahájením služby před uplynutím lhůty pro odstoupení.
          consent_collection: { terms_of_service: 'required' },
          custom_text: {
            terms_of_service_acceptance: {
              message:
                'Souhlasím s [obchodními podmínkami](https://volleystat.cz/obchodni-podminky.html) a žádám o zpřístupnění licence ihned po zaplacení. Beru na vědomí, že při odstoupení do 14 dnů se vrací poměrná část ceny.',
            },
          },
        };
        let session: Stripe.Checkout.Session;
        try {
          session = await stripe().checkout.sessions.create(params);
        } catch (e) {
          // Bez odkazu na obchodní podmínky v nastavení Stripe (Public details) nejde souhlas vyžadovat – prodej ale nezastavíme.
          if (!/terms of service/i.test(e instanceof Error ? e.message : '')) throw e;
          console.error('checkout: v nastavení Stripe chybí odkaz na obchodní podmínky – nákup bez zaškrtnutí souhlasu');
          const { consent_collection: _c, custom_text: _t, ...rest } = params;
          session = await stripe().checkout.sessions.create(rest);
        }
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
        // Licence je pro stálé členy, ne pro neomezenou výměnu: nejvýše 2× počet míst pozvánek za licenční období.
        const invitesUsed = typeof club.invites_used === 'number' ? club.invites_used : 0;
        if (invitesUsed >= club.seats * 2) return json({ error: 'V tomto licenčním období už jste vyčerpali počet pozvánek. Napište nám na info@volleystat.cz.' }, 409);
        const { data: invited, error } = await admin.auth.admin.inviteUserByEmail(email, { redirectTo: SITE_URL, data: { invited: true } });
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
        if (typeof club.invites_used === 'number') await admin.from('clubs').update({ invites_used: invitesUsed + 1 }).eq('id', club.id);
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
