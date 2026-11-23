/**
 * Dépôt des licences (manuel « Gestion Concours » §3.C).
 *
 * Avant un concours officiel, chaque capitaine remet les licences de son
 * équipe : la table de marque les contrôle, puis valide le dépôt. L'écran de
 * statistiques du logiciel fédéral sert à répondre à une seule question —
 * quelles équipes n'ont pas encore présenté leurs licences.
 */
import type { AjoutJoueur, Licencie, Player, Remplacement, Team } from '../types';
import { placerScan } from './scanInscription';

export type { AjoutJoueur, Remplacement };

/** Conformité d'une équipe, telle que la rend `controlerEquipe`. */
export interface EtatDepot {
  teamId: string;
  conforme: boolean;
}

export interface DepotStats {
  /** Équipes attendues (les forfaits ne déposent rien). */
  total: number;
  deposees: number;
  restantes: number;
  nonConformes: number;
  /** Déposées mais non conformes : les cas que l'arbitre doit trancher. */
  deposeesNonConformes: number;
  /** Avancement du dépôt, en pourcentage entier. */
  pourcentage: number;
}

export function depotStats(teams: Team[], etats: EtatDepot[]): DepotStats {
  const attendues = teams.filter((t) => !t.forfait);
  const conformeDe = new Map(etats.map((e) => [e.teamId, e.conforme]));

  const deposees = attendues.filter((t) => t.licencesDeposees).length;
  const nonConformes = attendues.filter((t) => conformeDe.get(t.id) === false).length;
  const deposeesNonConformes = attendues.filter(
    (t) => t.licencesDeposees && conformeDe.get(t.id) === false,
  ).length;

  return {
    total: attendues.length,
    deposees,
    restantes: attendues.length - deposees,
    nonConformes,
    deposeesNonConformes,
    pourcentage: attendues.length === 0 ? 0 : Math.round((deposees / attendues.length) * 100),
  };
}

/**
 * Équipe portant une licence donnée : c'est le geste du dépôt, on scanne une
 * licence et le logiciel ouvre l'équipe correspondante.
 */
export function chercherEquipeParLicence(teams: Team[], licence: string): Team | undefined {
  if (!licence.trim()) return undefined;
  return teams.find((t) => t.players.some((p) => p.licence === licence));
}

/**
 * Ce que dit une licence scannée, **relativement à l'équipe ouverte**.
 *
 * Le logiciel fédéral (copies d'écran p.38-39) ne se contente pas de chercher la
 * licence quelque part : chaque joueur de l'écran porte un bandeau
 * **« EQUIPE : 2 »**, et une licence qui n'appartient pas à l'équipe ouverte
 * fait passer ce bandeau au rouge — **« Pas inscrit ! »** — avec un bouton
 * **« Remplacer »**, tandis que le bouton du bas devient « Annuler ».
 *
 * Trois issues, et elles ne veulent pas dire la même chose :
 *
 *  - `equipe_ouverte` : rien à signaler, c'est bien son joueur ;
 *  - `autre_equipe` : la licence est inscrite **ailleurs**. On le dit, avec le
 *    dossard — mais on ne propose pas de la voler à cette équipe : un joueur
 *    inscrit deux fois est une erreur d'inscription, pas un remplacement ;
 *  - `pas_inscrit` : personne ne la porte. C'est le remplaçant qui se présente,
 *    et c'est le seul cas où le remplacement a un sens.
 *
 * Sans équipe ouverte, une licence connue rend `autre_equipe` : l'écran s'en
 * sert pour ouvrir l'équipe, ce qui reste le geste utile du scan à froid.
 */
export type LectureDepot =
  | { type: 'equipe_ouverte'; index: number }
  | { type: 'autre_equipe'; team: Team }
  | { type: 'pas_inscrit'; fiche?: Licencie };

/**
 * Installe un remplaçant à la place du joueur de rang `index`.
 *
 * Le joueur est **reconstruit depuis la fiche**, pas fusionné sur le précédent :
 * c'est une autre personne. Garder le club ou le rôle de celui qui part ferait
 * mentir la fiche, et la colonne CD (`engine/comites.ts`) avec elle — elle lit
 * `player.comite` avant tout le reste.
 *
 * Ce que la fiche ne dit pas reste vide plutôt que d'être inventé.
 *
 * Un rang hors de l'équipe ne change rien : mieux vaut ne rien faire que
 * déplacer un joueur au hasard.
 */
