import { useState } from 'react';
import type { Match } from '../types';
import { setsWon } from '../stats';
import { navigate } from '../router';
import { ConfirmButton } from '../components/ConfirmButton';
import { STORAGE_LIMIT, createBackup, mergeMatches, parseBackup, storageUsed } from '../backup';
import { loadRosters, mergeRosters } from '../storage';
import { downloadBlob, isShareCancel, shareFile } from '../share';

interface Props {
  matches: Match[];
  onDelete: (id: string) => void;
  onImport: (matches: Match[]) => void;
}

const isNative = !!window.Capacitor?.isNativePlatform?.();
// Online náhled (mode demo) běží v sandboxu, který stahování nepovolí.
const exportable = import.meta.env.MODE !== 'demo';

export function Home({ matches, onDelete, onImport }: Props) {
  return (
    <main className="page">
      <header className="page-header">
        <h1>Volejbal Statistika</h1>
        <button className="btn btn-primary btn-lg" onClick={() => navigate('new')}>
          + Nový zápas
        </button>
      </header>

      {matches.length === 0 ? (
        <p className="empty">Zatím žádné zápasy. Začněte tlačítkem „Nový zápas“.</p>
      ) : (
        <ul className="match-list">
          {matches.map((m) => {
            const won = setsWon(m);
            return (
              <li key={m.id} className="card match-item">
                <div>
                  <div className="match-title">
                    {m.team} <span className="muted">vs</span> {m.opponent}
                  </div>
                  <div className="muted">
                    {new Date(m.date).toLocaleDateString('cs-CZ')} · sety {won.us}:{won.them} ·{' '}
                    {m.finished ? 'ukončen' : 'probíhá'}
                  </div>
                </div>
                <div className="actions">
                  {!m.finished && (
                    <button className="btn btn-primary" onClick={() => navigate(`match/${m.id}`)}>
                      Pokračovat
                    </button>
                  )}
                  <button className="btn" onClick={() => navigate(`match/${m.id}/stats`)}>
                    Statistiky
                  </button>
                  <ConfirmButton
                    className="btn btn-ghost"
                    aria-label={`Smazat zápas ${m.team} vs ${m.opponent}`}
                    confirmText="Opravdu smazat?"
                    onConfirm={() => onDelete(m.id)}
                  >
                    Smazat
                  </ConfirmButton>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <BackupCard matches={matches} onImport={onImport} />
    </main>
  );
}

const zapasu = (n: number) => `${n} ${n === 1 ? 'zápas' : n >= 2 && n <= 4 ? 'zápasy' : 'zápasů'}`;

/** Zápasy jsou jen v zařízení – záloha do souboru chrání před ztrátou iPadu nebo smazáním dat prohlížeče. */
function BackupCard({ matches, onImport }: { matches: Match[]; onImport: (matches: Match[]) => void }) {
  const [msg, setMsg] = useState<{ tone: 'ok' | 'bad'; text: string } | null>(null);
  const pct = Math.round((storageUsed(matches) / STORAGE_LIMIT) * 100);

  async function save() {
    const blob = new Blob([createBackup(matches, loadRosters())], { type: 'application/json' });
    const name = `volejbal-zaloha-${new Date().toLocaleDateString('sv-SE')}.json`;
    try {
      if (isNative) await shareFile(blob, name, 'Záloha Volejbal Statistika');
      else downloadBlob(blob, name);
      setMsg({ tone: 'ok', text: `Záloha (${zapasu(matches.length)}) je připravená. Uložte ji mimo toto zařízení (iCloud, Disk Google, e-mail).` });
    } catch (e) {
      if (!isShareCancel(e)) setMsg({ tone: 'bad', text: 'Zálohu se nepodařilo uložit.' });
    }
  }

  async function restore(file: File) {
    try {
      const backup = parseBackup(await file.text());
      mergeRosters(backup.rosters);
      const { merged, added, skipped } = mergeMatches(matches, backup.matches);
      onImport(merged);
      setMsg({ tone: 'ok', text: `Obnoveno: přidáno ${zapasu(added)}${skipped ? `; již uložené v zařízení: ${zapasu(skipped)} (beze změny)` : ''}.` });
    } catch (e) {
      setMsg({ tone: 'bad', text: e instanceof Error ? e.message : 'Zálohu se nepodařilo obnovit.' });
    }
  }

  return (
    <section className="card form" aria-labelledby="backup-title">
      <h2 id="backup-title">Záloha dat</h2>
      <p className="muted">
        Zápasy jsou uložené jen v tomto zařízení. Po zápase si uložte zálohu, ať o data nepřijdete při ztrátě zařízení nebo smazání dat
        prohlížeče. Úložiště je zaplněné z {pct} %.
      </p>
      {pct >= 70 && (
        <p className="banner banner-bad" role="alert">
          Úložiště se plní. Uložte zálohu a smažte staré zápasy, jinak se nové akce přestanou ukládat.
        </p>
      )}
      <div className="actions">
        {exportable && (
          <button className="btn" onClick={save} disabled={!matches.length}>
            Uložit zálohu
          </button>
        )}
        <label className="btn">
          Obnovit ze zálohy
          <input
            type="file"
            accept=".json,application/json"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void restore(file);
              e.target.value = '';
            }}
          />
        </label>
      </div>
      {msg && (
        <p className={`banner ${msg.tone === 'ok' ? 'banner-ok' : 'banner-bad'}`} role="status">
          {msg.text}
        </p>
      )}
    </section>
  );
}

