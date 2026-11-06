// Webhook Stripe: po zaplacení prodlouží licenci klubu do konce zaplaceného období.
// Volá ho jen Stripe – pravost ověřuje podpis (STRIPE_WEBHOOK_SECRET), ne přihlášení.
import { createClient } from 'npm:@supabase/supabase-js@2';
import Stripe from 'npm:stripe@17';

const stripe = new Stripe(Deno.env.get('STRIPE_SECRET_KEY')!, { httpClient: Stripe.createFetchHttpClient() });
const crypto = Stripe.createSubtleCryptoProvider();
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

const admin = createClient(Deno.env.get('SUPABASE_URL')!, secretKey());

const idOf = (v: string | { id: string } | null | undefined) => (typeof v === 'string' ? v : v?.id ?? null);

/** Klub k faktuře: podle zákazníka, jinak podle metadat předplatného (webhooky nemusí dorazit v pořadí). */
async function clubForInvoice(inv: Stripe.Invoice): Promise<string | null> {
  const customer = idOf(inv.customer);
  if (customer) {
    const { data } = await admin.from('clubs').select('id').eq('stripe_customer_id', customer).maybeSingle();
    if (data) return data.id;
  }
  const meta =
    (inv as unknown as { parent?: { subscription_details?: { metadata?: Record<string, string> } } }).parent?.subscription_details?.metadata ??
    (inv as unknown as { subscription_details?: { metadata?: Record<string, string> } }).subscription_details?.metadata;
  return meta?.club_id ?? null;
}

Deno.serve(async (req) => {
  const signature = req.headers.get('Stripe-Signature');
  if (req.method !== 'POST' || !signature) return new Response('Bad request', { status: 400 });
  let event: Stripe.Event;
  try {
    event = await stripe.webhooks.constructEventAsync(await req.text(), signature, Deno.env.get('STRIPE_WEBHOOK_SECRET')!, undefined, crypto);
  } catch {
    return new Response('Invalid signature', { status: 400 });
  }

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
        const clubId = await clubForInvoice(inv);
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
            ...(club?.stripe_customer_id ? {} : { stripe_customer_id: idOf(inv.customer) }),
          })
          .eq('id', clubId);
        break;
      }
      case 'customer.subscription.deleted': {
        // Licence platí do konce zaplaceného období; jen zapomeneme zrušené předplatné.
        const sub = event.data.object;
        await admin.from('clubs').update({ stripe_subscription_id: null }).eq('stripe_subscription_id', sub.id);
        break;
      }
    }
    return new Response('ok');
  } catch (e) {
    console.error('webhook', event.type, e);
    return new Response('Error', { status: 500 }); // Stripe to zkusí znovu
  }
});
