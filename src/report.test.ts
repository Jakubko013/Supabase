// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { createDemoMatch } from './demo';
import { buildReport, reportToTable } from './report';

describe('export tabulky', () => {
  it('text začínající jako vzorec Excelu zneškodní, záporná čísla nechá', () => {
    const m = createDemoMatch();
    m.players[1].name = '=HYPERLINK("http://example.com";"klik")';
    const csv = reportToTable(buildReport(m, 0), ';');
    const row = csv.split('\r\n').find((l) => l.includes('HYPERLINK'))!;
    expect(row).toContain(`"'=HYPERLINK(`);
    expect(csv).toMatch(/;-\d+;/); // +/− s mínusem zůstává číslem
  });
});
