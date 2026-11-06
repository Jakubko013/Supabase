import { useState, type FormEvent } from 'react';
import type { SupabaseClient, User } from '@supabase/supabase-js';
import { clearUserStorage } from '../storage';
import {
  deleteAccount,
  LICENSE_PRICE,
  TRIAL_MATCHES,
  daysLeft,
  inviteMember,
  openBillingPortal,
  removeMember,
  renameClub,
  startCheckout,
  type Club,
  type ClubMember,
  type License,
} from '../club';
import { ConfirmButton } from '../components/ConfirmButton';

interface Props {
  client: SupabaseClient;
  user: User;
  club: Club;
  members: ClubMember[];
  license: License;
  onChanged: () => void;
  /** Proč se obrazovka ukázala místo založení zápasu. */
  reason?: 'limit';
}

type Msg = { tone: 'ok' | 'bad'; text: string } | null;

export function ClubView({ client, user, club, members, license, onChanged, reason }: Props) {
  const isAdmin = members.some((m) => m.userId === user.id && m.role === 'admin');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<Msg>(null);

  async function run(key: string, fn: () => Promise<void>) {
    if (busy) return;
    setBusy(key);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Akce se nepodařila.' });
    }
    setBusy(null);
  }

  const redirect = (fn: () => Promise<{ url: string }>) => async () => {
    const { url } = await fn();
    if (!/^https:\/\/(checkout|billing)\.stripe\.com\//.test(url)) throw new Error('Neplatná adresa platební brány.');
    window.location.assign(url);
  };

  return (
    <main className="page club">
      <header className="home-head">
        <div>
          <p className="home-kicker">Klub a licence</p>
          <h1>{club.name}</h1>
        </div>
        <a className="btn" href="#/">
          ‹ Zápasy
        </a>
      </header>

      {reason === 'limit' && (
        <p className="banner banner-bad" role="alert">
          {license.kind === 'expired'
            ? 'Licence klubu vypršela – nové zápasy nelze zakládat.'
            : `Zkušební verze je vyčerpaná (${TRIAL_MATCHES} zápasy). Pro další zápasy kupte licenci pro klub.`}
        </p>
      )}
      {msg && (
        <p className={`banner ${msg.tone === 'ok' ? 'banner-ok' : 'banner-bad'}`} role="status">
          {msg.text}
        </p>
      )}

      <section className={`card license-card is-${license.kind}`} aria-labelledby="lic-title">
        <div className="license-head">
          <h2 id="lic-title">Licence</h2>
          <span className="license-state">{license.kind === 'active' ? 'Aktivní' : license.kind === 'trial' ? 'Zkušební verze' : 'Vypršela'}</span>
        </div>
        {license.kind === 'active' && (
          <p>
            Platí do <b>{license.until.toLocaleDateString('cs-CZ')}</b> (zbývá {daysLeft(license.until)} dní). Obnovuje se automaticky, zrušit ji můžete
            ve správě plateb.
          </p>
        )}
        {license.kind === 'trial' && (
          <p>
            Zbývá <b>{license.left}</b> z {TRIAL_MATCHES} zápasů zdarma. S licencí zapisujete neomezeně a můžete přizvat trenéry.
          </p>
        )}
        {license.kind === 'expired' && <p>Licence vypršela {license.until.toLocaleDateString('cs-CZ')}. Zápasy zůstávají, ale lze je jen prohlížet.</p>}

        <ul className="license-features">
          <li>Neomezený počet zápasů na 12 měsíců</li>
          <li>Až {club.seats} lidé z klubu sdílí zápasy a statistiky</li>
          <li>Synchronizace mezi zařízeními, export PDF a CSV</li>
        </ul>

        {isAdmin ? (
          <div className="actions">
            {license.kind !== 'active' && (
              <button className="btn btn-primary btn-lg btn-slanted" disabled={!!busy} onClick={() => void run('buy', redirect(() => startCheckout(client)))}>
                {busy === 'buy' ? 'Přesměrování…' : `Koupit licenci – ${LICENSE_PRICE}`}
              </button>
            )}
            {club.hasBilling && (
              <button className="btn" disabled={!!busy} onClick={() => void run('portal', redirect(() => openBillingPortal(client)))}>
                {busy === 'portal' ? 'Otevírám…' : 'Platby a faktury'}
              </button>
            )}
          </div>
        ) : (
          license.kind !== 'active' && <p className="muted">Licenci kupuje správce klubu.</p>
        )}
        {isAdmin && license.kind !== 'active' && <p className="muted small">Cena {LICENSE_PRICE} za 12 měsíců. Nejsme plátci DPH. Platba kartou, Apple Pay nebo Google Pay. Nákupem souhlasíte s <a href="/obchodni-podminky.html" target="_blank" rel="noopener">obchodními podmínkami</a>.</p>}
      </section>

      <section className="card form" aria-labelledby="members-title">
        <h2 id="members-title">
          Členové ({members.length}/{club.seats})
        </h2>
        <ul className="member-list">
          {members.map((m) => (
            <li key={m.userId}>
              <span>
                {m.email || 'Člen klubu'}
                {m.userId === user.id && <span className="muted"> (vy)</span>}
              </span>
              <span className="member-role">{m.role === 'admin' ? 'Správce' : 'Člen'}</span>
              {isAdmin && m.userId !== user.id && (
                <ConfirmButton
                  className="btn btn-ghost btn-sm"
                  aria-label={`Odebrat ${m.email}`}
                  confirmText="Opravdu odebrat?"
                  onConfirm={() =>
                    void run('remove', async () => {
                      await removeMember(client, club.id, m.userId);
                      onChanged();
                    })
                  }
                >
                  Odebrat
                </ConfirmButton>
              )}
            </li>
          ))}
        </ul>
        {isAdmin && <InviteForm license={license} full={members.length >= club.seats} busy={!!busy} onInvite={(email) => run('invite', async () => {
          await inviteMember(client, email);
          setMsg({ tone: 'ok', text: `Pozvánka odešla na ${email}.` });
          onChanged();
        })} />}
      </section>

      {isAdmin && <RenameForm name={club.name} busy={!!busy} onSave={(name) => run('rename', async () => {
        await renameClub(client, club.id, name);
        onChanged();
      })} />}

      <section className="card form" aria-labelledby="account-title">
        <h2 id="account-title">Účet</h2>
        <p className="muted">
          {isAdmin && members.length > 1
            ? 'Účet správce lze smazat, až v klubu nezůstanou další členové.'
            : isAdmin
              ? 'Smazání účtu trvale odstraní i klub se všemi zápasy a soupiskami a zruší předplatné (bez vrácení peněz). Zápasy si předem uložte do zálohy.'
              : 'Smazání účtu odstraní váš přístup. Zápasy klubu zůstanou správci.'}
        </p>
        <ConfirmButton
          className="btn btn-bad"
          confirmText="Opravdu trvale smazat?"
          disabled={!!busy || (isAdmin && members.length > 1)}
          onConfirm={() =>
            void run('delete', async () => {
              await deleteAccount(client);
              clearUserStorage(user.id);
              await client.auth.signOut({ scope: 'local' });
            })
          }
        >
          Smazat účet
        </ConfirmButton>
      </section>
    </main>
  );
}

