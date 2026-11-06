import { useState } from 'react';
import type { Match } from '../types';
import { setsWon } from '../stats';
import { navigate } from '../router';
import { LICENSE_PRICE, TRIAL_MATCHES, daysLeft, type License } from '../club';
import { ConfirmButton } from '../components/ConfirmButton';
import { STORAGE_LIMIT, createBackup, mergeMatches, parseBackup, storageUsed } from '../backup';
import { loadRosters, mergeRosters } from '../storage';
import { downloadBlob, isShareCancel, shareFile } from '../share';

interface Props {
  matches: Match[];
  /** null = neznámý stav (offline bez uložené licence) nebo náhled bez účtu. */
  license?: License | null;
  onDelete: (id: string) => void;
  onImport: (matches: Match[]) => void;
}

const isNative = !!window.Capacitor?.isNativePlatform?.();
// Online náhled (mode demo) běží v sandboxu, který stahování nepovolí.
const exportable = import.meta.env.MODE !== 'demo';

export function Home({ matches, license, onDelete, onImport }: Props) {
  return (
    <main className="page home">
      <header className="home-head">
        <div>
          <p className="home-kicker">Přehled</p>
          <h1>Moje zápasy</h1>
        </div>
        <button className="btn btn-primary btn-lg btn-slanted" onClick={() => navigate('new')}>
          + Nový zápas
        </button>
      </header>

      {license && <LicenseBanner license={license} />}

      {matches.length === 0 ? (
        <div className="home-empty">
          <svg viewBox="0 0 300 180" aria-hidden="true">
            <rect x="10" y="10" width="280" height="160" className="ce-floor" />
            <line x1="150" y1="0" x2="150" y2="180" className="ce-net" />
            <line x1="100" y1="10" x2="100" y2="170" />
            <line x1="200" y1="10" x2="200" y2="170" />
            <circle cx="232" cy="62" r="10" className="ce-ball" />
          </svg>
          <h2>Hřiště je připravené</h2>
          <p>Založte první zápas, načtěte soupisku a zapisujte jedním klepnutím.</p>
          <button className="btn btn-primary btn-lg btn-slanted" onClick={() => navigate('new')}>
            + Nový zápas
          </button>
        </div>
      ) : (
        <ul className="match-list">
          {matches.map((m) => {
            const won = setsWon(m);
            return (
              <li key={m.id} className="card match-item">
                <div className="match-main">
                  <div className="match-meta">
                    <span className={`match-status ${m.finished ? 'is-done' : 'is-live'}`}>{m.finished ? 'Ukončen' : 'Probíhá'}</span>
                    <span>{new Date(m.date).toLocaleDateString('cs-CZ')}</span>
                  </div>
                  <div className="match-board">
                    <span className="match-team">{m.team}</span>
                    <span className="match-sets" aria-label={`sety ${won.us}:${won.them}`}>
                      <b>{won.us}</b>
                      <i>:</i>
                      <b>{won.them}</b>
                    </span>
                    <span className="match-team match-opp">{m.opponent}</span>
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

/** Stav licence nad seznamem zápasů: zkušební verze, blížící se konec, vypršení. */
function LicenseBanner({ license }: { license: License }) {
  if (license.kind === 'active') {
    const d = daysLeft(license.until);
    if (d > 30) return null;
    return (
      <p className="banner license-banner" role="status">
        Licence klubu skončí za {d} {d === 1 ? 'den' : d < 5 ? 'dny' : 'dní'}. <a href="#/club">Prodloužit</a>
      </p>
    );
  }
  if (license.kind === 'expired')
    return (
      <p className="banner banner-bad license-banner" role="alert">
        Licence klubu vypršela {license.until.toLocaleDateString('cs-CZ')}. Zápasy si můžete prohlížet, nové zapisovat ne. <a href="#/club">Obnovit licenci</a>
      </p>
    );
  return (
    <p className="banner license-banner" role="status">
      Zkušební verze: {license.left > 0 ? `zbývá ${license.left} z ${TRIAL_MATCHES} zápasů zdarma.` : `využili jste ${TRIAL_MATCHES} zápasy zdarma.`}{' '}
      <a href="#/club">Licence pro klub {LICENSE_PRICE} / sezóna</a>
    </p>
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
        {isNative
          ? 'Zápasy jsou uložené jen v tomto zařízení. Po zápase si uložte zálohu, ať o data nepřijdete při ztrátě zařízení.'
          : 'Zápasy se ukládají do vašeho účtu. Záloha do souboru se hodí pro archiv nebo přenos mezi účty.'}{' '}
        Úložiště v zařízení je zaplněné z {pct} %.
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

