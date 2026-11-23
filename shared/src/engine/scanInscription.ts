/**
 * Où va une licence scannée à l'inscription (manuel §3.B.2 et §3.B.3).
 *
 * L'écran d'inscription au lecteur remplit une équipe scan après scan et, « à
 * la volée », l'inscrit dès que la formation est complète pour passer à la
 * suivante. Ce module décide si un scan prend une place, et sinon **pourquoi**
 * il est refusé : un refus porte toujours sa raison (voir `saisieNombres`).
 *
 * ## Le défaut qu'il corrige
 *
 * L'écran ajoutait le joueur par `[...encours, joueur].slice(0, parEquipe)`.
 * Une équipe déjà complète coupait donc le scan suivant **sans un mot**. Or
 * c'est l'enchaînement normal avec une douchette : l'équipe complète partait à
 * l'enregistrement, mais restait à l'écran tant que la base n'avait pas
 * répondu, et le premier joueur de l'équipe suivante, scanné dans cet
 * intervalle, disparaissait. La table de marque croyait l'avoir inscrit.
 *
 * Désormais l'équipe complète quitte l'écran dès son départ, et ses licences
 * sont tenues dans `enInscription` jusqu'à ce que la base les compte parmi les
 * inscrites : un scan arrivé entre-temps ouvre l'équipe suivante, et une
 * relecture d'un joueur parti est refusée au lieu d'être inscrite deux fois.
 */

export interface ContexteScan {
  /** Licence → numéro de l'équipe où elle est déjà inscrite. */
  dejaInscrites: ReadonlyMap<string, number>;
  /** Licences d'une équipe partie à l'enregistrement, pas encore relue de la base. */
  enInscription: ReadonlySet<string>;
}

export type PlacementScan =
  | {
      ok: true;
      /** La formation est complète avec ce joueur. */
      complete: boolean;
    }
  | { ok: false; raison: string };

/**
 * Place la licence `licence` dans l'équipe en cours, dont les licences déjà
 * scannées sont `encours`, pour une formation de `parEquipe` joueurs.
 */
export function placerScan(
  encours: readonly string[],
  licence: string,
  parEquipe: number,
  { dejaInscrites, enInscription }: ContexteScan,
): PlacementScan {
  if (encours.includes(licence)) {
    return { ok: false, raison: `Licence ${licence} déjà scannée pour cette équipe.` };
  }
  const equipe = dejaInscrites.get(licence);
  if (equipe !== undefined) {
    return { ok: false, raison: `Licence ${licence} déjà inscrite dans l'équipe n°${equipe}.` };
  }
  if (enInscription.has(licence)) {
    return {
      ok: false,
      raison: `Licence ${licence} déjà dans l'équipe en cours d'inscription.`,
    };
  }
  if (encours.length >= parEquipe) {
    return {
      ok: false,
      raison:
        `Équipe complète (${parEquipe} joueur${parEquipe > 1 ? 's' : ''}) : ` +
        `inscrivez-la avant de scanner la licence ${licence}.`,
    };
  }
  return { ok: true, complete: encours.length + 1 === parEquipe };
}
