import { useCallback, useEffect, useRef, useState } from 'react';
import type { User } from '@supabase/supabase-js';
import type { Match } from './types';
import { LEGACY_MATCHES_KEY, LEGACY_ROSTERS_KEY, clearUserStorage, loadMatches, mergeRosters, read, saveMatches, setRosterListener, setStorageUser, type SavedRoster } from './storage';
import { Home } from './screens/Home';
import { Setup } from './screens/Setup';
import { Recording } from './screens/Recording';
import { StatsView } from './screens/StatsView';
import { Login, SetPassword } from './screens/Auth';
import { getRoute, navigate } from './router';
import { createDemoMatch } from './demo';
import { useAuth } from './auth';
import { supabase } from './supabase';
import { createSync, diffMatches, type Sync, type SyncStatus } from './sync';
import { mergeMatches } from './backup';

export type MatchUpdater = (id: string, update: (m: Match) => Match) => void;

const DEMO = import.meta.env.MODE === 'demo';

export function App() {
  const { state, finishPassword } = useAuth();
  if (DEMO) return <Main user={null} />;
  switch (state.status) {
    case 'loading':
      return <main className="page"><p className="muted" role="status">Načítání…</p></main>;
    case 'misconfigured':
      return <main className="page"><p className="banner banner-bad" role="alert">Aplikace není správně nakonfigurovaná (chybí přihlašovací služba).</p></main>;
    case 'out':
      return <Login notice={state.notice} />;
    case 'setPassword':
      return <SetPassword user={state.user} onDone={finishPassword} />;
    case 'in':
      return <Main key={state.user.id} user={state.user} />;
  }
}

const STATUS_TEXT: Record<SyncStatus, string> = {
  idle: 'Uloženo na serveru',
  syncing: 'Ukládám…',
  offline: 'Offline – odešle se po připojení',
  error: 'Synchronizace selhala, zkusím znovu',
};

