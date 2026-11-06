import type { SupabaseClient } from '@supabase/supabase-js';
import type { Match } from './types';
import { mergeRosters, normalizeMatch, read, write, loadRosters, type SavedRoster } from './storage';

export type SyncStatus = 'idle' | 'syncing' | 'offline' | 'error' | 'locked';

/** Databáze zápis odmítla kvůli licenci (zkušební verze vyčerpána / licence vypršela) – nemá smysl to rychle opakovat. */
const isLicenseError = (e: unknown) => (e as { code?: string })?.code === '42501';
const LOCKED_RETRY_MS = 5 * 60_000;

/** Co ještě nebylo odesláno na server (přežije zavření aplikace i offline). */
interface Outbox {
  up: Record<string, number>;
  del: string[];
  rosters: boolean;
}

const BATCH = 10;
const PAGE = 500;
const RETRY_MS = 15_000;
const DEBOUNCE_MS = 1_500;

/** Id zápasů, které se změnily (nová/upravená instance) nebo zmizely. */
export function diffMatches(prev: Match[], next: Match[]): { changed: string[]; removed: string[] } {
  const before = new Map(prev.map((m) => [m.id, m]));
  const ids = new Set(next.map((m) => m.id));
  return {
    changed: next.filter((m) => before.get(m.id) !== m).map((m) => m.id),
    removed: prev.filter((m) => !ids.has(m.id)).map((m) => m.id),
  };
}

/** Sloučí stav ze serveru s lokálním: neodeslané lokální změny vždy vyhrají, jinak platí server. */
export function reconcile(local: Match[], remote: Match[], pendingUp: ReadonlySet<string>, pendingDel: ReadonlySet<string>): Match[] {
  const remoteById = new Map(remote.map((m) => [m.id, m]));
  const out: Match[] = [];
  for (const m of local) {
    if (pendingUp.has(m.id)) out.push(m);
    else if (remoteById.has(m.id)) out.push(remoteById.get(m.id)!);
    // jinak: smazáno na jiném zařízení
  }
  const have = new Set(out.map((m) => m.id));
  for (const m of remote) if (!have.has(m.id) && !pendingDel.has(m.id)) out.push(m);
  return out.sort((a, b) => b.createdAt - a.createdAt);
}

export interface SyncDeps {
  getMatches: () => Match[];
  /** Synchronně nahradí seznam zápasů výsledkem funkce (bez znovuodeslání na server). */
  replaceMatches: (fn: (local: Match[]) => Match[]) => void;
  onStatus: (s: SyncStatus) => void;
}

export function createSync(client: SupabaseClient, userId: string, clubId: string, deps: SyncDeps) {
  const boxKey = `vs:u:${userId}:outbox`;
  const stored = read<Partial<Outbox>>(boxKey, {});
  const box: Outbox = { up: stored.up && typeof stored.up === 'object' ? stored.up : {}, del: Array.isArray(stored.del) ? stored.del : [], rosters: !!stored.rosters };
  const persist = () => write(boxKey, box);
  const pending = () => Object.keys(box.up).length + box.del.length + (box.rosters ? 1 : 0);

  let timer: ReturnType<typeof setTimeout> | undefined;
  let running = false;
  let again = false;
  let disposed = false;

  const schedule = (ms = DEBOUNCE_MS) => {
    if (disposed) return;
    clearTimeout(timer);
    timer = setTimeout(() => void flush(), ms);
  };

  function mark(changed: string[], removed: string[]) {
    for (const id of changed) {
      box.up[id] = (box.up[id] ?? 0) + 1;
      box.del = box.del.filter((d) => d !== id);
    }
    for (const id of removed) {
      delete box.up[id];
      if (!box.del.includes(id)) box.del.push(id);
    }
    if (changed.length || removed.length) {
      persist();
      schedule();
    }
  }

  function markRosters() {
    box.rosters = true;
    persist();
    schedule();
  }

  async function flush(): Promise<boolean> {
    if (disposed) return false;
    if (running) {
      again = true;
      return false;
    }
    if (!pending()) return true;
    running = true;
    deps.onStatus('syncing');
    try {
      const sent = { ...box.up };
      const byId = new Map(deps.getMatches().map((m) => [m.id, m]));
      const ids = Object.keys(sent);
      for (let i = 0; i < ids.length; i += BATCH) {
        const rows = ids.slice(i, i + BATCH).flatMap((id) => (byId.has(id) ? [{ club_id: clubId, id, data: byId.get(id) }] : []));
        if (rows.length) {
          const { error } = await client.from('matches').upsert(rows, { onConflict: 'club_id,id' });
          if (error) throw error;
        }
      }
      for (const id of ids) if (box.up[id] === sent[id]) delete box.up[id];

      if (box.del.length) {
        const del = [...box.del];
        const { error } = await client.from('matches').delete().in('id', del).eq('club_id', clubId);
        if (error) throw error;
        box.del = box.del.filter((d) => !del.includes(d));
      }

      if (box.rosters) {
        box.rosters = false;
        const rows = loadRosters().map((r) => ({ club_id: clubId, team: r.team, data: r }));
        if (rows.length) {
          const { error } = await client.from('rosters').upsert(rows, { onConflict: 'club_id,team' });
          if (error) {
            box.rosters = true;
            throw error;
          }
        }
      }
      persist();
      deps.onStatus('idle');
      return true;
    } catch (e) {
      persist();
      const locked = isLicenseError(e);
      deps.onStatus(locked ? 'locked' : navigator.onLine ? 'error' : 'offline');
      schedule(locked ? LOCKED_RETRY_MS : RETRY_MS);
      return false;
    } finally {
      running = false;
      if (again) {
        again = false;
        schedule(0);
      }
    }
  }

  /** Stáhne data ze serveru (nejdřív odešle lokální změny). */
  async function pull(): Promise<void> {
    if (disposed) return;
    if (pending() && !(await flush())) return;
    try {
      const remote: Match[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await client.from('matches').select('data').eq('club_id', clubId).order('created_at', { ascending: false }).range(from, from + PAGE - 1);
        if (error) throw error;
        remote.push(...data.map((r) => r.data as Match).filter((m) => m && typeof m.id === 'string' && Array.isArray(m.events) && Array.isArray(m.players)).map(normalizeMatch));
        if (data.length < PAGE) break;
      }
      const { data: rosterRows, error: rErr } = await client.from('rosters').select('data').eq('club_id', clubId);
      if (rErr) throw rErr;

      if (disposed) return;
      deps.replaceMatches((local) => reconcile(local, remote, new Set(Object.keys(box.up)), new Set(box.del)));
      mergeRosters(rosterRows.map((r) => r.data as SavedRoster).filter((r) => r && typeof r.team === 'string' && Array.isArray(r.players)));
      deps.onStatus('idle');
    } catch {
      deps.onStatus(navigator.onLine ? 'error' : 'offline');
    }
  }

  return {
    mark,
    markRosters,
    flush,
    pull,
    pending,
    dispose() {
      disposed = true;
      clearTimeout(timer);
    },
  };
}

export type Sync = ReturnType<typeof createSync>;
