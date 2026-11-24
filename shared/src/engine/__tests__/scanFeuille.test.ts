import { describe, expect, it } from 'vitest';
import { feuilleVierge, type FeuilleMatch } from '../feuilleMatch';
import { FORMATION_FEUILLE, ficheSuivante, fichesDuClub, placerScanFeuille } from '../scanFeuille';

function fiche(id: string, patch: Partial<FeuilleMatch> = {}): FeuilleMatch {
  return {
    ...feuilleVierge(id, '2026-11-22', 'cnc_open'),
    club: 'Pétanque du Vercors',
    numeroClub: '0380423',
    mutations: 'aucun',
    ...patch,
  };
}

const huit = Array.from({ length: FORMATION_FEUILLE }, (_, i) => `0380000${i}`);
let n = 0;
const nouvelId = () => `neuve-${++n}`;

describe('scan sur la feuille de match', () => {
  it('la formation compte huit joueurs, et le huitième la complète', () => {
    const a = fiche('a', { equipe: 'A' });
    expect(placerScanFeuille(a, huit.slice(0, 7), huit[7]!, [])).toEqual({ ok: true, complete: true });
  });

  it('refuse la neuvième licence, avec sa raison', () => {
    const r = placerScanFeuille(fiche('a'), huit, '99999999', []);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toMatch(/Équipe complète \(8 joueurs\) : la licence 99999999 n'entre pas/);
  });

  it('refuse une licence déjà sur la fiche', () => {
    const r = placerScanFeuille(fiche('a'), ['1'], '1', []);
    expect(!r.ok && r.raison).toMatch(/déjà scannée/);
  });

  it('refuse un joueur déjà dans une autre équipe du club, en la nommant', () => {
    const a = fiche('a', { equipe: 'A', licences: ['1'] });
    const b = fiche('b', { equipe: 'B' });
    const r = placerScanFeuille(b, [], '1', fichesDuClub([a, b], b));
    expect(!r.ok && r.raison).toMatch(/déjà inscrite dans Equipe A:Pétanque du Vercors/);
  });

  it('refuse la relecture d un joueur de la fiche qu on vient de quitter', () => {
    // A vient d'être complétée et la base ne l'a pas encore relue : l'écran la
    // passe telle qu'il l'a écrite, et la relecture du 8e joueur est refusée.
    const a = fiche('a', { equipe: 'A', licences: huit });
    const b = fiche('b', { equipe: 'B' });
    const r = placerScanFeuille(b, [], huit[7]!, [a]);
    expect(!r.ok && r.raison).toMatch(/déjà inscrite dans Equipe A/);
  });

  it('refuse tout scan sur une feuille signée, en le disant', () => {
    const signee = fiche('a', { signatures: { a: { image: '', quand: '', empreinte: 'x' }, b: null } });
    const r = placerScanFeuille(signee, [], '1', []);
    expect(!r.ok && r.raison).toMatch(/Feuille signée/);
  });
});

describe('fiche suivante (A→H)', () => {
  it('les fiches du club : même compétition, même date, même club', () => {
    const a = fiche('a', { equipe: 'A' });
    const b = fiche('b', { equipe: 'B', club: ' pétanque du vercors ', adversaire: 'Autre' });
    const autreDate = fiche('c', { equipe: 'C', date: '2026-11-29' });
    const autreClub = fiche('d', { equipe: 'D', club: 'Boule Iséroise' });
    const sansLettre = fiche('e');
    expect(fichesDuClub([a, b, autreDate, autreClub, sansLettre], a).map((f) => f.id)).toEqual([
      'b',
    ]);
  });

  it('crée la fiche B avec l identité de A, quand elle n existe pas', () => {
    const a = fiche('a', { equipe: 'A', adversaire: 'Boule Iséroise', division: 'D1', licences: huit });
    const s = ficheSuivante([a], a, () => 'b');
    expect(s.type).toBe('nouvelle');
    if (s.type !== 'nouvelle') return;
    expect(s.feuille).toMatchObject({
      id: 'b',
      equipe: 'B',
      club: 'Pétanque du Vercors',
      numeroClub: '0380423',
      date: '2026-11-22',
      competition: 'cnc_open',
      mutations: 'aucun',
      licences: [],
      adversaire: '',
      division: '',
    });
  });

  it('reprend la fiche B existante', () => {
    const a = fiche('a', { equipe: 'A' });
    const b = fiche('b', { equipe: 'B', licences: ['1'] });
    expect(ficheSuivante([a, b], a, nouvelId)).toEqual({ type: 'existante', feuille: b });
  });

  it('saute une fiche signée ou déjà complète', () => {
    const a = fiche('a', { equipe: 'A' });
    const b = fiche('b', { equipe: 'B', licences: huit });
    const c = fiche('c', {
      equipe: 'C',
      signatures: { a: null, b: { image: '', quand: '', empreinte: 'x' } },
    });
    const s = ficheSuivante([a, b, c], a, () => 'd');
    expect(s.type === 'nouvelle' && s.feuille.equipe).toBe('D');
  });

  it('après H, pas de fiche suivante, et on le dit', () => {
    const h = fiche('h', { equipe: 'H' });
    const s = ficheSuivante([h], h, nouvelId);
    expect(s.type === 'aucune' && s.raison).toMatch(/H est la dernière/);
  });

  it('sans lettre, on demande de la choisir plutôt que d inventer A', () => {
    const seule = fiche('x');
    const s = ficheSuivante([seule], seule, nouvelId);
    expect(s.type === 'aucune' && s.raison).toMatch(/choisissez d'abord la lettre/);
  });
});