function Main({ user }: { user: User | null }) {
  const [route, setRoute] = useState(getRoute);
  const [matches, setMatchesState] = useState<Match[]>(() => {
    setStorageUser(user?.id ?? null);
    const stored = loadMatches();
    if (!DEMO) return stored;
    // Náhled: starší uložená ukázka (bez soupeře) se nahradí aktuální.
    const kept = stored.filter((m) => !(m.id === 'demo' && !m.oppPlayers.length));
    return kept.some((m) => m.id === 'demo') ? kept : [createDemoMatch(), ...kept];
  });
  const [saveFailed, setSaveFailed] = useState(false);
  const [status, setStatus] = useState<SyncStatus>('idle');
  const matchesRef = useRef(matches);
  const syncRef = useRef<Sync | null>(null);

  /** Jediné místo, kudy se mění zápasy: synchronně zapíše změnu a označí ji k odeslání na server. */
  const apply = useCallback((fn: (list: Match[]) => Match[], push = true) => {
    const prev = matchesRef.current;
    const next = fn(prev);
    if (next === prev) return;
    matchesRef.current = next;
    setMatchesState(next);
    if (push) {
      const { changed, removed } = diffMatches(prev, next);
      syncRef.current?.mark(changed, removed);
    }
  }, []);

  useEffect(() => {
    if (!user || !supabase) return;
    const sync = createSync(supabase, user.id, {
      getMatches: () => matchesRef.current,
      replaceMatches: (fn) => apply(fn, false),
      onStatus: setStatus,
    });
    syncRef.current = sync;
    setRosterListener(sync.markRosters);
    let last = 0;
    const refresh = () => {
      if (document.visibilityState === 'hidden' || Date.now() - last < 30_000) return;
      last = Date.now();
      void sync.pull();
    };
    refresh();
    // Odeslat rozdělanou práci, než se stránka zavře nebo uspí.
    const hide = () => document.visibilityState === 'hidden' && void sync.flush();
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', refresh);
    document.addEventListener('visibilitychange', hide);
    return () => {
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', refresh);
      document.removeEventListener('visibilitychange', hide);
      setRosterListener(null);
      sync.dispose();
      syncRef.current = null;
    };
  }, [user, apply]);

  useEffect(() => {
    const onHash = () => setRoute(getRoute());
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  useEffect(() => {
    setSaveFailed(!saveMatches(matches));
  }, [matches]);

  const updateMatch: MatchUpdater = useCallback((id, update) => apply((list) => list.map((m) => (m.id === id ? update(m) : m))), [apply]);

  async function logout() {
    const sync = syncRef.current;
    if (sync?.pending() && !(await sync.flush()) && !window.confirm('Některé zápasy se nepodařilo odeslat na server a po odhlášení se z tohoto zařízení smažou. Odhlásit přesto?')) return;
    sync?.dispose();
    if (user) clearUserStorage(user.id);
    await supabase?.auth.signOut({ scope: 'local' });
  }

  const [screen, id, sub] = route;
  const match = id ? matches.find((m) => m.id === id) : undefined;

  let content;
  if (screen === 'new') {
    content = (
      <Setup
        onCreate={(m) => {
          apply((list) => [m, ...list]);
          navigate(`match/${m.id}`);
        }}
      />
    );
  } else if (screen === 'match' && match) {
    content =
      sub === 'stats' || match.finished ? <StatsView match={match} /> : <Recording match={match} updateMatch={updateMatch} />;
  } else {
    content = (
      <Home matches={matches} onDelete={(mid) => apply((list) => list.filter((m) => m.id !== mid))} onImport={(list) => apply(() => list)} />
    );
  }

  return (
    <>
      {user && (
        <div className="account-bar">
          <a className="app-logo" href="#/" aria-label="VolleyStat – moje zápasy">
            Volley<b>Stat</b>
          </a>
          <span className={`sync-pill sync-${status}`} role="status">
            {STATUS_TEXT[status]}
          </span>
          <span className="account-email">{user.email}</span>
          <button className="btn btn-ghost btn-sm" onClick={() => void logout()}>
            Odhlásit
          </button>
        </div>
      )}
      {saveFailed && (
        <div className="banner banner-bad" role="alert">
          Data se nepodařilo uložit do zařízení (plné úložiště?). Neukončujte aplikaci.
        </div>
      )}
      {user && <LegacyImport onImport={(legacy, rosters) => { apply((list) => mergeMatches(list, legacy).merged); mergeRosters(rosters); syncRef.current?.markRosters(); }} />}
      {content}
    </>
  );
}

/** Zápasy zapsané v zařízení ještě před zavedením účtů – uživatel se rozhodne, zda je nahraje do svého účtu. */
function LegacyImport({ onImport }: { onImport: (matches: Match[], rosters: SavedRoster[]) => void }) {
  const [legacy, setLegacy] = useState<Match[]>(() => {
    const raw = read<unknown>(LEGACY_MATCHES_KEY, []);
    return Array.isArray(raw) ? (raw as Match[]).filter((m) => m && typeof m.id === 'string' && Array.isArray(m.players) && Array.isArray(m.events)) : [];
  });
  const [hidden, setHidden] = useState(false);
  if (!legacy.length || hidden) return null;
  return (
    <div className="banner" role="region" aria-label="Starší data v zařízení">
      V tomto zařízení jsou starší zápasy ({legacy.length}) z doby před přihlášením. Nahrát je do vašeho účtu?{' '}
      <button
        className="btn btn-sm btn-primary"
        onClick={() => {
          const rosters = read<unknown>(LEGACY_ROSTERS_KEY, []);
          onImport(legacy, Array.isArray(rosters) ? (rosters as SavedRoster[]) : []);
          localStorage.removeItem(LEGACY_MATCHES_KEY);
          localStorage.removeItem(LEGACY_ROSTERS_KEY);
          setLegacy([]);
        }}
      >
        Nahrát do účtu
      </button>{' '}
      <button className="btn btn-sm btn-ghost" onClick={() => setHidden(true)}>
        Teď ne
      </button>
    </div>
  );
}
