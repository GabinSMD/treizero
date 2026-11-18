/**
 * « Prêt pour demain ? » : ce que l'appli peut vérifier elle-même la veille d'un
 * concours (issue #197).
 *
 * Les ennuis du jour J se préparent la veille : fichier des licenciés d'une
 * saison révolue, tablette jamais ouverte hors ligne, huit jeux pour seize
 * parties. L'appli connaît déjà chacune de ces informations ; elle les affichait
 * à des endroits différents, et souvent trop tard — le besoin en terrains au
 * moment du tirage, quand les équipes attendent déjà.
 *
 * Ce module ne fait que **rassembler** des verdicts qui existent ailleurs : la
 * fraîcheur du fichier est celle de `fraicheurLicencies` (seuil à la saison, et
 * non en jours — voir ce fichier), le besoin en terrains celui de
 * `besoinTerrains`. Un second calcul pourrait en différer, et l'encart dirait
 * alors le contraire du tirage.
 *
 * ## Ce qu'on ne fait pas
 *
 * **Rien n'est bloqué**, comme partout ailleurs : c'est une aide, pas un
 * contrôle. Et l'état `info` existe pour ne pas crier au loup : un concours sans
 * temps limite ou un compte invité sont des choix, pas des oublis.
 *
 * La synchronisation des **autres** appareils du club n'est pas vérifiée : le
 * serveur ne garde pas la dernière connexion de chaque appareil. Seul cet
 * appareil-ci est jugé.
 */
import type { Concours } from '../types';
import { besoinTerrains, type BesoinTerrains } from './besoinTerrains';
import { estConcoursOfficiel } from './federal';
import type { FraicheurLicencies } from './fraicheurLicencies';

export type EtatVeille = 'ok' | 'attention' | 'info';

export type PointVeille =
  | { cle: 'licencies'; etat: EtatVeille; fraicheur: FraicheurLicencies }
  | { cle: 'terrains'; etat: EtatVeille; besoin: BesoinTerrains }
  | { cle: 'parametres'; etat: EtatVeille; manque: ('points' | 'tempsLimite')[] }
  | { cle: 'horsLigne'; etat: EtatVeille; serviceWorker: boolean; stockagePersistant: boolean | null }
  | { cle: 'synchro'; etat: EtatVeille; statut: string; enAttente: number };

/** Points à cocher à la main : l'appli ne peut pas les constater. */
export const POINTS_MANUELS = ['impressions', 'tablette', 'monnaie'] as const;
export type PointManuel = (typeof POINTS_MANUELS)[number];

export interface EntreeVeille {
  concours: Concours;
  /** Équipes engagées, forfaits exclus. */
  equipesEngagees: number;
  fraicheur: FraicheurLicencies;
  /** Un service worker contrôle-t-il la page ? Sans lui, pas d'ouverture hors réseau. */
  serviceWorker: boolean;
  /** `null` = le navigateur n'a pas encore répondu. */
  stockagePersistant: boolean | null;
  /** Statut du moteur de synchronisation (`SyncStatus` côté client). */
  statutSynchro: string;
  /** Modifications locales pas encore envoyées. */
  enAttente: number;
}

/** L'encart ne vaut que tant que rien n'est tiré. */
export function afficherVeille(concours: Pick<Concours, 'status'>): boolean {
  return concours.status === 'inscriptions';
}

export function pointsVeille(e: EntreeVeille): PointVeille[] {
  const points: PointVeille[] = [];
  const { concours } = e;

  // Le fichier ne sert qu'aux contrôles fédéraux : un concours de club n'a pas
  // à s'en soucier.
  if (estConcoursOfficiel(concours)) {
    const f = e.fraicheur;
    // Une date illisible ne déclenche rien, comme ailleurs : absence de preuve
    // n'est pas preuve de péremption. L'absence de fichier, elle, rend tout
    // contrôle impossible.
    points.push({
      cle: 'licencies',
      etat: f.nombre === 0 || f.perimee ? 'attention' : 'ok',
      fraicheur: f,
    });
  }

  const besoin = besoinTerrains(concours, e.equipesEngagees);
  if (besoin) {
    points.push({
      cle: 'terrains',
      etat: besoin.suffisants === false ? 'attention' : besoin.suffisants ? 'ok' : 'info',
      besoin,
    });
  }

  // La formule n'est jamais « manquante » : absente, elle se déduit de la
  // consolante. Les points peuvent l'être ; le temps limite est un choix.
  const manque: ('points' | 'tempsLimite')[] = [];
  if (concours.mode !== 'tir_precision' && !(concours.scoreMax > 0)) manque.push('points');
  if (!concours.tempsLimite) manque.push('tempsLimite');
  points.push({
    cle: 'parametres',
    etat: manque.includes('points') ? 'attention' : manque.length ? 'info' : 'ok',
    manque,
  });

  points.push({
    cle: 'horsLigne',
    etat: e.serviceWorker ? (e.stockagePersistant === false ? 'info' : 'ok') : 'attention',
    serviceWorker: e.serviceWorker,
    stockagePersistant: e.stockagePersistant,
  });

  points.push({
    cle: 'synchro',
    etat: etatSynchro(e.statutSynchro, e.enAttente),
    statut: e.statutSynchro,
    enAttente: e.enAttente,
  });

  return points;
}

function etatSynchro(statut: string, enAttente: number): EtatVeille {
  // Un compte invité ne synchronise jamais : c'est un choix, pas une panne.
  if (statut === 'guest') return 'info';
  if (statut === 'auth' || statut === 'protege' || statut === 'error') return 'attention';
  if (enAttente > 0) return 'attention';
  return statut === 'synced' ? 'ok' : 'info';
}
