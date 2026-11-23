import { Check, TriangleAlert, Undo2 } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Concours, Licencie, Team } from '@shared';
import {
  TAILLE_FORMATION,
  controlerEquipe,
  criteresDuConcours,
  SCAN_DEPOT_VIDE,
  depotStats,
  parseLicenceQr,
  placesLibres,
  scannerAuDepot,
  type EtatScanDepot,
  type ChampLicence,
  type ControleEquipe,
  type CriteresLicence,
} from '@shared';
import {
  ajouterJoueurAuDepot,
  remplacerJoueurAuDepot,
  setCertificatValide,
  setLicencesDeposees,
  updateTeam,
} from '../../db/actions';
import { useLicencies } from '../../db/hooks';
import { CameraQr } from '../../components/CameraQr';
import { useCaptureDouchette } from '../../lib/douchette';
import { FraicheurBase } from '../../components/FraicheurBase';
import {
  ANOMALIE_EQUIPE_LABELS,
  ANOMALIE_LABELS,
  CATEGORIE_AGE_LABELS,
  formatDateFr,
  isIndividualMode,
} from '../../lib/labels';

interface Props {
  concours: Concours;
  teams: Team[];
}

type Filtre = 'toutes' | 'a_deposer' | 'non_conformes';

/** Un champ de la fiche, mis en évidence s'il est en anomalie. */
function Champ({
  libelle,
  valeur,
  champ,
  anomalies,
}: {
  libelle: string;
  valeur: string;
  champ: ChampLicence;
  anomalies: ChampLicence[];
}) {
  const faute = anomalies.includes(champ);
  return (
    <div className={faute ? 'depot-champ depot-champ-faute' : 'depot-champ'}>
      <span className="depot-champ-libelle">{libelle}</span>
      <span className="depot-champ-valeur">{valeur || '—'}</span>
    </div>
  );
}

/**
 * Dépôt des licences (manuel §3.C) : l'équipe présente ses licences, la table
 * de marque contrôle chaque joueur — voyant vert, ou champ fautif mis en
 * évidence — remplace un joueur si besoin, valide un certificat médical sur
 * présentation du papier, puis enregistre le dépôt.
 *
 * L'écran répond aussi à la question de l'écran « Statistiques » du logiciel
 * fédéral : quelles équipes ne sont pas encore passées.
 */
