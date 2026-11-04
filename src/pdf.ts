import { COLS, GROUPS, bestValues, fmt, isBest, reportTitle, setLabel, type Report, type TeamReport } from './report';
import { positionShort } from './positions';

/** A4 na šířku v bodech PDF. */
const PAGE = { w: 842, h: 595 };
/** Kreslicí plocha ve stejném poměru stran; SCALE určuje ostrost (≈ 240 DPI). */
const W = 1123;
const H = 794;
const SCALE = 2.5;
const FONT = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
const C = {
  text: '#0f172a',
  muted: '#475569',
  line: '#cbd5e1',
  headText: '#ffffff',
  us: { head: '#1d4ed8', sub: '#dbeafe' },
  them: { head: '#c2410c', sub: '#ffedd5' },
  zebra: '#f1f5f9',
  total: '#e2e8f0',
  good: '#15803d',
  bestBg: '#dcfce7',
  bad: '#b91c1c',
};

const M = 40;
const TOP = M + 70;
const FOOTER_Y = H - M;
const TEAM_NAME_H = 24;
const HEAD_H = 26 + 22;
const TEAM_GAP = 18;
/** Pod tuto výšku řádku (px) už je text špatně čitelný – týmy se pak rozdělí na samostatné strany. */
const MIN_ROW_H = 15;

/** Výška řádku tak, aby se tabulky všech týmů vešly na stranu. */
function rowHeight(teams: TeamReport[], showNames: boolean): number {
  const fixed = teams.length * (HEAD_H + (showNames ? TEAM_NAME_H : 0)) + (teams.length - 1) * TEAM_GAP;
  const rows = teams.reduce((n, t) => n + t.rows.length + 1, 0);
  return Math.min(26, (FOOTER_Y - 28 - TOP - fixed) / rows);
}

/**
 * Vykreslí stranu statistiky do obrázku. Kreslí se přes canvas, takže diakritika funguje
 * se systémovým písmem a PDF nepotřebuje vložené fonty ani knihovnu.
 */
function drawPage(r: Report, teams: TeamReport[], page: string): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = W * SCALE;
  canvas.height = H * SCALE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas není dostupný');
  ctx.scale(SCALE, SCALE);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = 'middle';

  const font = (size: number, weight = 400) => (ctx.font = `${weight} ${size}px ${FONT}`);
  const text = (s: string, x: number, y: number, align: CanvasTextAlign = 'left', color = C.text) => {
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
  };
  const fit = (s: string, max: number) => {
    if (ctx.measureText(s).width <= max) return s;
    while (s.length > 1 && ctx.measureText(`${s}…`).width > max) s = s.slice(0, -1);
    return `${s}…`;
  };

  const x0 = M;
  const x1 = W - M;
  const numW = 40;
  const nameW = 230;
  const colW = (x1 - x0 - numW - nameW) / COLS.length;
  const colX = (i: number) => x0 + numW + nameW + i * colW;
  const showNames = r.teams.length > 1;

  // Hlavička strany
  font(26, 700);
  text(fit(reportTitle(r), x1 - x0), x0, M + 12);
  const sets = r.scores.map((s) => `${s.us}:${s.them}`).join(', ');
  font(15);
  text(
    `${new Date(r.match.date).toLocaleDateString('cs-CZ')} · sety ${r.won.us}:${r.won.them} (${sets}) · ${setLabel(r.set)}${page}`,
    x0,
    M + 42,
    'left',
    C.muted,
  );

  const rowH = rowHeight(teams, showNames);
  const size = Math.max(8, Math.min(14, rowH * 0.56));
  let y = TOP;

  for (const team of teams) {
    const tone = team.side === 'us' ? C.us : C.them;
    if (showNames) {
      font(15, 700);
      text(team.name, x0, y + TEAM_NAME_H / 2 - 2, 'left', tone.head);
      y += TEAM_NAME_H;
    }
    // Hlavička tabulky: skupiny a popisky sloupců
    const top = y;
    ctx.fillStyle = tone.head;
    ctx.fillRect(x0, y, x1 - x0, 26);
    font(12, 700);
    let gi = 0;
    for (const g of GROUPS) {
      text(g.name.toUpperCase(), colX(gi) + (g.span * colW) / 2, y + 13, 'center', C.headText);
      gi += g.span;
    }
    y += 26;
    ctx.fillStyle = tone.sub;
    ctx.fillRect(x0, y, x1 - x0, 22);
    text('#', x0 + numW / 2, y + 11, 'center');
    text('Hráč', x0 + numW + 8, y + 11);
    COLS.forEach((c, i) => text(c.label, colX(i) + colW / 2, y + 11, 'center'));
    y += 22;

    const best = bestValues(team.rows);
    const drawRow = (num: string, name: string, stats: TeamReport['total'], bg: string | null, weight: number, highlight = false) => {
      if (bg) {
        ctx.fillStyle = bg;
        ctx.fillRect(x0, y, x1 - x0, rowH);
      }
      const cy = y + rowH / 2;
      font(size, 700);
      text(num, x0 + numW / 2, cy, 'center');
      font(size, weight);
      text(fit(name, nameW - 12), x0 + numW + 8, cy);
      COLS.forEach((c, i) => {
        const v = c.get(stats);
        const top = highlight && isBest(best, i, stats);
        if (top) {
          ctx.fillStyle = C.bestBg;
          ctx.fillRect(colX(i) + 3, y + 2, colW - 6, rowH - 4);
        }
        const color = c.label === '+/−' && v ? (v > 0 ? C.good : C.bad) : C.text;
        font(size, top ? 800 : weight);
        text(fmt(v, c), colX(i) + colW / 2, cy, 'center', top ? C.good : color);
      });
      y += rowH;
    };
    team.rows.forEach(({ player, stats }, i) =>
      drawRow(player.number, `${player.name || '–'}${positionShort(player) ? ` (${positionShort(player)})` : ''}`, stats, i % 2 ? C.zebra : null, 500, true),
    );
    ctx.fillStyle = C.line;
    ctx.fillRect(x0, y, x1 - x0, 1.5);
    drawRow('', 'CELKEM', team.total, C.total, 800);

    // Svislé čáry mezi skupinami sloupců
    ctx.fillStyle = C.line;
    gi = 0;
    for (const g of GROUPS) {
      ctx.fillRect(colX(gi) - 0.5, top + 26, 1, y - top - 26);
      gi += g.span;
    }
    y += TEAM_GAP;
  }

  // Patička
  font(12);
  text(
    `Body bez určení hráče: ${r.match.team} ${r.oppErr} (chyby soupeře) · ${r.match.opponent} ${r.oppPoint}`,
    x0,
    FOOTER_Y - 6,
    'left',
    C.muted,
  );
  text(`Volejbal Statistika · ${new Date().toLocaleDateString('cs-CZ')}`, x1, FOOTER_Y - 6, 'right', C.muted);
  return canvas;
}

