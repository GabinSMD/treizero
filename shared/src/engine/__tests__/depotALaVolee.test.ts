import { describe, expect, it } from 'vitest';
import { SCAN_DEPOT_VIDE, scannerAuDepot, type EtatScanDepot, type OptionsScanDepot } from '../depot';
import type { Team } from '../../types';

function equipe(number: number, licences: (string | undefined)[], extra: Partial<Team> = {}): Team {
  return {
    id: `t${number}`,
    concoursId: 'c1',
    number,
    players: licences.map((licence, i) => ({ name: `Joueur ${number}.${i + 1}`, licence })),
    forfait: false,
    updatedAt: '2026-08-04T00:00:00.000Z',
    ...extra,
  };
}

const t1 = equipe(1, ['111', '112', '113']);
const t2 = equipe(2, ['211', '212', '213']);
const equipes = [t1, t2];
const options: OptionsScanDepot = { taillePrevue: 3, aLaVolee: true, enDepot: new Set() };

/** Enchaîne des scans comme l'écran, en gardant l'état d'un scan à l'autre. */
function enchainer(
  licences: string[],
  teams: Team[] = equipes,
  opts: OptionsScanDepot = options,
  depart: EtatScanDepot = SCAN_DEPOT_VIDE,
) {
  let etat = depart;
  return licences.map((l) => {
    const r = scannerAuDepot(etat, l, teams, opts);
    etat = r.etat;
    return r;
  });
}

describe('dépôt des licences à la volée', () => {
  it('le premier scan ouvre l équipe et compte le joueur', () => {
    const [r] = enchainer(['112']);
    expect(r!.issue.type).toBe('compte');
    expect(r!.etat).toEqual({ ouverte: 't1', scannees: ['112'] });
    expect(r!.message).toMatch(/n°1 ouverte.*1\/3/);
  });

  it('retient les joueurs déjà scannés, et valide le dépôt au dernier', () => {
    const rs = enchainer(['112', '111', '113']);
    expect(rs[1]!.etat.scannees).toEqual(['112', '111']);
    expect(rs[1]!.message).toMatch(/2\/3/);
    const fin = rs[2]!;
    expect(fin.issue).toEqual({ type: 'valider', team: t1 });
    // L'équipe se referme : le scan suivant ouvre l'équipe suivante.
    expect(fin.etat).toEqual(SCAN_DEPOT_VIDE);
    expect(fin.message).toMatch(/dépôt validé/);
  });

  it('passe à l équipe suivante sans rien cliquer', () => {
    const rs = enchainer(['111', '112', '113', '213']);
    expect(rs[3]!.etat).toEqual({ ouverte: 't2', scannees: ['213'] });
  });

  it('refuse un double scan du même joueur, avec sa raison', () => {
    const rs = enchainer(['111', '111']);
    expect(rs[1]!.issue.type).toBe('refus');
    expect(rs[1]!.message).toMatch(/déjà scannée/);
    expect(rs[1]!.etat.scannees).toEqual(['111']);
  });

  it('refuse le joueur d une autre équipe au milieu d une équipe, et dit où on en est', () => {
    const rs = enchainer(['111', '211']);
    expect(rs[1]!.issue.type).toBe('refus');
    expect(rs[1]!.message).toMatch(/équipe n°2, pas dans celle-ci/);
    expect(rs[1]!.message).toMatch(/1\/3/);
    expect(rs[1]!.etat).toEqual({ ouverte: 't1', scannees: ['111'] });
  });

  it('refuse la relecture d une équipe dont le dépôt s enregistre encore', () => {
    // Le dépôt est parti à la base mais `teams` ne le montre pas encore : sans
    // cette garde, relire une licence rouvrirait l'équipe pour un second dépôt.
    const r = scannerAuDepot(SCAN_DEPOT_VIDE, '113', equipes, { ...options, enDepot: new Set(['t1']) });
    expect(r.issue.type).toBe('refus');
    expect(r.message).toMatch(/vient d'être validé/);
  });

  it('une équipe déjà déposée s ouvre, sans second dépôt', () => {
    const deposee = equipe(1, ['111'], { licencesDeposees: '2026-08-04T08:00:00.000Z' });
    const r = scannerAuDepot(SCAN_DEPOT_VIDE, '111', [deposee], { ...options, taillePrevue: 1 });
    expect(r.issue.type).toBe('compte');
    expect(r.message).toMatch(/déjà validé/);
  });

  it('en tête-à-tête ou en mêlée, un seul scan suffit', () => {
    const solo = equipe(5, ['500']);
    const r = scannerAuDepot(SCAN_DEPOT_VIDE, '500', [solo], { ...options, taillePrevue: 1 });
    expect(r.issue).toEqual({ type: 'valider', team: solo });
  });

  it('ne valide pas une équipe incomplète : on y ajoute le joueur qui manque', () => {
    const incomplete = equipe(3, ['311', '312']);
    const rs = enchainer(['311', '312'], [incomplete]);
    expect(rs[1]!.issue.type).toBe('compte');
    expect(rs[1]!.message).toMatch(/incomplète \(1 place libre\)/);
    expect(rs[1]!.etat.ouverte).toBe('t3');
  });

  it('ne valide pas une équipe dont un joueur n a pas de numéro', () => {
    const trou = equipe(4, ['411', undefined, '413']);
    const rs = enchainer(['411', '413'], [trou]);
    expect(rs[1]!.issue.type).toBe('compte');
    expect(rs[1]!.message).toMatch(/1 joueur sans numéro/);
  });

  it('ne valide pas tant qu une licence « Pas inscrit ! » attend', () => {
    const rs = enchainer(['111', '112', '113'], equipes, { ...options, enSuspens: true });
    expect(rs[2]!.issue.type).toBe('compte');
    expect(rs[2]!.message).toMatch(/reste à trancher/);
  });

  it('sans « à la volée », la formation scannée attend le bouton', () => {
    const rs = enchainer(['111', '112', '113'], equipes, { ...options, aLaVolee: false });
    expect(rs[2]!.issue.type).toBe('compte');
    expect(rs[2]!.message).toMatch(/validez le dépôt/);
  });

  it('une licence que personne ne porte ouvre « Pas inscrit ! » sur l équipe ouverte', () => {
    const rs = enchainer(['111', '999']);
    expect(rs[1]!.issue).toEqual({ type: 'pas_inscrit', licence: '999', fiche: undefined });
    expect(rs[1]!.etat.scannees).toEqual(['111']);
  });

  it('sans équipe ouverte, une licence inconnue est refusée avec sa raison', () => {
    const [r] = enchainer(['999']);
    expect(r!.issue.type).toBe('refus');
    expect(r!.message).toMatch(/aucune équipe/);
  });

  it('oublie le scan d un joueur remplacé entre-temps', () => {
    const apres = equipe(1, ['111', '199', '113']);
    const rs = enchainer(['113', '199'], [apres], options, { ouverte: 't1', scannees: ['112'] });
    expect(rs[1]!.etat.scannees).toEqual(['113', '199']);
  });
});
