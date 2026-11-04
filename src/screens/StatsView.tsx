import { useMemo, useState } from 'react';
import type { Match } from '../types';
import {
  COLS,
  GROUPS,
  bestValues,
  buildReport,
  fmt,
  isBest,
  isGroupStart,
  reportFileName,
  reportTitle,
  reportToTable,
  type TeamReport,
} from '../report';
import { canShareFiles, downloadBlob, isShareCancel, shareFile } from '../share';
import { navigate } from '../router';
import { positionShort } from '../positions';

const isNative = !!window.Capacitor?.isNativePlatform?.();
// Online náhled (mode demo) běží v sandboxu, který stahování ani sdílení nepovolí.
const exportable = import.meta.env.MODE !== 'demo';

export function StatsView({ match }: { match: Match }) {
  const [set, setSet] = useState(0);
  const [copyState, setCopyState] = useState<'idle' | 'ok' | 'fail'>('idle');
  const [pdfState, setPdfState] = useState<'idle' | 'busy' | 'fail'>('idle');
  const [canShare] = useState(canShareFiles);
  const [hideEmpty, setHideEmpty] = useState(true);
  const [sortCol, setSortCol] = useState<number | null>(null);

  // Řazení a skrytí hráčů platí i pro PDF, CSV a kopírování – export odpovídá tomu, co je vidět.
  const report = useMemo(() => buildReport(match, set, { hideEmpty, sortCol }), [match, set, hideEmpty, sortCol]);
  const { teams, oppErr, oppPoint, scores, won } = report;
  const playedSets = scores.length;
  const fileName = reportFileName(report);

  async function copy() {
    try {
      await navigator.clipboard.writeText(reportToTable(report, '\t'));
      setCopyState('ok');
    } catch {
      setCopyState('fail');
    }
    setTimeout(() => setCopyState('idle'), 2500);
  }

  async function exportPdf(action: 'share' | 'download') {
    setPdfState('busy');
    try {
      // PDF modul se načte až při exportu, aby nezdržoval start aplikace.
      const { reportToPdf } = await import('../pdf');
      const pdf = await reportToPdf(report);
      if (action === 'share') await shareFile(pdf, `${fileName}.pdf`, `Statistika ${reportTitle(report)}`);
      else downloadBlob(pdf, `${fileName}.pdf`);
      setPdfState('idle');
    } catch (e) {
      setPdfState(isShareCancel(e) ? 'idle' : 'fail');
    }
  }

  return (
    <main className="page page-wide">
      <header className="page-header no-print">
        <button className="btn btn-ghost" onClick={() => navigate(match.finished ? '' : `match/${match.id}`)}>
          ‹ {match.finished ? 'Zápasy' : 'Zpět k záznamu'}
        </button>
        <div className="actions">
          {exportable && canShare && (
            <button className="btn btn-primary" onClick={() => exportPdf('share')} disabled={pdfState === 'busy'}>
              {pdfState === 'busy' ? 'Připravuji PDF…' : 'Sdílet PDF'}
            </button>
          )}
          {exportable && !isNative && (
            <>
              <button className={`btn ${canShare ? '' : 'btn-primary'}`} onClick={() => exportPdf('download')} disabled={pdfState === 'busy'}>
                Stáhnout PDF
              </button>
              <button
                className="btn"
                onClick={() => downloadBlob(new Blob(['\uFEFF' + reportToTable(report, ';')], { type: 'text/csv;charset=utf-8' }), `${fileName}.csv`)}
              >
                Stáhnout CSV
              </button>
            </>
          )}
          <button className="btn" onClick={copy}>
            {copyState === 'ok' ? 'Zkopírováno ✓' : copyState === 'fail' ? 'Kopírování se nepodařilo' : 'Kopírovat tabulku'}
          </button>
        </div>
      </header>

      {pdfState === 'fail' && (
        <p className="banner banner-bad no-print" role="alert">
          PDF se nepodařilo vytvořit nebo odeslat. Zkuste to prosím znovu.
        </p>
      )}

      <div className="stats-title">
        <h1>{match.team}</h1>
        <p>
          vs {match.opponent} · {new Date(match.date).toLocaleDateString('cs-CZ')} · sety <strong>{won.us}:{won.them}</strong>{' '}
          <span className="muted">({scores.map((s) => `${s.us}:${s.them}`).join(', ')})</span>
        </p>
      </div>

      <div className="stats-filters no-print">
        <div className="chips" role="group" aria-label="Zobrazit statistiku">
          {[0, ...Array.from({ length: playedSets }, (_, i) => i + 1)].map((n) => (
            <button key={n} className={`btn btn-sm ${set === n ? 'btn-primary' : ''}`} aria-pressed={set === n} onClick={() => setSet(n)}>
              {n ? `${n}. set` : 'Celý zápas'}
            </button>
          ))}
        </div>
        <label className="check">
          <input type="checkbox" checked={hideEmpty} onChange={(e) => setHideEmpty(e.target.checked)} />
          Jen hráči se zapsanou akcí
        </label>
      </div>

      {teams.map((t) => (
        <StatsTable
          key={t.side}
          team={t}
          caption={`${t.name} – ${set ? `${set}. set` : 'celý zápas'}`}
          showName={teams.length > 1}
          sortCol={sortCol}
          onSort={setSortCol}
        />
      ))}

      <p className="muted no-print">Klepnutím na název sloupce seřadíte hráče, klepnutím na # zpět podle čísla. Zeleně je nejlepší hodnota v týmu.</p>

      <p className="muted">
        Body bez určení hráče: {match.team} <strong>{oppErr}</strong> (chyby soupeře) · {match.opponent} <strong>{oppPoint}</strong>
      </p>
    </main>
  );
}

