import { Megaphone, Repeat, VolumeX } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Concours, Match, Poule, Team } from '@shared';
import { partiesAAnnoncer, phraseAnnonce, signatureAnnonce, signaturesActuelles } from '@shared';
import {
  Annonceur,
  etatVoix,
  suivreVoix,
  syntheseDisponible,
  type EtatVoix,
} from '../lib/annonceur';

/** Au-delà, on oublie les plus anciennes : un concours n'en appelle pas tant. */
const MAX_SIGNATURES = 2000;

function cle(concoursId: string): string {
  return `petanque.annonces.${concoursId}`;
}

/**
 * Parties déjà appelées sur cet appareil, pour ne pas les réannoncer après un
 * rechargement. `null` : l'écran n'a encore jamais annoncé ce concours.
 */
function lireAnnoncees(concoursId: string): Set<string> | null {
  try {
    const brut = localStorage.getItem(cle(concoursId));
    if (brut === null) return null;
    const liste: unknown = JSON.parse(brut);
    return new Set(Array.isArray(liste) ? liste.filter((s) => typeof s === 'string') : []);
  } catch {
    return null;
  }
}

function enregistrerAnnoncees(concoursId: string, signatures: Set<string>): void {
  try {
    const liste = [...signatures].slice(-MAX_SIGNATURES);
    localStorage.setItem(cle(concoursId), JSON.stringify(liste));
  } catch {
    /* stockage indisponible : l'écran pourra réannoncer après un rechargement */
  }
}

/**
 * « Annoncer les parties » sur l'écran d'affichage : chaque partie qui reçoit
 * ses deux équipes (et son terrain) est appelée à voix haute.
 *
 * Désactivé à l'ouverture : le navigateur n'autorise le son qu'après un geste
 * de l'utilisateur, et un écran qui se met à parler tout seul surprend. Le
 * clic sur le bouton est ce geste.
 */
export function AnnoncesParties({
  concours,
  teams,
  poules,
  matches,
}: {
  concours: Concours;
  teams: Team[];
  poules: Poule[];
  matches: Match[];
}) {
  const [actif, setActif] = useState(false);
  const [voix, setVoix] = useState<EtatVoix>(() => etatVoix());
  const [derniere, setDerniere] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [, rafraichir] = useState(0);
  const annonceur = useRef<Annonceur | null>(null);
  const annoncees = useRef<Set<string>>(new Set());

  useEffect(() => suivreVoix(() => setVoix(etatVoix())), []);
  useEffect(() => () => annonceur.current?.arreter(), []);

  const numeros = useMemo(() => new Map(teams.map((t) => [t.id, t.number])), [teams]);
  const dire = (m: Match) =>
    phraseAnnonce(m, {
      numeroDe: (id) => numeros.get(id),
      poules,
      matches,
      libelleTerrains: concours.libelleTerrains,
      decalageTerrain: concours.decalageTerrain,
    });

  /** Annonce les parties nouvelles et retient qu'elles sont appelées. */
  const annoncerNouvelles = () => {
    const a = annonceur.current;
    if (!a) return;
    const nouvelles = partiesAAnnoncer(matches, annoncees.current);
    if (nouvelles.length === 0) return;
    setInfo(null);
    for (const m of nouvelles) {
      const phrase = dire(m);
      annoncees.current.add(signatureAnnonce(m)!);
      a.annoncer(phrase);
      setDerniere(phrase);
    }
    enregistrerAnnoncees(concours.id, annoncees.current);
  };

  // À chaque évolution des parties, pendant que les annonces sont actives.
  useEffect(() => {
    if (actif) annoncerNouvelles();
    // `annoncerNouvelles` lit l'état courant : on ne réagit qu'aux parties.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actif, matches, teams, poules]);

  const activer = () => {
    const a = new Annonceur(() => rafraichir((n) => n + 1));
    annonceur.current = a;
    const memoire = lireAnnoncees(concours.id);
    if (memoire === null) {
      // Premier allumage sur cet appareil : les parties déjà en cours ont été
      // appelées par la table de marque. Les relire toutes d'un coup noierait
      // la suivante.
      const actuelles = signaturesActuelles(matches);
      annoncees.current = new Set(actuelles);
      enregistrerAnnoncees(concours.id, annoncees.current);
      setInfo(
        actuelles.length > 0
          ? `${actuelles.length} partie${actuelles.length > 1 ? 's' : ''} déjà en cours : seules les suivantes seront annoncées.`
          : null,
      );
    } else {
      // L'écran a déjà annoncé ce concours : on reprend là où il s'était
      // arrêté, sans répéter ce qui a été appelé avant le rechargement.
      annoncees.current = memoire;
      setInfo(null);
    }
    // Cette première phrase, dite pendant le clic, débloque le son du
    // navigateur et confirme qu'on entend bien l'écran.
    a.annoncer('Annonces des parties activées.');
    setActif(true);
  };

  const desactiver = () => {
    annonceur.current?.arreter();
    annonceur.current = null;
    setActif(false);
    setInfo(null);
  };

  if (!syntheseDisponible() || voix.type === 'absente') {
    return (
      <p className="annonces-etat annonces-alerte" role="note">
        <VolumeX className="ic" aria-hidden /> Ce navigateur ne sait pas lire à voix haute : pas
        d'annonce des parties.
      </p>
    );
  }

  const attente = annonceur.current?.enAttente ?? 0;

  return (
    <div className="annonces no-print">
      <div className="annonces-boutons">
        <button
          type="button"
          className={actif ? 'btn btn-sm annonces-actif' : 'btn btn-ghost btn-sm'}
          aria-pressed={actif}
          onClick={actif ? desactiver : activer}
        >
          <Megaphone className="ic" aria-hidden />{' '}
          {actif ? 'Annonces activées' : 'Annoncer les parties'}
        </button>
        {actif && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={!derniere}
            onClick={() => derniere && annonceur.current?.annoncer(derniere)}
          >
            <Repeat className="ic" aria-hidden /> Répéter la dernière annonce
          </button>
        )}
      </div>
      {actif && (
        <div className="annonces-etat" aria-live="polite">
          {voix.type === 'defaut' ? (
            <span className="annonces-alerte">
              Aucune voix française sur cet appareil : la voix par défaut lit les annonces,
              avec son accent. Ajoutez une voix française dans les réglages du système.
            </span>
          ) : (
            !voix.horsLigne && (
              <span className="annonces-alerte">
                La voix « {voix.nom} » passe par Internet : sans réseau, l'écran se taira.
              </span>
            )
          )}
          {info && <span>{info}</span>}
          {derniere && (
            <span className="annonces-derniere">
              {attente > 1 ? `${attente - 1} en attente · ` : ''}Dernière annonce : {derniere}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