function InviteForm({ license, full, busy, onInvite }: { license: License; full: boolean; busy: boolean; onInvite: (email: string) => Promise<void> }) {
  const [email, setEmail] = useState('');
  if (license.kind !== 'active') return <p className="muted">Trenéry a statistiky z klubu můžete přizvat po zakoupení licence.</p>;
  if (full) return <p className="muted">Licence je plně obsazená. Pro nového člena nejdřív někoho odeberte.</p>;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onInvite(email.trim()).then(() => setEmail(''));
  };
  return (
    <form className="invite-row" onSubmit={submit}>
      <label className="field">
        <span>Pozvat člena e-mailem</span>
        <input type="email" required maxLength={254} autoComplete="off" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <button className="btn btn-primary" type="submit" disabled={busy}>
        Pozvat
      </button>
    </form>
  );
}

function RenameForm({ name, busy, onSave }: { name: string; busy: boolean; onSave: (name: string) => Promise<void> }) {
  const [value, setValue] = useState(name);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (value.trim() && value.trim() !== name) void onSave(value.trim());
  };
  return (
    <form className="card form" onSubmit={submit} aria-label="Název klubu">
      <label className="field">
        <span>Název klubu</span>
        <input required maxLength={120} value={value} onChange={(e) => setValue(e.target.value)} />
      </label>
      <button className="btn" type="submit" disabled={busy || !value.trim() || value.trim() === name}>
        Uložit název
      </button>
    </form>
  );
}
