import { Upload, type LucideIcon } from 'lucide-react';
/**
 * Ce qui est engagé pour la suite, tel qu'on l'annonce publiquement.
 *
 * **Convention** : une entrée ici correspond à une issue ouverte du dépôt. Pas
 * de dates, pas de versions cibles — un club n'attend pas un calendrier de
 * livraison, et une échéance ratée sur une page publique se retourne contre
 * celui qui l'a écrite. On annonce l'intention, et le journal des nouveautés
 * (`nouveautes.ts`) dira quand c'est arrivé.
 *
 * Le texte s'adresse à un dirigeant de club, pas à un développeur : ce que ça
 * changera pour lui le jour du concours, et non le nom du module concerné.
 *
 * Retirer une entrée quand l'issue est close : ce qui est fait appartient au
 * journal des nouveautés, plus à la roadmap.
 */
export interface ChantierRoadmap {
  icone: LucideIcon;
  titre: string;
  texte: string;
  /** Numéro d'issue, pour que la promesse soit vérifiable. */
  issue: number;
}

export const ROADMAP: ChantierRoadmap[] = [
  {
    icone: Upload,
    titre: 'Remonter les résultats au comité sans ressaisie',
    texte:
      'Produire directement les fichiers attendus par Geslico — résultats ' +
      'd’arbitrage et fichier .rslt — pour que la remontée après un concours ' +
      'officiel devienne un export, au lieu d’une soirée de recopie.',
    issue: 3,
  },
];

/** Adresse d'une issue du dépôt, pour lier une promesse à son suivi. */
export function lienIssue(numero: number): string {
  return `https://github.com/GabinSMD/treizero/issues/${numero}`;
}
