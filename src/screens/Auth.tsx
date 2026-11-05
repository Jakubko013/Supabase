import { useState, type FormEvent } from 'react';
import { requestReset, setPassword, signIn } from '../auth';
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

export function Login({ notice }: { notice?: string }) {
  const [mode, setMode] = useState<'login' | 'reset' | 'sent'>('login');
  const [email, setEmail] = useState('');
  const [password, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    if (mode === 'login') setError(await signIn(email, password));
    else {
      await requestReset(email);
      setMode('sent');
    }
    setBusy(false);
  }

  if (mode === 'sent')
    return (
      <Shell title="Obnovení hesla">
        <p className="banner banner-ok" role="status">
          Pokud je u nás tento e-mail registrovaný, poslali jsme na něj odkaz pro nastavení nového hesla.
        </p>
        <button className="btn" onClick={() => setMode('login')}>
          Zpět na přihlášení
        </button>
      </Shell>
    );

  return (
    <Shell title={mode === 'login' ? 'Přihlášení' : 'Obnovení hesla'}>
      <form className="card form" onSubmit={submit}>
        {notice && (
          <p className="banner banner-bad" role="alert">
            {notice}
          </p>
        )}
        <label className="field">
          <span>E-mail</span>
          <input type="email" autoComplete="username" required maxLength={254} value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        {mode === 'login' && (
          <label className="field">
            <span>Heslo</span>
            <input type="password" autoComplete="current-password" required maxLength={128} value={password} onChange={(e) => setPw(e.target.value)} />
          </label>
        )}
        {error && (
          <p className="banner banner-bad" role="alert">
            {error}
          </p>
        )}
        <div className="actions">
          <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
            {mode === 'login' ? 'Přihlásit se' : 'Poslat odkaz'}
          </button>
          <button className="btn btn-ghost" type="button" onClick={() => { setError(null); setMode(mode === 'login' ? 'reset' : 'login'); }}>
            {mode === 'login' ? 'Zapomenuté heslo' : 'Zpět'}
          </button>
        </div>
        <p className="muted">
          Nemáte účet? <a href="/#pozvanka">Požádejte o pozvánku</a>
        </p>
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