export function remplacerJoueur(
  team: Team,
  index: number,
  fiche: Licencie,
  at: string,
): Team {
  const sortant = team.players[index];
  if (!sortant) return team;
  const entrant: Player = {
    name: fiche.name,
    ...(fiche.licence ? { licence: fiche.licence } : {}),
    ...(fiche.club ? { club: fiche.club } : {}),
    ...(fiche.comite ? { comite: fiche.comite } : {}),
  };
  const trace: Remplacement = {
    index,
    avant: { name: sortant.name, licence: sortant.licence },
    apres: { name: entrant.name, licence: entrant.licence },
    at,
  };
  return {
    ...team,
    players: team.players.map((p, i) => (i === index ? entrant : p)),
    remplacements: [...(team.remplacements ?? []), trace],
  };
}

/**
 * Places restantes dans l'équipe, jamais négatives.
 *
 * `taillePrevue` est **donnée par l'appelant** et non déduite du concours : en
 * mêlée et au tir, chacun s'inscrit seul et les équipes se tirent à chaque
 * ronde, si bien qu'un participant est déjà complet à un joueur alors que la
 * formation du concours en annonce trois. C'est l'écran qui connaît le mode ; le
 * moteur ne le devine pas.
 *
 * Le plancher à zéro n'est pas décoratif : une équipe en surnombre — donnée
 * abîmée ou reçue d'un appareil plus ancien — rendrait un nombre négatif, et
 * l'écran proposerait « ajouter » en croyant à une place libre.
 */
export function placesLibres(team: Team, taillePrevue: number): number {
  return Math.max(0, taillePrevue - team.players.length);
}

/**
 * Ajoute un joueur en fin d'équipe, au dépôt (manuel §3.C : « ou d'ajouter un
 * joueur lors du dépôt de licence »).
 *
 * Comme `remplacerJoueur`, le joueur est **construit depuis la fiche** : ce que
 * la fiche ne dit pas reste vide plutôt que d'être inventé. Un rôle deviné
 * ferait mentir le tirage des mêlées, un comité deviné la colonne CD.
 *
 * Sur une équipe complète, rien ne change et rien n'est tracé : seul le
 * remplacement a alors un sens. Même principe que le rang hors équipe de
 * `remplacerJoueur` — mieux vaut ne rien faire qu'agir au hasard.
 */
export function ajouterJoueur(
  team: Team,
  fiche: Licencie,
  at: string,
  taillePrevue: number,
): Team {
  if (placesLibres(team, taillePrevue) === 0) return team;
  const entrant: Player = {
    name: fiche.name,
    ...(fiche.licence ? { licence: fiche.licence } : {}),
    ...(fiche.club ? { club: fiche.club } : {}),
    ...(fiche.comite ? { comite: fiche.comite } : {}),
  };
  const trace: AjoutJoueur = {
    index: team.players.length,
    joueur: { name: entrant.name, ...(entrant.licence ? { licence: entrant.licence } : {}) },
    at,
  };
  return {
    ...team,
    players: [...team.players, entrant],
    ajouts: [...(team.ajouts ?? []), trace],
  };
}

export function lireLicenceAuDepot(
  licence: string,
  teams: Team[],
  equipeOuverteId: string | null,
  fiches?: Map<string, Licencie>,
): LectureDepot {
  const num = licence.trim();
  const ouverte = teams.find((t) => t.id === equipeOuverteId);
  const index = ouverte?.players.findIndex((p) => p.licence === num) ?? -1;
  if (index >= 0) return { type: 'equipe_ouverte', index };
  const ailleurs = chercherEquipeParLicence(teams, num);
  if (ailleurs) return { type: 'autre_equipe', team: ailleurs };
  return { type: 'pas_inscrit', fiche: fiches?.get(num) };
}

/* ------------------------------------------------------------------------ */
/* Dépôt « à la volée » (manuel §3.B.2-3.B.3 appliqué au dépôt §3.C)          */
/* ------------------------------------------------------------------------ */