const toJpeg = (canvas: HTMLCanvasElement) =>
  new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Obrázek se nepodařilo vytvořit'))), 'image/jpeg', 0.92),
  );

/** Oba týmy na jednu stranu; když by byl text moc malý, každý tým na vlastní stranu. */
export async function reportToPdf(r: Report): Promise<Blob> {
  const groups = rowHeight(r.teams, r.teams.length > 1) >= MIN_ROW_H ? [r.teams] : r.teams.map((t) => [t]);
  const pages: PdfImage[] = [];
  for (const [i, teams] of groups.entries()) {
    const canvas = drawPage(r, teams, groups.length > 1 ? ` · strana ${i + 1}/${groups.length}` : '');
    pages.push({ jpeg: new Uint8Array(await (await toJpeg(canvas)).arrayBuffer()), width: canvas.width, height: canvas.height });
  }
  return imagePdf(pages, `Statistika ${reportTitle(r)}`);
}

/** Text pro PDF v UTF-16BE, aby fungovala diakritika (např. v názvu dokumentu). */
const pdfString = (s: string) =>
  `<FEFF${Array.from({ length: s.length }, (_, i) => s.charCodeAt(i).toString(16).padStart(4, '0')).join('')}>`;

export interface PdfImage {
  jpeg: Uint8Array<ArrayBuffer>;
  width: number;
  height: number;
}

/** PDF se stranami A4 na šířku, každá strana je jeden JPEG obrázek přes celou plochu. */
export function imagePdf(pages: PdfImage[], title: string): Blob {
  const enc = new TextEncoder();
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  const offsets: number[] = [];
  let size = 0;
  const push = (d: string | Uint8Array<ArrayBuffer>) => {
    const bytes = typeof d === 'string' ? enc.encode(d) : d;
    chunks.push(bytes);
    size += bytes.length;
  };
  const obj = (id: number, ...body: (string | Uint8Array<ArrayBuffer>)[]) => {
    offsets[id] = size;
    push(`${id} 0 obj\n`);
    body.forEach(push);
    push('\nendobj\n');
  };

  // Objekty: 1 katalog, 2 seznam stran, pro každou stranu 3 (strana, obrázek, obsah), nakonec informace o dokumentu.
  const pageId = (i: number) => 3 + i * 3;
  const infoId = 3 + pages.length * 3;
  const content = `q ${PAGE.w} 0 0 ${PAGE.h} 0 0 cm /Im0 Do Q`;
  push('%PDF-1.4\n');
  obj(1, '<< /Type /Catalog /Pages 2 0 R >>');
  obj(2, `<< /Type /Pages /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] /Count ${pages.length} >>`);
  pages.forEach((p, i) => {
    const id = pageId(i);
    obj(
      id,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE.w} ${PAGE.h}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`,
    );
    obj(
      id + 1,
      `<< /Type /XObject /Subtype /Image /Width ${p.width} /Height ${p.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${p.jpeg.length} >>\nstream\n`,
      p.jpeg,
      '\nendstream',
    );
    obj(id + 2, `<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
  });
  obj(infoId, `<< /Title ${pdfString(title)} /Producer (Volejbal Statistika) >>`);

  const xref = size;
  const count = infoId + 1;
  push(`xref\n0 ${count}\n0000000000 65535 f \n${offsets.slice(1).map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`);
  push(`trailer\n<< /Size ${count} /Root 1 0 R /Info ${infoId} 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  return new Blob(chunks, { type: 'application/pdf' });
}
