import type { SupabaseClient } from '@supabase/supabase-js';

/** Zkušební verze: kolik zápasů smí klub bez licence založit (stejné číslo hlídá databáze). */
export const TRIAL_MATCHES = 2;
export const LICENSE_PRICE = '4 000 Kč';
export const LICENSE_SEATS = 3;

export interface Club {
  id: string;
  name: string;
  seats: number;
  licenseUntil: Date | null;
  matchesCreated: number;
  hasBilling: boolean;
}

export interface ClubMember {
  userId: string;
  email: string;
  role: 'admin' | 'member';
}

export type License =
  | { kind: 'active'; until: Date }
  | { kind: 'trial'; left: number }
  | { kind: 'expired'; until: Date };

export function licenseOf(club: Pick<Club, 'licenseUntil' | 'matchesCreated'>, now = new Date()): License {
  if (!club.licenseUntil) return { kind: 'trial', left: Math.max(0, TRIAL_MATCHES - club.matchesCreated) };
  return club.licenseUntil > now ? { kind: 'active', until: club.licenseUntil } : { kind: 'expired', until: club.licenseUntil };
}

export const canCreateMatch = (l: License) => l.kind === 'active' || (l.kind === 'trial' && l.left > 0);
/** Po vypršení licence lze zápasy jen prohlížet. */
export const canWrite = (l: License) => l.kind !== 'expired';

/** Dní do konce licence (pro upozornění před vypršením). */
export const daysLeft = (until: Date, now = new Date()) => Math.ceil((until.getTime() - now.getTime()) / 86_400_000);

/** Zajistí, že je uživatel v klubu (při prvním přihlášení založí klub ve zkušební verzi), a načte ho. */
export async function loadClub(client: SupabaseClient): Promise<{ club: Club; members: ClubMember[] }> {
  const { data: clubId, error: e1 } = await client.rpc('ensure_club');
  if (e1 || typeof clubId !== 'string') throw e1 ?? new Error('Klub se nepodařilo načíst.');
  const [{ data: c, error: e2 }, { data: m, error: e3 }] = await Promise.all([
    client.from('clubs').select('id, name, seats, license_until, matches_created, stripe_customer_id').eq('id', clubId).single(),
    client.from('club_members').select('user_id, email, role').eq('club_id', clubId).order('created_at'),
  ]);
  if (e2 || !c) throw e2 ?? new Error('Klub se nepodařilo načíst.');
  if (e3) throw e3;
  return {
    club: {
      id: c.id,
      name: c.name,
      seats: c.seats,
      licenseUntil: c.license_until ? new Date(c.license_until) : null,
      matchesCreated: c.matches_created,
      hasBilling: !!c.stripe_customer_id,
    },
    members: (m ?? []).map((r) => ({ userId: r.user_id, email: r.email ?? '', role: r.role === 'admin' ? 'admin' : 'member' })),
  };
}

/** Volání serverových funkcí (Stripe a pozvánky běží jen na serveru – tajné klíče v aplikaci nejsou). */
async function call<T>(client: SupabaseClient, name: string, body: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await client.functions.invoke(name, { body });
  if (error) {
    // Funkce vrací srozumitelnou českou hlášku v { error }.
    const msg = await (error as { context?: Response }).context?.json?.().then((j: { error?: string }) => j?.error).catch(() => undefined);
    throw new Error(msg || 'Akce se nepodařila. Zkuste to znovu.');
  }
  return data as T;
}

export const startCheckout = (client: SupabaseClient) => call<{ url: string }>(client, 'checkout');
export const openBillingPortal = (client: SupabaseClient) => call<{ url: string }>(client, 'portal');
export const inviteMember = (client: SupabaseClient, email: string) => call<{ ok: true }>(client, 'invite', { email });

export async function removeMember(client: SupabaseClient, clubId: string, userId: string): Promise<void> {
  const { error } = await client.from('club_members').delete().eq('club_id', clubId).eq('user_id', userId);
  if (error) throw new Error('Člena se nepodařilo odebrat.');
}

export async function renameClub(client: SupabaseClient, clubId: string, name: string): Promise<void> {
  const { error } = await client.from('clubs').update({ name }).eq('id', clubId);
  if (error) throw new Error('Název se nepodařilo uložit.');
}