/**
 * Où en est le scan du dépôt : l'équipe ouverte, et celles de ses licences qui
 * ont déjà été scannées. C'est ce que l'écran retient d'un scan à l'autre.
 */
export interface EtatScanDepot {
  ouverte: string | null;
  scannees: string[];
}

export const SCAN_DEPOT_VIDE: EtatScanDepot = { ouverte: null, scannees: [] };

export interface OptionsScanDepot {
  fiches?: Map<string, Licencie>;
  /** Effectif attendu, donné par l'écran qui connaît le mode (voir `placesLibres`). */
  taillePrevue: number;
  /** À la volée : valider le dépôt dès que toute la formation est scannée. */
  aLaVolee: boolean;
  /**
   * Équipes dont le dépôt vient d'être validé et n'est pas encore relu de la
   * base : leur relecture est refusée au lieu d'être validée deux fois.
   */
  enDepot: ReadonlySet<string>;
  /** Une licence « Pas inscrit ! » attend d'être tranchée sur l'équipe ouverte. */
  enSuspens?: boolean;
}

export type IssueScanDepot =
  /** Le scan est compté (ou l'équipe ouverte) ; rien d'autre à faire. */
  | { type: 'compte'; team: Team }
  /** Toute la formation est scannée : l'écran valide le dépôt de `team`. */
  | { type: 'valider'; team: Team }
  /** Licence que personne ne porte, sur une équipe ouverte : bandeau « Pas inscrit ! ». */
  | { type: 'pas_inscrit'; licence: string; fiche?: Licencie }
  /** Scan refusé. `message` en dit toujours la raison. */
  | { type: 'refus' };

export interface ReponseScanDepot {
  etat: EtatScanDepot;
  issue: IssueScanDepot;
  /** Ce que l'écran affiche. Jamais vide pour un refus. */
  message: string | null;
}

const pluriel = (n: number, mot: string): string => `${n} ${mot}${n > 1 ? 's' : ''}`;

/**
 * Un scan au dépôt, « à la volée » : le premier scan d'une équipe l'ouvre, les
 * suivants cochent ses joueurs un à un, et quand toute la formation a été
 * scannée le dépôt se valide tout seul ; l'équipe se referme, et le scan
 * suivant ouvre l'équipe suivante.
 *
 * Le dépôt ne se valide pas tout seul :
 *  - sur une équipe incomplète — c'est au dépôt qu'on ajoute le joueur qui
 *    manque (§3.C), et clore à sa place serait trancher pour l'arbitre ;
 *  - sur une équipe dont un joueur n'a pas de numéro : il ne peut pas être scanné ;
 *  - tant qu'une licence « Pas inscrit ! » attend, comme le bouton « Valider »
 *    fédéral qui devient « Annuler ».
 * Dans ces cas le bouton manuel reste le recours, et le message le dit.
 */
export function scannerAuDepot(
  etat: EtatScanDepot,
  licenceBrute: string,
  teams: Team[],
  options: OptionsScanDepot,
): ReponseScanDepot {
  const licence = licenceBrute.trim();
  const ouverte = teams.find((t) => t.id === etat.ouverte) ?? null;
  const lu = lireLicenceAuDepot(licence, teams, ouverte?.id ?? null, options.fiches);

  if (lu.type === 'pas_inscrit') {
    if (!ouverte) {
      return {
        etat,
        issue: { type: 'refus' },
        message:
          `Licence ${licence} : aucune équipe inscrite ne la porte. Ouvrez l'équipe qui reçoit ` +
          'le remplaçant pour l\'y installer.',
      };
    }
    return { etat, issue: { type: 'pas_inscrit', licence, fiche: lu.fiche }, message: null };
  }

  if (lu.type === 'autre_equipe') {
    if (ouverte) {
      const enCours = scanneesDe(ouverte, etat.scannees).length;
      return {
        etat,
        issue: { type: 'refus' },
        message:
          `Licence ${licence} : inscrite dans l'équipe n°${lu.team.number}, pas dans celle-ci. ` +
          'Un joueur inscrit deux fois est une erreur d\'inscription, pas un remplacement.' +
          (enCours > 0
            ? ` L'équipe n°${ouverte.number} reste ouverte (${enCours}/${ouverte.players.length} ` +
              'licences scannées) : terminez-la ou refermez-la.'
            : ''),
      };
    }
    return compter(lu.team, [], licence, options, true);
  }

  return compter(ouverte!, etat.scannees, licence, options, false);
}

