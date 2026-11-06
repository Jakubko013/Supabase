import { useState, type FormEvent } from 'react';
import { requestReset, setPassword, signIn, signUp } from '../auth';
import { TRIAL_MATCHES } from '../club';
import { isPwned, MIN_PASSWORD_LENGTH, passwordProblem } from '../password';
import type { User } from '@supabase/supabase-js';

function Shell({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="auth">
      <aside className="auth-side" aria-hidden="true">
        <a className="auth-logo" href="/" tabIndex={-1}>
          Volley<b>Stat</b>
        </a>
        <p className="auth-slogan">
          <span>Každý</span>
          <span className="auth-outline">balon</span>
          <span>
            se <em>počítá.</em>
          </span>
        </p>
        <svg className="auth-court" viewBox="0 0 300 180">
          <rect x="10" y="10" width="280" height="160" />
          <line x1="150" y1="0" x2="150" y2="180" className="net" />
          <line x1="100" y1="10" x2="100" y2="170" />
          <line x1="200" y1="10" x2="200" y2="170" />
          <circle cx="232" cy="62" r="9" className="ball" />
        </svg>
      </aside>
      <main className="auth-main">
        <a className="auth-back" href="/">
          ← Zpět na web
        </a>
        <h1>{title}</h1>
        {children}
      </main>
    </div>
  );
}

type Mode = 'login' | 'signup' | 'reset' | 'sent' | 'signedUp';

const TITLES: Record<Mode, string> = {
  login: 'Přihlášení',
  signup: 'Zkušební verze',
  reset: 'Obnovení hesla',
  sent: 'Obnovení hesla',
  signedUp: 'Potvrďte e-mail',
};

/** Starší verze si pamatovala poslední e-mail – po odhlášení má být formulář prázdný, proto ho smažeme. */
try {
  localStorage.removeItem('vs:lastEmail');
} catch {
  // soukromý režim – nevadí
}

/** Odkaz z webu „Vyzkoušet zdarma“ vede na /app/?registrace. */
const wantsSignup = () => new URLSearchParams(window.location.search).has('registrace');

export function Login({ notice }: { notice?: string }) {
  const [mode, setMode] = useState<Mode>(wantsSignup() ? 'signup' : 'login');
  const [email, setEmail] = useState('');
  const [password, setPw] = useState('');
  const [password2, setPw2] = useState('');
  // Prohlížeč pole po načtení sám nevyplní: jsou jen pro čtení, dokud se jich uživatel nedotkne (po odhlášení prázdný formulář).
  const [locked, setLocked] = useState(true);
  const unlock = { readOnly: locked, onPointerDown: () => setLocked(false), onFocus: () => setLocked(false) };
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const go = (m: Mode) => {
    setError(null);
    setMode(m);
  };

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(null);
    if (mode === 'signup') {
      const problem = passwordProblem(password, email) ?? (password !== password2 ? 'Hesla se neshodují.' : null);
      if (problem) return setError(problem);
    }
    setBusy(true);
    if (mode === 'login') setError(await signIn(email, password));
    else if (mode === 'signup') {
      if (await isPwned(password)) setError('Toto heslo se objevilo v uniklých databázích. Zvolte jiné.');
      else {
        const err = await signUp(email, password);
        if (err) setError(err);
        else setMode('signedUp');
      }
    } else {
      await requestReset(email);
      setMode('sent');
    }
    setBusy(false);
  }

  if (mode === 'sent' || mode === 'signedUp')
    return (
      <Shell title={TITLES[mode]}>
        <p className="banner banner-ok" role="status">
          {mode === 'sent'
            ? 'Pokud je u nás tento e-mail registrovaný, poslali jsme na něj odkaz pro nastavení nového hesla.'
            : `Poslali jsme e-mail na ${email}. Klikněte na odkaz v něm a účet je hotový. Pokud nepřišel, podívejte se do spamu.`}
        </p>
        <button className="btn" onClick={() => go('login')}>
          Zpět na přihlášení
        </button>
      </Shell>
    );

  return (
    <Shell title={TITLES[mode]}>
      <form className="card form" onSubmit={submit}>
        {notice && (
          <p className="banner banner-bad" role="alert">
            {notice}
          </p>
        )}
        {mode === 'signup' && (
          <p className="muted">Vyzkoušejte zápis {TRIAL_MATCHES} zápasů zdarma, bez platební karty. Licenci pro klub koupíte až v aplikaci.</p>
        )}
        <label className="field">
          <span>E-mail</span>
          <input type="email" name="email" autoComplete="off" {...unlock} required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {(mode === 'login' || mode === 'signup') && (
          <label className="field">
            <span>{mode === 'signup' ? `Heslo (min. ${MIN_PASSWORD_LENGTH} znaků)` : 'Heslo'}</span>
            <input
              type="password"
              name="password"
              autoComplete={mode === 'signup' ? 'new-password' : 'off'}
              {...unlock}
              required
              minLength={mode === 'signup' ? MIN_PASSWORD_LENGTH : undefined}
              maxLength={128}
              value={password}
              onChange={(e) => setPw(e.target.value)}
            />
          </label>
        )}
        {mode === 'signup' && (
          <label className="field">
            <span>Heslo znovu</span>
            <input type="password" name="password2" autoComplete="new-password" required maxLength={128} value={password2} onChange={(e) => setPw2(e.target.value)} />
          </label>
        )}
        {error && (
          <p className="banner banner-bad" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
            {mode === 'login' ? 'Přihlásit se' : mode === 'signup' ? 'Vytvořit účet' : 'Poslat odkaz'}
          </button>
          {mode === 'login' ? (
            <button className="btn btn-ghost" type="button" onClick={() => go('reset')}>
              Zapomenuté heslo
            </button>
          ) : (
            <button className="btn btn-ghost" type="button" onClick={() => go('login')}>
              Mám účet – přihlásit
            </button>
          )}
        </div>
        {mode === 'login' && (
          <p className="muted">
            Nemáte účet?{' '}
            <button className="link-btn" type="button" onClick={() => go('signup')}>
              Vyzkoušejte zdarma
            </button>
          </p>
        )}
      </form>
    </Shell>
  );
}

export function SetPassword({ user, onDone }: { user: User; onDone: (u: User) => void }) {
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    const problem = passwordProblem(pw, user.email ?? '') ?? (pw !== pw2 ? 'Hesla se neshodují.' : null);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    if (await isPwned(pw)) {
      setBusy(false);
      return setError('Toto heslo se objevilo v uniklých databázích. Zvolte jiné.');
    }
    const res = await setPassword(pw);
    setBusy(false);
    if (res.error || !res.user) return setError(res.error ?? 'Heslo se nepodařilo nastavit.');
    onDone(res.user);
  }

  return (
    <Shell title="Nastavení hesla">
      <form className="card form" onSubmit={submit}>
        <p className="muted">Účet: {user.email}</p>
        <label className="field">
          <span>Nové heslo (min. {MIN_PASSWORD_LENGTH} znaků)</span>
          <input type="password" autoComplete="new-password" required minLength={MIN_PASSWORD_LENGTH} maxLength={128} value={pw} onChange={(e) => setPw(e.target.value)} />
        </label>
        <label className="field">
          <span>Heslo znovu</span>
          <input type="password" autoComplete="new-password" required maxLength={128} value={pw2} onChange={(e) => setPw2(e.target.value)} />
        </label>
        {error && (
          <p className="banner banner-bad" role="alert">
            {error}
          </p>
        )}
        <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
          Uložit heslo
        </button>
      </form>
    </Shell>
  );
}
