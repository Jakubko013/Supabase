/** Post hráče (cvf.cz u žen uvádí ženský tvar, ukládá se jednotně). */
export type Position = 'nahrávač' | 'smečař' | 'blokař' | 'univerzál' | 'libero';

export interface Player {
  id: string;
  number: string;
  name: string;
  libero?: boolean;
  position?: Position;
}

/** Akce hráče našeho týmu. */
export type PlayerAction =
  | 'srvAce'
  | 'srv'
  | 'srvErr'
  | 'rcv'
  | 'rcvErr'
  | 'atkKill'
  | 'atk'
  | 'atkErr'
  | 'atkBlocked'
  | 'blk'
  | 'err';

/** Týmové akce bez konkrétního hráče. */
export type TeamAction = 'oppErr' | 'oppPoint';

export type ActionType = PlayerAction | TeamAction;

/** Strana sítě: náš tým, nebo soupeř. */
export type Side = 'us' | 'them';

export interface MatchEvent {
  id: string;
  set: number;
  type: ActionType;
  playerId?: string;
  /** Akce hráče soupeře; chybí = náš tým (i u starších zápasů). */
  team?: 'them';
  t: number;
}

/** Střídání během setu (bez libera); podle pravidel tvoří odcházející a přicházející hráč dvojici. */
export interface Substitution {
  set: number;
  side: Side;
  out: string;
  in: string;
}

export interface Match {
  id: string;
  createdAt: number;
  date: string;
  team: string;
  opponent: string;
  competitionId?: string;
  /** Počet vítězných setů potřebných k výhře (3 = na tři vítězné). */
  setsToWin: number;
  players: Player[];
  /** Id hráčů aktuálně na hřišti, ostatní jsou na lavičce. */
  onCourt: string[];
  /** Soupiska soupeře – prázdná, když se soupeř nezapisuje. */
  oppPlayers: Player[];
  oppOnCourt: string[];
  subs: Substitution[];
  events: MatchEvent[];
  currentSet: number;
  finished: boolean;
}