/** Licences scannées qui sont encore celles de l'équipe (un remplacement a pu passer). */
function scanneesDe(team: Team, scannees: readonly string[]): string[] {
  return scannees.filter((l) => team.players.some((p) => p.licence === l));
}

function compter(
  team: Team,
  dejaScannees: readonly string[],
  licence: string,
  { taillePrevue, aLaVolee, enDepot, enSuspens }: OptionsScanDepot,
  ouverture: boolean,
): ReponseScanDepot {
  const fermee: EtatScanDepot = SCAN_DEPOT_VIDE;
  if (enDepot.has(team.id)) {
    return {
      etat: fermee,
      issue: { type: 'refus' },
      message:
        `Licence ${licence} : le dépôt de l'équipe n°${team.number} vient d'être validé ` +
        'et s\'enregistre — rien à refaire.',
    };
  }
  const index = team.players.findIndex((p) => p.licence === licence);
  if (team.licencesDeposees) {
    return {
      etat: { ouverte: team.id, scannees: [] },
      issue: { type: 'compte', team },
      message:
        `Équipe n°${team.number} — licence ${licence} (joueur ${index + 1}) : ` +
        'dépôt déjà validé.',
    };
  }

  const scannees = scanneesDe(team, dejaScannees);
  const placement = placerScan(scannees, licence, team.players.length, {
    dejaInscrites: new Map(),
    enInscription: new Set(),
  });
  if (!placement.ok) {
    return {
      etat: { ouverte: team.id, scannees },
      issue: { type: 'refus' },
      message: placement.raison,
    };
  }

  const suivantes = [...scannees, licence];
  const total = team.players.length;
  const avancement = `${suivantes.length}/${total}`;
  const tete = ouverture
    ? `Équipe n°${team.number} ouverte — licence ${licence} (${avancement}).`
    : `Licence ${licence} : joueur ${index + 1} de l'équipe n°${team.number} (${avancement}).`;
  const resteOuverte: EtatScanDepot = { ouverte: team.id, scannees: suivantes };

  const sansLicence = team.players.filter((p) => !p.licence).length;
  const avecLicence = total - sansLicence;
  if (sansLicence > 0 && suivantes.length === avecLicence) {
    return {
      etat: resteOuverte,
      issue: { type: 'compte', team },
      message:
        `${tete} Toutes les licences sont scannées, mais ${pluriel(sansLicence, 'joueur')} ` +
        `sans numéro ne peu${sansLicence > 1 ? 'vent' : 't'} pas l'être : ` +
        'validez le dépôt à la main.',
    };
  }
  if (!placement.complete) {
    return { etat: resteOuverte, issue: { type: 'compte', team }, message: tete };
  }

  const libres = placesLibres(team, taillePrevue);
  if (libres > 0) {
    return {
      etat: resteOuverte,
      issue: { type: 'compte', team },
      message:
        `${tete} Toutes les licences sont scannées, mais l'équipe est incomplète ` +
        `(${pluriel(libres, 'place')} libre${libres > 1 ? 's' : ''}) : ajoutez un joueur ou ` +
        'validez le dépôt à la main.',
    };
  }
  if (enSuspens) {
    return {
      etat: resteOuverte,
      issue: { type: 'compte', team },
      message: `${tete} Formation scannée, mais une licence non inscrite reste à trancher.`,
    };
  }
  if (!aLaVolee) {
    return {
      etat: resteOuverte,
      issue: { type: 'compte', team },
      message: `${tete} Formation scannée : validez le dépôt.`,
    };
  }
  return {
    etat: fermee,
    issue: { type: 'valider', team },
    message:
      `Équipe n°${team.number} : ${pluriel(total, 'licence')} scannée${total > 1 ? 's' : ''}, ` +
      'dépôt validé. Scannez l\'équipe suivante.',
  };
}
