import { useCallback, useEffect, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import { initialHashLinkType, supabase } from './supabase';

export type AuthState =
  | { status: 'loading' }
  | { status: 'misconfigured' }
  | { status: 'out'; notice?: string }
  | { status: 'setPassword'; user: User }
  | { status: 'in'; user: User };

const SETPW_TYPES = new Set(['invite', 'recovery']);
const OTP_TYPES = new Set(['invite', 'recovery', 'signup', 'email']);

/** Obecná hláška: nikdy neprozradí, zda e-mail existuje. */
export const LOGIN_ERROR = 'Nesprávný e-mail nebo heslo.';

export function useAuth() {
  const [state, setState] = useState<AuthState>(supabase ? { status: 'loading' } : { status: 'misconfigured' });

  useEffect(() => {
    if (!supabase) return;
    const client = supabase;
    let needsPassword = initialHashLinkType ? SETPW_TYPES.has(initialHashLinkType) : false;
    let alive = true;

    const apply = (user: User | null) => {
      if (!alive) return;
      if (!user) setState((s) => (s.status === 'out' ? s : { status: 'out' }));
      else setState(needsPassword ? { status: 'setPassword', user } : { status: 'in', user });
    };

    const { data } = client.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') needsPassword = true;
      apply(session?.user ?? null);
    });

    void (async () => {
      // Odkaz z e-mailu: ?token_hash=…&type=invite|recovery (šablony e-mailů, viz supabase/README.md).
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get('token_hash');
      const type = params.get('type');
      if (tokenHash && type && OTP_TYPES.has(type)) {
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
        needsPassword = SETPW_TYPES.has(type);
        const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: type as 'invite' | 'recovery' | 'signup' | 'email' });
        if (error) {
          needsPassword = false;
          if (alive) setState({ status: 'out', notice: 'Odkaz je neplatný nebo mu vypršela platnost. Požádejte o nový.' });
          return;
        }
      }
      const { data: s } = await client.auth.getSession();
      apply(s.session?.user ?? null);
    })();

    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, []);

  const finishPassword = useCallback((user: User) => setState({ status: 'in', user }), []);
  return { state, finishPassword };
}

export async function signIn(email: string, password: string): Promise<string | null> {
  if (!supabase) return 'Aplikace není nakonfigurovaná.';
  const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
  return error ? (error.status === 429 ? 'Příliš mnoho pokusů. Zkuste to za chvíli.' : LOGIN_ERROR) : null;
}

export async function requestReset(email: string): Promise<void> {
  // Výsledek se záměrně ignoruje – odpověď uživateli je vždy stejná.
  await supabase?.auth.resetPasswordForEmail(email.trim(), { redirectTo: `${window.location.origin}/app/` });
}

export async function setPassword(password: string): Promise<{ user?: User; error?: string }> {
  if (!supabase) return { error: 'Aplikace není nakonfigurovaná.' };
  const { data, error } = await supabase.auth.updateUser({ password });
  if (error) return { error: error.message.toLowerCase().includes('weak') || error.message.toLowerCase().includes('pwned') ? 'Heslo je příliš slabé nebo uniklé. Zvolte jiné.' : 'Heslo se nepodařilo nastavit. Zkuste to znovu.' };
  return { user: data.user };
}
