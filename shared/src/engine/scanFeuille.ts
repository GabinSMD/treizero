/**
 * Scan des licences sur la feuille de match d'un championnat des clubs ou de
 * la Coupe de France (manuel §3.E), « à la volée » comme l'inscription au
 * lecteur (§3.B.2-3.B.3, voir `scanInscription`).
 *
 * Une fiche de club compte huit joueurs. La neuvième licence n'a pas sa place :
 * elle est refusée, avec sa raison. Et quand la formation est complète, les
 * scans passent à la fiche suivante du même club — Equipe A, puis B, jusqu'à
 * H —, créée si elle n'existe pas encore.
 */
import {
  LETTRES_EQUIPE,
  type FeuilleMatch,
  type LettreEquipe,
  feuilleVierge,
  libelleEquipeClub,
} from './feuilleMatch';
import { placerScan, type PlacementScan } from './scanInscription';

/**
 * Joueurs d'une fiche : « le coach ou capitaine et les huit joueurs » — le
 * coach qui ne joue pas a ses propres cases, hors composition.
 */
export const FORMATION_FEUILLE = 8;

/**
 * Fiches du même club pour la même journée de la même compétition : les
 * équipes A à H qu'il engage. L'adversaire n'en fait pas partie — chaque
 * équipe du club rencontre le sien.
 */
export function fichesDuClub(
  feuilles: readonly FeuilleMatch[],
  courante: FeuilleMatch,
): FeuilleMatch[] {
  const club = courante.club.trim().toLocaleLowerCase('fr');
  return feuilles.filter(
    (f) =>
      f.id !== courante.id &&
      f.equipe !== undefined &&
      f.competition === courante.competition &&
      f.date === courante.date &&
      f.club.trim().toLocaleLowerCase('fr') === club,
  );
}

/**
 * Place une licence scannée sur la fiche `courante`, dont la composition en
 * cours est `licences` (elle peut devancer la base : voir l'écran).
 *
 * Un joueur ne joue que dans une équipe du club : une licence déjà portée par
 * une fiche sœur est refusée, en nommant l'équipe. L'écran y joint la fiche
 * qu'il vient de quitter telle qu'il l'a écrite, sans attendre la base : la
 * relecture du dernier joueur de A ne doit pas entrer dans B.
 */
export function placerScanFeuille(
  courante: FeuilleMatch,
  licences: readonly string[],
  licence: string,
  soeurs: readonly FeuilleMatch[],
): PlacementScan {
  if (courante.signatures.a || courante.signatures.b) {
    return {
      ok: false,
      raison: `Feuille signée : la licence ${licence} n'est pas ajoutée. Effacez les signatures pour corriger.`,
    };
  }
  const dejaInscrites = new Map<string, string>();
  for (const f of soeurs) {
    for (const l of f.licences) dejaInscrites.set(l, libelleEquipeClub(f.equipe, f.club));
  }
  return placerScan(licences, licence, FORMATION_FEUILLE, {
    dejaInscrites,
    enInscription: new Set(),
    siComplete: (l) =>
      `la licence ${l} n'entre pas sur cette fiche. Retirez un joueur pour lui faire de la ` +
      'place, ou scannez-la sur la fiche d\'une autre équipe du club.',
  });
}

export type FicheSuivante =
  | { type: 'existante'; feuille: FeuilleMatch }
  | { type: 'nouvelle'; feuille: FeuilleMatch }
  | { type: 'aucune'; raison: string };

/**
 * La fiche qui reçoit les scans quand `courante` est complète : la première
 * lettre après la sienne dont la fiche existe et a de la place, ou n'existe pas
 * encore — elle naît alors avec l'identité de la courante (compétition, date,
 * club, contingent, filtres). L'adversaire, la division et la poule restent à
 * saisir : ils changent d'une équipe du club à l'autre.
 *
 * Une fiche signée ou déjà complète est sautée : on n'y ajoute rien.
 */
export function ficheSuivante(
  feuilles: readonly FeuilleMatch[],
  courante: FeuilleMatch,
  nouvelId: () => string,
): FicheSuivante {
  if (!courante.equipe) {
    return {
      type: 'aucune',
      raison:
        `Formation complète (${FORMATION_FEUILLE} joueurs). Pour enchaîner sur l'équipe suivante ` +
        'du club, choisissez d\'abord la lettre de celle-ci (Equipe A à H).',
    };
  }
  const soeurs = fichesDuClub(feuilles, courante);
  const apres = LETTRES_EQUIPE.slice(LETTRES_EQUIPE.indexOf(courante.equipe) + 1);
  for (const lettre of apres) {
    const existantes = soeurs.filter((f) => f.equipe === lettre);
    if (existantes.length === 0) {
      return { type: 'nouvelle', feuille: ficheVierge(courante, lettre, nouvelId()) };
    }
    const libre = existantes.find(
      (f) => !f.signatures.a && !f.signatures.b && f.licences.length < FORMATION_FEUILLE,
    );
    if (libre) return { type: 'existante', feuille: libre };
  }
  return {
    type: 'aucune',
    raison:
      `Formation complète (${FORMATION_FEUILLE} joueurs). ` +
      (apres.length === 0
        ? 'L\'équipe H est la dernière : pas de fiche suivante.'
        : 'Les fiches suivantes du club sont complètes ou signées.'),
  };
}

function ficheVierge(courante: FeuilleMatch, lettre: LettreEquipe, id: string): FeuilleMatch {
  const vierge = feuilleVierge(id, courante.date, courante.competition);
  return {
    ...vierge,
    ...(courante.filtres ? { filtres: courante.filtres } : {}),
    equipe: lettre,
    maxMutes: courante.maxMutes,
    mutations: courante.mutations,
    club: courante.club,
    numeroClub: courante.numeroClub,
    courrielComite: courante.courrielComite,
  };
}