export function LicencesTab({ concours, teams }: Props) {
  const licencies = useLicencies() ?? [];
  const fiches = useMemo(
    () => new Map(licencies.filter((l) => l.licence).map((l) => [l.licence!, l])),
    [licencies],
  );

  /**
   * Effectif attendu d'une équipe. En mêlée et au tir, chacun s'inscrit seul et
   * les équipes se tirent à chaque ronde : un participant est complet à un
   * joueur, quoi que dise la formation du concours.
   */
  const taillePrevue = isIndividualMode(concours.mode) ? 1 : TAILLE_FORMATION[concours.format];

  // La même source que le bilan avant tirage : une copie locale avait perdu
  // les contingents (hors UE, mutés) des « Critères France ».
  const criteres: CriteresLicence = useMemo(() => criteresDuConcours(concours), [concours]);

  const controles = useMemo(() => {
    const map = new Map<string, ControleEquipe>();
    for (const t of teams) map.set(t.id, controlerEquipe(t.players, fiches, criteres, t.club));
    return map;
  }, [teams, fiches, criteres]);

  const stats = depotStats(
    teams,
    [...controles.entries()].map(([teamId, c]) => ({ teamId, conforme: c.conforme })),
  );

  const [filtre, setFiltre] = useState<Filtre>('toutes');
  const [aLaVolee, setALaVolee] = useState(true);
  /**
   * Équipe ouverte et licences déjà scannées (manuel §3.B.2-3.B.3 au dépôt).
   * Tenu dans une ref, lue et écrite au moment du scan : deux lectures de la
   * caméra arrivées avant le rendu suivant ne doivent pas partir du même état
   * et s'effacer l'une l'autre. L'état React n'est que son reflet à l'écran.
   */
  const scan = useRef<EtatScanDepot>(SCAN_DEPOT_VIDE);
  const [scanAffiche, setScanAffiche] = useState<EtatScanDepot>(SCAN_DEPOT_VIDE);
  const poser = (etat: EtatScanDepot): void => {
    scan.current = etat;
    setScanAffiche(etat);
  };
  const ouverte = scanAffiche.ouverte;
  /** Ouvrir ou fermer une équipe à la main repart d'un décompte vide. */
  const setOuverte = (id: string | null): void => poser({ ouverte: id, scannees: [] });
  /**
   * Équipes dont le dépôt est parti à la base sans être encore relu dans
   * `teams` : une relecture d'une de leurs licences est refusée, pas revalidée.
   */
  const enDepot = useRef(new Set<string>());
  useEffect(() => {
    for (const id of enDepot.current) {
      if (teams.find((t) => t.id === id)?.licencesDeposees) enDepot.current.delete(id);
    }
  }, [teams]);
  const [saisie, setSaisie] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  /**
   * Licence scannée qui n'appartient à personne : l'équivalent du bandeau
   * rouge « Pas inscrit ! ». Tant qu'elle est là, le dépôt de l'équipe
   * ouverte est bloqué, comme le « Valider » fédéral qui devient « Annuler ».
   */
  const [enAttente, setEnAttente] = useState<{ licence: string; fiche?: Licencie } | null>(
    null,
  );
  const champScan = useRef<HTMLInputElement>(null);
  useCaptureDouchette(champScan, (c) => setSaisie((s) => s + c));

  const attendues = teams.filter((t) => !t.forfait);
  const visibles = attendues.filter((t) => {
    if (filtre === 'a_deposer') return !t.licencesDeposees;
    if (filtre === 'non_conformes') return controles.get(t.id)?.conforme === false;
    return true;
  });

  /**
   * Scanner une licence. Trois issues, comme sur l'écran fédéral (p.38-39) :
   * c'est un joueur de l'équipe ouverte, c'est un joueur d'une autre équipe, ou
   * **« Pas inscrit ! »** — et ce dernier cas seul ouvre le remplacement.
   *
   * « À la volée », les joueurs scannés de l'équipe sont retenus, et le dépôt
   * se valide tout seul quand toute la formation est passée : l'équipe se
   * referme et le scan suivant ouvre la suivante. La décision est dans
   * `scannerAuDepot` ; un refus y porte toujours sa raison.
   */
  const scanner = (contenu: string): void => {
    const decode = parseLicenceQr(contenu);
    const licence = decode?.licence;
    if (!licence) {
      setMessage(`Contenu non reconnu : « ${contenu.slice(0, 40)} ».`);
      return;
    }
    const r = scannerAuDepot(scan.current, licence, teams, {
      fiches,
      taillePrevue,
      aLaVolee,
      enDepot: enDepot.current,
      enSuspens: Boolean(enAttente),
    });
    if (r.etat.ouverte !== scan.current.ouverte) {
      setEnAttente(null);
      setFiltre('toutes');
    }
    poser(r.etat);
    setMessage(r.message);
    if (r.issue.type === 'pas_inscrit') {
      setEnAttente({ licence: r.issue.licence, fiche: r.issue.fiche });
      return;
    }
    if (r.issue.type === 'compte') setEnAttente(null);
    if (r.issue.type === 'valider') {
      const team = r.issue.team;
      enDepot.current.add(team.id);
      setEnAttente(null);
      setLicencesDeposees(team, true).catch((e: unknown) => {
        enDepot.current.delete(team.id);
        // Rien de muet : l'échec de l'écriture se dit, et le bouton reste.
        setMessage(
          `Le dépôt de l'équipe n°${team.number} n'a pas pu être enregistré ` +
            `(${e instanceof Error ? e.message : String(e)}) : validez-le à la main.`,
        );
      });
    }
  };

  return (
    <div className="tab-content">
      <FraicheurBase />
      <div className="depot-stats">
        <div className="depot-jauge" role="img" aria-label={`${stats.pourcentage}% déposées`}>
          <div className="depot-jauge-remplie" style={{ width: `${stats.pourcentage}%` }} />
        </div>
        <p>
          <strong>
            {stats.deposees} / {stats.total}
          </strong>{' '}
          équipe{stats.total > 1 ? 's' : ''} ayant déposé ses licences
          {stats.restantes > 0 && <> · {stats.restantes} à passer</>}
          {stats.nonConformes > 0 && (
            <>
              {' '}
              · <span className="depot-alerte">{stats.nonConformes} non conforme
              {stats.nonConformes > 1 ? 's' : ''}</span>
            </>
          )}
        </p>
      </div>

      <form
        className="toolbar no-print"
        onSubmit={(e) => {
          e.preventDefault();
          const v = saisie.trim();
          if (!v) return;
          scanner(v);
          setSaisie('');
          champScan.current?.focus();
        }}
      >
        <input
          ref={champScan}
          value={saisie}
          onChange={(e) => setSaisie(e.target.value)}
          placeholder="Scannez une licence (douchette) ou tapez un n° puis Entrée"
          autoComplete="off"
        />
        <span className="toolbar-actions">
          <label className="checkbox-label">
            <input
              type="checkbox"
              checked={aLaVolee}
              onChange={(e) => setALaVolee(e.target.checked)}
            />
            À la volée : valider le dépôt dès que toute l'équipe est scannée
          </label>
          {(['toutes', 'a_deposer', 'non_conformes'] as Filtre[]).map((f) => (
            <button
              key={f}
              type="button"
              className={filtre === f ? 'btn btn-sm btn-primary' : 'btn btn-sm'}
              onClick={() => setFiltre(f)}
            >
              {f === 'toutes' ? 'Toutes' : f === 'a_deposer' ? 'À déposer' : 'Non conformes'}
            </button>
          ))}
        </span>
      </form>

      {/* La tablette posée à la table de marque n'a pas toujours de douchette :
          la caméra lit la même licence et passe par le même chemin. */}
      <div className="no-print">
        <CameraQr onCode={scanner} />
      </div>

      {message && <p className="hint">{message}</p>}

      {attendues.length === 0 && <p>Aucune équipe inscrite.</p>}

      <ul className="depot-liste">
        {visibles.map((team) => {
          const controle = controles.get(team.id)!;
          const ouvert = ouverte === team.id;
          return (
            <li key={team.id} className={ouvert ? 'depot-equipe depot-equipe-ouverte' : 'depot-equipe'}>
              <button
                className="depot-entete"
                onClick={() => setOuverte(ouvert ? null : team.id)}
                aria-expanded={ouvert}
              >
                <span className="depot-num">n°{team.number}</span>
                <span className="depot-joueurs">
                  {team.players.map((p) => p.name).join(' / ')}
                </span>
                <span className={controle.conforme ? 'tag tag-ok' : 'tag tag-danger'}>
                  {controle.conforme ? <><Check className="ic" aria-hidden /> {'conforme'}</> : <><TriangleAlert className="ic" aria-hidden /> {'à vérifier'}</>}
                </span>
                <span className={team.licencesDeposees ? 'tag tag-ok' : 'tag tag-warn'}>
                  {team.licencesDeposees ? 'déposées' : 'non déposées'}
                </span>
              </button>

              {ouvert && (
                <div className="depot-detail">
                  {enAttente && (
                    <div className="depot-pas-inscrit">
                      <p>
                        <strong>Pas inscrit !</strong> La licence {enAttente.licence}
                        {enAttente.fiche ? <> — {enAttente.fiche.name}</> : null} n'appartient à
                        aucune équipe de ce concours.
                      </p>
                      {enAttente.fiche ? (
                        <>
                          {/* L'ajout d'abord : il ne prend la place de personne,
                              et c'est le geste attendu quand l'équipe a été
                              inscrite incomplète le matin (manuel §3.C). */}
                          {placesLibres(team, taillePrevue) > 0 && (
                            <p className="depot-ajouter">
                              Cette équipe est incomplète —{' '}
                              {placesLibres(team, taillePrevue)} place
                              {placesLibres(team, taillePrevue) > 1 ? 's' : ''} libre
                              {placesLibres(team, taillePrevue) > 1 ? 's' : ''}.{' '}
                              <button
                                className="btn btn-sm"
                                onClick={() => {
                                  void ajouterJoueurAuDepot(team, enAttente.fiche!, taillePrevue);
                                  setEnAttente(null);
                                  setMessage(`${enAttente.fiche!.name} ajouté à l'équipe.`);
                                  champScan.current?.focus();
                                }}
                              >
                                Ajouter {enAttente.fiche.name}
                              </button>
                            </p>
                          )}
                          <p className="hint">
                            {placesLibres(team, taillePrevue) > 0
                              ? 'Ou qui lui cède sa place ?'
                              : 'Qui lui cède sa place ?'}
                          </p>
                          <span className="depot-remplacer">
                            {team.players.map((p, i) => (
                              <button
                                key={i}
                                className="btn btn-sm"
                                onClick={() => {
                                  void remplacerJoueurAuDepot(team, i, enAttente.fiche!);
                                  setEnAttente(null);
                                  setMessage(
                                    `${p.name} remplacé par ${enAttente.fiche!.name}.`,
                                  );
                                  champScan.current?.focus();
                                }}
                              >
                                Remplacer {p.name}
                              </button>
                            ))}
                          </span>
                        </>
                      ) : (
                        <p className="hint">
                          Cette licence est absente du fichier des licenciés : rien à recopier
                          automatiquement. Corrigez le nom et le numéro à la main ci-dessous.
                        </p>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setEnAttente(null)}>
                        Annuler
                      </button>
                    </div>
                  )}

                  {controle.anomaliesEquipe.length > 0 && (
                    <p className="depot-alerte">
                      <TriangleAlert className="ic" aria-hidden />{' '}
                      {controle.anomaliesEquipe
                        .map((a) => ANOMALIE_EQUIPE_LABELS[a])
                        .join(', ')}
                    </p>
                  )}

                  {team.players.map((joueur, i) => {
                    const c = controle.joueurs[i]!;
                    const fiche: Licencie | undefined = joueur.licence
                      ? fiches.get(joueur.licence)
                      : undefined;
                    const jeune =
                      c.categorie === 'juniors' ||
                      c.categorie === 'cadets' ||
                      c.categorie === 'minimes' ||
                      c.categorie === 'benjamins';
                    const scanne =
                      Boolean(joueur.licence) && scanAffiche.scannees.includes(joueur.licence!);
                    return (
                      <div key={i} className="depot-joueur">
                        <div className="depot-joueur-tete">
                          <span
                            className={
                              c.anomalies.length === 0 && !c.inconnu
                                ? 'depot-voyant depot-voyant-ok'
                                : 'depot-voyant depot-voyant-ko'
                            }
                            title={
                              c.anomalies.length === 0 && !c.inconnu
                                ? 'Conforme'
                                : c.anomalies.map((a) => ANOMALIE_LABELS[a]).join(', ')
                            }
                          />
                          {/* Remplacement d'un joueur : autorisé même après le
                              tirage, comme le prévoit le manuel. */}
                          <input
                            value={joueur.name}
                            onChange={(e) =>
                              void updateTeam({
                                ...team,
                                players: team.players.map((p, k) =>
                                  k === i ? { ...p, name: e.target.value } : p,
                                ),
                              })
                            }
                            aria-label={`Nom du joueur ${i + 1}`}
                          />
                          <input
                            className="licence-input"
                            value={joueur.licence ?? ''}
                            onChange={(e) =>
                              void updateTeam({
                                ...team,
                                players: team.players.map((p, k) =>
                                  k === i ? { ...p, licence: e.target.value || undefined } : p,
                                ),
                              })
                            }
                            placeholder="N° licence"
                            aria-label={`Licence du joueur ${i + 1}`}
                          />
                          {scanne && (
                            <span className="tag tag-ok">
                              <Check className="ic" aria-hidden /> scannée
                            </span>
                          )}
                        </div>

                        {c.inconnu ? (
                          <p className="depot-alerte">
                            Licence {joueur.licence} absente du fichier des licenciés : rien à
                            contrôler.
                          </p>
                        ) : (
                          <div className="depot-champs">
                            {/* Un suspendu n'est pas un critère mal rempli : il
                                passe devant tout le reste, et seulement s'il l'est. */}
                            {fiche?.suspendu && (
                              <Champ
                                libelle="Suspension"
                                valeur="Licencié suspendu"
                                champ="suspension"
                                anomalies={c.anomalies}
                              />
                            )}
                            <Champ
                              libelle="Licence"
                              valeur={joueur.licence ?? ''}
                              champ="licence"
                              anomalies={c.anomalies}
                            />
                            <Champ
                              libelle="Année de reprise"
                              valeur={fiche?.anneeReprise ? String(fiche.anneeReprise) : ''}
                              champ="anneeReprise"
                              anomalies={c.anomalies}
                            />
                            <Champ
                              libelle="Naissance"
                              valeur={
                                fiche?.dateNaissance
                                  ? `${formatDateFr(fiche.dateNaissance)}${
                                      c.categorie ? ` (${CATEGORIE_AGE_LABELS[c.categorie]})` : ''
                                    }`
                                  : ''
                              }
                              champ="dateNaissance"
                              anomalies={c.anomalies}
                            />
                            <Champ
                              libelle="Sexe"
                              valeur={fiche?.sexe ?? ''}
                              champ="sexe"
                              anomalies={c.anomalies}
                            />
                            <Champ
                              libelle="Classification"
                              valeur={fiche?.classification ?? ''}
                              champ="classification"
                              anomalies={c.anomalies}
                            />
                            <Champ
                              libelle="Club"
                              valeur={fiche?.club ?? ''}
                              champ="club"
                              anomalies={c.anomalies}
                            />
                            {jeune && (
                              <Champ
                                libelle="Certificat médical"
                                valeur={
                                  fiche?.certificatMedical
                                    ? formatDateFr(fiche.certificatMedical)
                                    : ''
                                }
                                champ="certificatMedical"
                                anomalies={c.anomalies}
                              />
                            )}
                          </div>
                        )}

                        {jeune && joueur.licence && (
                          <label className="checkbox-label">
                            <input
                              type="checkbox"
                              checked={(concours.certificatsValides ?? []).includes(joueur.licence)}
                              onChange={(e) =>
                                void setCertificatValide(
                                  concours,
                                  joueur.licence!,
                                  e.target.checked,
                                )
                              }
                            />
                            Certificat médical présenté sur papier
                          </label>
                        )}
                      </div>
                    );
                  })}

                  {/* Remplacements et ajouts dans un seul fil, à l'heure : ce
                      qu'on veut lire le lendemain, c'est l'histoire de la
                      composition, pas deux listes à recouper. */}
                  {(() => {
                    const histoire = [
                      ...(team.remplacements ?? []).map((r) => ({
                        at: r.at,
                        texte: `${r.avant.name}${r.avant.licence ? ` (${r.avant.licence})` : ''} remplacé par ${r.apres.name}${r.apres.licence ? ` (${r.apres.licence})` : ''}`,
                      })),
                      ...(team.ajouts ?? []).map((a) => ({
                        at: a.at,
                        texte: `＋ ${a.joueur.name}${a.joueur.licence ? ` (${a.joueur.licence})` : ''} ajouté à l'équipe`,
                      })),
                    ].sort((x, y) => (x.at < y.at ? -1 : x.at > y.at ? 1 : 0));
                    if (histoire.length === 0) return null;
                    return (
                      <ul className="depot-remplacements">
                        {histoire.map((e, i) => (
                          <li key={i}>
                            {e.texte} — {new Date(e.at).toLocaleString('fr-FR')}
                          </li>
                        ))}
                      </ul>
                    );
                  })()}

                  <div className="form-actions">
                    {team.licencesDeposees ? (
                      <>
                        <span className="hint">
                          Déposées le {new Date(team.licencesDeposees).toLocaleString('fr-FR')}
                        </span>
                        <button
                          className="btn btn-ghost"
                          onClick={() => void setLicencesDeposees(team, false)}
                        >
                          <Undo2 className="ic" aria-hidden /> Annuler le dépôt
                        </button>
                      </>
                    ) : (
                      <button
                        className="btn btn-primary"
                        /* Le « Valider » fédéral devient « Annuler » tant qu'un
                           joueur est « pas inscrit » : le dépôt ne se clôt pas
                           sur une composition en suspens. */
                        disabled={Boolean(enAttente)}
                        title={
                          enAttente
                            ? 'Tranchez d’abord la licence non inscrite'
                            : undefined
                        }
                        onClick={() => void setLicencesDeposees(team, true)}
                      >
                        <Check className="ic" aria-hidden /> Valider le dépôt
                      </button>
                    )}
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {visibles.length === 0 && attendues.length > 0 && (
        <p className="hint">
          {filtre === 'a_deposer'
            ? 'Toutes les équipes ont déposé leurs licences.'
            : 'Aucune équipe non conforme.'}
        </p>
      )}
    </div>
  );
}