interface StatsTableProps {
  team: TeamReport;
  caption: string;
  showName: boolean;
  sortCol: number | null;
  onSort: (col: number | null) => void;
}

function StatsTable({ team, caption, showName, sortCol, onSort }: StatsTableProps) {
  const best = bestValues(team.rows);
  return (
    <section className={`stats-team team-${team.side}`} aria-label={caption}>
      {showName && <h2 className="stats-team-name">{team.name}</h2>}
      <div className="grid-wrap">
        <table className="stats-table">
          <caption className="sr-only">Statistika hráčů – {caption}</caption>
          <thead>
            <tr>
              <th rowSpan={2} scope="col" aria-sort={sortCol === null ? 'ascending' : undefined}>
                <button className="th-sort" onClick={() => onSort(null)} aria-label="Seřadit podle čísla dresu">
                  #
                </button>
              </th>
              <th rowSpan={2} scope="col" className="sticky-col">
                Hráč
              </th>
              {GROUPS.map((g) => (
                <th key={g.name} colSpan={g.span} scope="colgroup" className="group-head">
                  {g.name}
                </th>
              ))}
            </tr>
            <tr>
              {COLS.map((c, i) => (
                <th
                  key={c.group + c.label}
                  scope="col"
                  className={isGroupStart(i) ? 'group-start' : undefined}
                  aria-sort={sortCol === i ? 'descending' : undefined}
                >
                  <button className="th-sort" onClick={() => onSort(sortCol === i ? null : i)} aria-label={`Seřadit podle: ${c.group} ${c.label}`}>
                    {c.label}
                    {sortCol === i && ' ▾'}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {team.rows.map(({ player, stats }) => (
              <tr key={player.id}>
                <td className="num">{player.number}</td>
                <th scope="row" className="sticky-col">
                  {player.name || '–'}
                  {positionShort(player) && <span className="muted"> ({positionShort(player)})</span>}
                </th>
                {COLS.map((c, i) => (
                  <td
                    key={c.group + c.label}
                    className={[isGroupStart(i) && 'group-start', isBest(best, i, stats) && 'best'].filter(Boolean).join(' ') || undefined}
                  >
                    {fmt(c.get(stats), c)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <th scope="row" className="sticky-col">
                CELKEM
              </th>
              {COLS.map((c, i) => (
                <td key={c.group + c.label} className={isGroupStart(i) ? 'group-start' : undefined}>
                  {fmt(c.get(team.total), c)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </section>
  );
}
