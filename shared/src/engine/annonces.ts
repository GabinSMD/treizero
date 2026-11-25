/**
 * Appel vocal des parties sur l'écran d'affichage.
 *
 * Le jour du concours, la table de marque appelle les parties au micro :
 * « Équipes 12 et 34, terrain 5 ». L'écran d'affichage peut le faire à sa
 * place. Ce module décide **quoi** annoncer et **comment le dire** ; la voix
 * elle-même (la synthèse du navigateur) vit côté client.
 *
 * On s'en tient aux numéros : plus courts que les noms, et sans problème de
 * prononciation.
 */
import type { Match, MatchStage, ModeLibelleTerrain, Poule } from '../types';
import { isByeMatch } from './match';
import { libelleTerrain } from './terrains';

/** Les deux camps sont connus, la partie n'est ni jouée ni exempte. */
function appelable(m: Match): boolean {
  if (m.done || isByeMatch(m)) return false;
  const a = Boolean(m.teamAId || (m.playersA && m.playersA.length));
  const b = Boolean(m.teamBId || (m.playersB && m.playersB.length));
  return a && b;
}

function camp(m: Match, cote: 'A' | 'B'): string[] {
  const joueurs = cote === 'A' ? m.playersA : m.playersB;
  if (joueurs && joueurs.length > 0) return joueurs;
  const id = cote === 'A' ? m.teamAId : m.teamBId;
  return id ? [id] : [];
}

/**
 * Ce qui a été annoncé d'une partie : ses deux camps et son terrain.
 *
 * Une partie annoncée sans terrain, puis placée sur un terrain, mérite un
 * nouvel appel — c'est l'information qui manquait. De même si une correction
 * change l'un des camps. Le reste (score, retard…) ne se réannonce pas.
 */
export function signatureAnnonce(m: Match): string | null {
  if (!appelable(m)) return null;
  return `${m.id}|${camp(m, 'A').join(',')}|${camp(m, 'B').join(',')}|${m.terrain ?? '-'}`;
}

const ORDRE_ETAPE: Record<MatchStage, number> = {
  poule: 0,
  ronde: 1,
  principal: 2,
  consolante: 3,
  complementaire: 4,
};

/**
 * Parties à annoncer : celles qu'on peut appeler et dont la signature n'a pas
 * encore été annoncée. Dans l'ordre où la table de marque les appellerait :
 * par étape, par tour, puis par terrain.
 */
export function partiesAAnnoncer(matches: Match[], dejaAnnoncees: ReadonlySet<string>): Match[] {
  return matches
    .filter((m) => {
      const sig = signatureAnnonce(m);
      return sig !== null && !dejaAnnoncees.has(sig);
    })
    .sort(
      (a, b) =>
        ORDRE_ETAPE[a.stage] - ORDRE_ETAPE[b.stage] ||
        a.round - b.round ||
        (a.terrain ?? Number.MAX_SAFE_INTEGER) - (b.terrain ?? Number.MAX_SAFE_INTEGER) ||
        a.position - b.position,
    );
}

/** Signatures de toutes les parties appelables : ce qu'on tient pour déjà appelé. */
export function signaturesActuelles(matches: Match[]): string[] {
  return matches.map(signatureAnnonce).filter((s): s is string => s !== null);
}

/** Tour de tableau dit à voix haute, au singulier : on annonce une partie. */
const TOURS_PARLES: Record<number, string> = {
  2: 'Finale',
  4: 'Demi-finale',
  8: 'Quart de finale',
  16: 'Huitième de finale',
  32: 'Seizième de finale',
  64: 'Trente-deuxième de finale',
  128: 'Soixante-quatrième de finale',
};

const NOM_TABLEAU: Partial<Record<MatchStage, string>> = {
  consolante: 'Consolante',
  complementaire: 'Complémentaire',
};

/**
 * Ce que précède l'appel : « Poule 3, barrage », « Ronde 2 », « Quart de
 * finale », « Consolante, demi-finale ».
 */
export function contexteAnnonce(m: Match, poules: Poule[], matches: Match[]): string {
  if (m.stage === 'poule') {
    const poule = poules.find((p) => p.id === m.pouleId);
    const nom = poule ? `Poule ${poule.index}` : 'Poule';
    if (m.pouleSlot === 'GAGNANTS') return `${nom}, partie des gagnants`;
    if (m.pouleSlot === 'PERDANTS') return `${nom}, partie des perdants`;
    if (m.pouleSlot === 'BARRAGE') return `${nom}, barrage`;
    return nom;
  }
  if (m.stage === 'ronde') return `Ronde ${m.round + 1}`;

  const tableau = matches.filter((x) => x.stage === m.stage);
  const dernierTour = Math.max(...tableau.map((x) => x.round), m.round);
  const taille = 1 << (dernierTour + 1);
  const cadrage = m.round === 0 && tableau.some((x) => x.round === 0 && isByeMatch(x));
  const tour = cadrage ? 'Cadrage' : (TOURS_PARLES[taille >> m.round] ?? `Tour ${m.round + 1}`);
  const nom = NOM_TABLEAU[m.stage];
  return nom ? `${nom}, ${tour.charAt(0).toLowerCase()}${tour.slice(1)}` : tour;
}

/** « équipe 12 », « joueurs 3 et 8 », « joueurs 3, 8 et 11 ». */
function nommerCamp(numeros: number[], individuel: boolean): string {
  if (numeros.length === 0) return 'équipe à venir';
  const mot = individuel ? 'joueur' : 'équipe';
  if (numeros.length === 1) return `${mot} ${numeros[0]}`;
  const tete = numeros.slice(0, -1).join(', ');
  return `${mot}s ${tete} et ${numeros[numeros.length - 1]}`;
}

export interface OptionsAnnonce {
  /** Dossard d'une équipe (ou d'un participant de mêlée) par identifiant. */
  numeroDe: (id: string) => number | undefined;
  poules: Poule[];
  matches: Match[];
  libelleTerrains?: ModeLibelleTerrain;
  decalageTerrain?: number;
}

/**
 * La phrase annoncée : « Poule 3, barrage : équipe 12 contre équipe 34,
 * terrain 5. » Les camps de mêlée sont des joueurs : « joueurs 3 et 8 contre
 * joueurs 5 et 9 ».
 */
export function phraseAnnonce(m: Match, o: OptionsAnnonce): string {
  const individuel = Boolean(m.playersA?.length || m.playersB?.length);
  const numeros = (cote: 'A' | 'B') =>
    camp(m, cote)
      .map((id) => o.numeroDe(id))
      .filter((n): n is number => typeof n === 'number');
  const terrain = m.terrain
    ? `, terrain ${libelleTerrain(m.terrain, o.libelleTerrains, o.decalageTerrain)}`
    : '';
  return (
    `${contexteAnnonce(m, o.poules, o.matches)} : ` +
    `${nommerCamp(numeros('A'), individuel)} contre ${nommerCamp(numeros('B'), individuel)}` +
    `${terrain}.`
  );
}
