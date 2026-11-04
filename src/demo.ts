import type { ActionType, Match, MatchEvent, Player } from './types';
import { isSetOver, setScores } from './stats';

/** Ukázkový rozehraný zápas pro online náhled (build s --mode demo). Jména jsou smyšlená. */
export function createDemoMatch(): Match {
  const players: Player[] = [
    { id: 'p1', number: '1', name: 'Kučera Jakub', libero: true },
    { id: 'p3', number: '3', name: 'Horák Martin', position: 'smečař' },
    { id: 'p4', number: '4', name: 'Beneš Lukáš', position: 'blokař' },
    { id: 'p7', number: '7', name: 'Pokorný Tomáš', position: 'univerzál' },
    { id: 'p9', number: '9', name: 'Marek David', position: 'smečař' },
    { id: 'p11', number: '11', name: 'Fiala Ondřej', position: 'blokař' },
    { id: 'p12', number: '12', name: 'Zeman Vojtěch', position: 'nahrávač' },
    { id: 'p15', number: '15', name: 'Růžička Petr', position: 'smečař' },
    { id: 'p17', number: '17', name: 'Kolář Adam', position: 'blokař' },
  ];
  const court = ['p3', 'p4', 'p7', 'p9', 'p11', 'p12'];
  const oppPlayers: Player[] = [
    { id: 'o2', number: '2', name: 'Svoboda Jan', libero: true },
    { id: 'o5', number: '5', name: 'Dvořák Karel', position: 'nahrávač' },
    { id: 'o6', number: '6', name: 'Černý Pavel', position: 'smečař' },
    { id: 'o8', number: '8', name: 'Procházka Filip', position: 'blokař' },
    { id: 'o10', number: '10', name: 'Kučera Roman', position: 'univerzál' },
    { id: 'o13', number: '13', name: 'Veselý Michal', position: 'smečař' },
    { id: 'o14', number: '14', name: 'Horák Daniel', position: 'blokař' },
    { id: 'o18', number: '18', name: 'Němec Jiří', position: 'smečař' },
  ];
  const oppCourt = ['o5', 'o6', 'o8', 'o10', 'o13', 'o14'];
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = <T,>(list: T[]) => list[Math.floor(rnd() * list.length)];
  const weighted = (w: [ActionType, number][]) => {
    let r = rnd() * w.reduce((s, [, n]) => s + n, 0);
    return w.find(([, n]) => (r -= n) < 0)![0];
  };

  const match: Match = {
    id: 'demo',
    createdAt: Date.now(),
    date: new Date().toLocaleDateString('sv-SE'),
    team: 'TJ Ukázka',
    opponent: 'VK Soupeř',
    setsToWin: 3,
    players,
    onCourt: ['p1', ...court],
    oppPlayers,
    oppOnCourt: ['o2', ...oppCourt],
    subs: [],
    events: [],
    currentSet: 1,
    finished: false,
  };
  const add = (type: ActionType, playerId?: string, team?: 'them') =>
    match.events.push({ id: String(match.events.length), set: match.currentSet, type, playerId, team, t: 0 } as MatchEvent);

  const rally = () => {
    if (rnd() < 0.5) add('rcv', rnd() < 0.5 ? 'p1' : pick(court));
    if (rnd() < 0.3) add('atk', pick(court));
    if (rnd() < 0.4) add(rnd() < 0.85 ? 'srv' : 'srvErr', pick(court));
    if (rnd() < 0.4) add('rcv', rnd() < 0.5 ? 'o2' : pick(oppCourt), 'them');
    if (rnd() < 0.3) add('atk', pick(oppCourt), 'them');
    if (rnd() < 0.55) {
      const t = weighted([['atkKill', 60], ['blk', 14], ['srvAce', 10], ['oppErr', 16]]);
      // Chyby soupeře většinou přiřadit konkrétnímu hráči soupeře
      if (t === 'oppErr' && rnd() < 0.7) add(weighted([['atkErr', 50], ['srvErr', 35], ['err', 15]]), pick(oppCourt), 'them');
      else add(t, t === 'oppErr' ? undefined : pick(court));
    } else {
      const t = weighted([['oppPoint', 45], ['atkErr', 15], ['atkBlocked', 10], ['rcvErr', 15], ['err', 5]]);
      if (t === 'oppPoint' && rnd() < 0.7) add(weighted([['atkKill', 80], ['srvAce', 20]]), pick(oppCourt), 'them');
      else add(t, t === 'oppPoint' ? undefined : t === 'rcvErr' && rnd() < 0.5 ? 'p1' : pick(court));
    }
  };

  while (!isSetOver(setScores(match)[0], 1, 3)) rally();
  match.currentSet = 2;
  while (setScores(match)[1].us + setScores(match)[1].them < 26) rally();
  return match;
}
