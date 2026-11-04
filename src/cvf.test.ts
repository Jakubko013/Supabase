import { describe, expect, it } from 'vitest';
import { parseCompetitionId, parseCompetitions, parseQuickPlayers, parseRoster, parseRosterText, parseTeams } from './cvf';

describe('cvf', () => {
  it('vytáhne číslo soutěže z URL i čísla', () => {
    expect(parseCompetitionId('https://www.cvf.cz/souteze/celostatni-souteze?mode=clubs&competitionId=18658')).toBe('18658');
    expect(parseCompetitionId(' 18658 ')).toBe('18658');
    expect(parseCompetitionId('cvf.cz')).toBeNull();
  });

  it('najde soutěže dospělých v přehledu soutěží', () => {
    const row = (id: number, name: string) =>
      `<tr><td><a href="/souteze/celostatni-souteze?mode=program&amp;competitionId=${id}" class="h4"> ${name}</a></td>` +
      `<td><a href="?mode=program&amp;competitionId=${id}" class="link">Program</a></td></tr>`;
    const html = `<table class="programsTable"><tbody>${row(18656, 'ČEZ Extraliga muži')}${row(18661, '2. liga ženy')}${row(18670, 'Extraliga chlapci U18')}</tbody></table>`;
    expect(parseCompetitions(html)).toEqual([
      { id: '18656', name: 'ČEZ Extraliga muži' },
      { id: '18661', name: '2. liga ženy' },
    ]);
  });

  it('najde družstva podle odkazů s teamId', () => {
    const html = `
      <a href="?teamId=2&competitionId=1&mode=clubs"><img alt="Logo"></a>
      <a href="?teamId=2&competitionId=1&mode=clubs">VK Kralupy</a>
      <a href="?teamId=1&competitionId=1&mode=clubs">SKV Kolín</a>
      <a href="/jinam">Jinam</a>`;
    expect(parseTeams(html)).toEqual([
      { id: '1', name: 'SKV Kolín' },
      { id: '2', name: 'VK Kralupy' },
    ]);
  });

  it('vytáhne hráče z karet soupisky cvf.cz a vynechá trenéry', () => {
    // Zkrácená struktura stránky družstva na cvf.cz (záložka Soupiska), jména jsou smyšlená.
    const html = `<div class="tab-pane fade" id="results"><a class="playerItem" href="#"><h3>Zápas</h3></a></div><div class="tab-pane fade" id="lineup"><h3 class="h2 mb-4">Soupiska</h3><h2 class="h3 mb-3">Hráči</h2><div class="row g-4 mb-5"><div class="col-lg-4 col-sm-6"><a class="playerItem" href="#"><div class="playerItem__avatar"><div class="playerItem__img"><img alt="ava"></div><div class="playerItem__num">17</div></div><div class="playerItem__content"><h3 class="h4">Jan Novák</h3><div class="fw-bold">smečař</div><div class="p2">23 let</div></div></a></div><div class="col-lg-4 col-sm-6"><a class="playerItem" href="#"><div class="playerItem__avatar"><div class="playerItem__img"><img alt="ava"></div></div><div class="playerItem__content"><h3 class="h4">Petr Dvořák</h3><div class="fw-bold">libero</div><div class="p2">23 let</div></div></a></div><div class="col-lg-4 col-sm-6"><a class="playerItem" href="#"><div class="playerItem__avatar"><div class="playerItem__img"><img alt="ava"></div><div class="playerItem__num">3</div></div><div class="playerItem__content"><h3 class="h4">Tomáš Černý</h3><div class="p2">23 let</div></div></a></div></div><h2 class="h3 mb-3">Trenéři/funkcionáři</h2><div class="row g-4"><div class="col-lg-4 col-sm-6"><a class="playerItem" href="#"><div class="playerItem__avatar"><div class="playerItem__img"><img alt="ava"></div></div><div class="playerItem__content"><h3 class="h4">Karel Svoboda</h3><div class="p2">23 let</div></div></a></div><div class="col-lg-4 col-sm-6"><a class="playerItem" href="#"><div class="playerItem__avatar"><div class="playerItem__img"><img alt="ava"></div></div><div class="playerItem__content"><h3 class="h4">Jan Novák</h3><div class="p2">23 let</div></div></a></div></div></div>`;
    expect(parseRoster(html)).toEqual([
      { number: '17', name: 'Jan Novák', libero: undefined, position: 'smečař' },
      { number: '', name: 'Petr Dvořák', libero: true, position: 'libero' },
      { number: '3', name: 'Tomáš Černý', libero: undefined },
    ]);
  });

  it('přečte rychle zadaná čísla hráčů', () => {
    expect(parseQuickPlayers('1 3 5  7 2L')).toEqual([
      { number: '1', name: '', libero: undefined },
      { number: '3', name: '', libero: undefined },
      { number: '5', name: '', libero: undefined },
      { number: '7', name: '', libero: undefined },
      { number: '2', name: '', libero: true },
    ]);
    expect(parseQuickPlayers('7 Novák Jan, 12, 7 duplicitní')).toEqual([
      { number: '7', name: 'Novák Jan', libero: undefined },
      { number: '12', name: '', libero: undefined },
    ]);
  });

  it('přečte ručně vloženou soupisku', () => {
    const text = '7 Novák Jan\nDvořák Petr 12\n#3. Černý Tomáš (L)\n\nŠťastný Ondřej\n14\tKrál Adam\tnahrávačka';
    expect(parseRosterText(text)).toEqual([
      { number: '7', name: 'Novák Jan', libero: undefined },
      { number: '12', name: 'Dvořák Petr', libero: undefined },
      { number: '3', name: 'Černý Tomáš', libero: true },
      { number: '', name: 'Šťastný Ondřej', libero: undefined },
      { number: '14', name: 'Král Adam', libero: undefined, position: 'nahrávač' },
    ]);
  });
});
