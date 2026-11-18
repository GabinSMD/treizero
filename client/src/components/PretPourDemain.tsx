import { ChevronDown, ChevronUp, CircleCheck, ClipboardCheck, Info, TriangleAlert } from 'lucide-react';
import { useEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { Concours, EtatVeille, PointManuel, PointVeille, Team } from '@shared';
import { afficherVeille, pointsVeille, POINTS_MANUELS } from '@shared';
import { useFraicheurLicencies, useLastSyncAt, usePendingCount, useSyncStatus } from '../db/hooks';
import { FORMULE_LABELS, modeLabel } from '../lib/labels';
import { isStoragePersisted, subscribeStorage } from '../lib/storage';
import { syncNow } from '../sync/engine';

const MANUELS: Record<PointManuel, string> = {
  impressions: 'Impressions prêtes (feuilles, affiches, liste des inscrits)',
  tablette: 'Tablette et téléphone chargés',
  monnaie: 'Mises et monnaie prévues',
};

interface Memoire {
  coches: PointManuel[];
  replie: boolean;
}

/**
 * Ce qui est coché reste sur cet appareil, par concours : c'est la check-list
 * de celui qui prépare, pas une donnée du concours à synchroniser.
 */
const cle = (concoursId: string) => `veille.${concoursId}`;

function lire(concoursId: string): Memoire {
  try {
    const brut = localStorage.getItem(cle(concoursId));
    if (brut) {
      const m = JSON.parse(brut) as Partial<Memoire>;
      return {
        coches: (m.coches ?? []).filter((c) => (POINTS_MANUELS as readonly string[]).includes(c)),
        replie: m.replie === true,
      };
    }
  } catch {
    // stockage indisponible ou illisible : on repart de zéro
  }
  return { coches: [], replie: false };
}

/** Un service worker sert-il la page ? C'est lui qui la rouvre sans réseau. */
function useServiceWorker(): boolean {
  const [actif, setActif] = useState(() => navigator.serviceWorker?.controller != null);
  useEffect(() => {
    const sw = navigator.serviceWorker;
    if (!sw) return;
    const maj = () => setActif(sw.controller != null);
    sw.addEventListener('controllerchange', maj);
    return () => sw.removeEventListener('controllerchange', maj);
  }, []);
  return actif;
}

const ICONES: Record<EtatVeille, typeof CircleCheck> = {
  ok: CircleCheck,
  attention: TriangleAlert,
  info: Info,
};

/**
 * « Prêt pour demain ? » (#197) : la veille du concours, ce que l'appli peut
 * vérifier elle-même, plus trois points à cocher à la main. Chaque point mène à
 * l'écran où il se règle. Rien n'est bloqué ; l'encart disparaît au tirage et
 * se replie sur une ligne.
 */
export function PretPourDemain({
  concours,
  teams,
  onParametres,
}: {
  concours: Concours;
  teams: Team[];
  onParametres: () => void;
}) {
  const fraicheur = useFraicheurLicencies();
  const statutSynchro = useSyncStatus();
  const enAttente = usePendingCount();
  const derniereSynchro = useLastSyncAt();
  const serviceWorker = useServiceWorker();
  const stockagePersistant = useSyncExternalStore(subscribeStorage, isStoragePersisted);
  const [memoire, setMemoire] = useState(() => lire(concours.id));

  useEffect(() => setMemoire(lire(concours.id)), [concours.id]);

  if (!afficherVeille(concours)) return null;

  const memoriser = (m: Memoire) => {
    setMemoire(m);
    try {
      localStorage.setItem(cle(concours.id), JSON.stringify(m));
    } catch {
      // mode privé saturé : la case reste cochée le temps de la page
    }
  };

  const points = pointsVeille({
    concours,
    equipesEngagees: teams.filter((t) => !t.forfait).length,
    fraicheur,
    serviceWorker,
    stockagePersistant,
    statutSynchro,
    enAttente,
  });
  const aVoir =
    points.filter((p) => p.etat === 'attention').length +
    POINTS_MANUELS.filter((m) => !memoire.coches.includes(m)).length;

  return (
    <section className="veille no-print" aria-labelledby="veille-titre">
      <div className="veille-tete">
        <h2 id="veille-titre" className="veille-titre">
          <ClipboardCheck className="ic" aria-hidden /> Prêt pour demain ?
        </h2>
        <span className="veille-compte">
          {aVoir === 0 ? 'Tout est prêt' : `${aVoir} point${aVoir > 1 ? 's' : ''} à voir`}
        </span>
        <button
          className="btn btn-ghost btn-sm"
          aria-expanded={!memoire.replie}
          onClick={() => memoriser({ ...memoire, replie: !memoire.replie })}
        >
          {memoire.replie ? (
            <>
              <ChevronDown className="ic" aria-hidden /> Afficher
            </>
          ) : (
            <>
              <ChevronUp className="ic" aria-hidden /> Masquer
            </>
          )}
        </button>
      </div>

      {!memoire.replie && (
        <ul className="veille-liste">
          {points.map((p) => (
            <LignePoint
              key={p.cle}
              point={p}
              concours={concours}
              derniereSynchro={derniereSynchro}
              onParametres={onParametres}
            />
          ))}
          {POINTS_MANUELS.map((m) => (
            <li key={m} className="veille-point veille-manuel">
              <label>
                <input
                  type="checkbox"
                  checked={memoire.coches.includes(m)}
                  onChange={(e) =>
                    memoriser({
                      ...memoire,
                      coches: e.target.checked
                        ? [...memoire.coches, m]
                        : memoire.coches.filter((c) => c !== m),
                    })
                  }
                />{' '}
                {MANUELS[m]}
              </label>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function LignePoint({
  point,
  concours,
  derniereSynchro,
  onParametres,
}: {
  point: PointVeille;
  concours: Concours;
  derniereSynchro: string | null;
  onParametres: () => void;
}) {
  const Icone = ICONES[point.etat];
  const parametres = (
    <button className="btn btn-ghost btn-sm" onClick={onParametres}>
      Paramètres
    </button>
  );
  let texte: ReactNode;
  let action: ReactNode = null;

  switch (point.cle) {
    case 'licencies': {
      const f = point.fraicheur;
      const date = f.date ? new Date(f.date).toLocaleDateString('fr-FR') : null;
      texte =
        f.nombre === 0 ? (
          <>Aucun fichier des licenciés sur cet appareil : les licences ne pourront pas être contrôlées.</>
        ) : f.perimee ? (
          <>
            Fichier des licenciés du <strong>{date}</strong>, saison {f.saison} : nous sommes en{' '}
            {f.saisonCourante}. Réimportez-le.
          </>
        ) : date ? (
          <>
            Fichier des licenciés du <strong>{date}</strong> ({f.nombre} fiches).
          </>
        ) : (
          <>Fichier des licenciés sans date ({f.nombre} fiches).</>
        );
      action = (
        <Link className="btn btn-ghost btn-sm" to="/licencies">
          Licenciés
        </Link>
      );
      break;
    }
    case 'terrains': {
      const { necessaires, disponibles, manquants } = point.besoin;
      texte =
        disponibles <= 0 ? (
          <>
            Jusqu'à <strong>{necessaires}</strong> terrains en même temps au premier tour : renseignez
            ceux dont vous disposez.
          </>
        ) : manquants > 0 ? (
          <>
            Jusqu'à <strong>{necessaires}</strong> terrains en même temps, vous en déclarez{' '}
            {disponibles} : il en manque {manquants}.
          </>
        ) : (
          <>
            {necessaires} terrain{necessaires > 1 ? 's' : ''} nécessaire{necessaires > 1 ? 's' : ''} au
            maximum, {disponibles} disponible{disponibles > 1 ? 's' : ''}.
          </>
        );
      action = parametres;
      break;
    }
    case 'parametres': {
      const formule = concours.formule ? ` · ${FORMULE_LABELS[concours.formule]}` : '';
      texte = (
        <>
          {modeLabel(concours.mode)}
          {formule}
          {point.manque.includes('points')
            ? ' · points de la partie à régler'
            : concours.mode !== 'tir_precision'
              ? ` · parties en ${concours.scoreMax} pts`
              : ''}
          {concours.tempsLimite
            ? ` · temps limité ${concours.tempsLimite} min`
            : ' · pas de temps limite'}
          .
        </>
      );
      action = parametres;
      break;
    }
    case 'horsLigne':
      texte = !point.serviceWorker ? (
        <>
          Cet appareil n'est pas encore prêt hors ligne : rechargez la page une fois avec du réseau
          avant de partir.
        </>
      ) : point.stockagePersistant === false ? (
        <>
          Prêt hors ligne. Le navigateur peut toutefois effacer les données s'il manque de place :
          installez l'application pour les protéger.
        </>
      ) : (
        <>Prêt hors ligne : l'application et le concours sont sur cet appareil.</>
      );
      break;
    case 'synchro': {
      const heure = derniereSynchro
        ? new Date(derniereSynchro).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })
        : null;
      const n = point.enAttente;
      switch (point.statut) {
        case 'guest':
          texte = <>Mode invité : les données restent sur cet appareil seulement.</>;
          break;
        case 'auth':
          texte = <>Session expirée : cet appareil ne synchronise plus.</>;
          action = (
            <Link className="btn btn-ghost btn-sm" to="/login">
              Se reconnecter
            </Link>
          );
          break;
        case 'protege':
          texte = <>Synchronisation suspendue : des données d'un autre compte attendent un choix.</>;
          break;
        default:
          texte =
            n > 0 ? (
              <>
                {n} modification{n > 1 ? 's' : ''} pas encore envoyée{n > 1 ? 's' : ''} : synchronisez
                avant de partir.
              </>
            ) : point.statut === 'synced' ? (
              <>Cet appareil est synchronisé{heure ? ` (${heure})` : ''}.</>
            ) : point.statut === 'error' ? (
              <>La dernière synchronisation a échoué.</>
            ) : (
              <>Rien en attente d'envoi sur cet appareil.</>
            );
          action = (
            <button className="btn btn-ghost btn-sm" onClick={() => void syncNow()}>
              Synchroniser
            </button>
          );
      }
      break;
    }
  }

  return (
    <li className={`veille-point veille-${point.etat}`}>
      <Icone className="ic veille-icone" aria-hidden />
      <span className="veille-texte">{texte}</span>
      {action}
    </li>
  );
}
