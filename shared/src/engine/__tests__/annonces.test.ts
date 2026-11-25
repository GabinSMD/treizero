import { describe, expect, it } from 'vitest';
import {
  contexteAnnonce,
  partiesAAnnoncer,
  phraseAnnonce,
  signatureAnnonce,
  signaturesActuelles,
} from '../annonces';
import type { Match, Poule } from '../../types';

function match(over: Partial<Match> & { id: string }): Match {
  return {
    concoursId: 'c1',
    stage: 'poule',
    round: 0,
    position: 0,
    teamAId: 'a',
    teamBId: 'b',
    scoreA: null,
    scoreB: null,
    done: false,
    terrain: 5,
    updatedAt: '2026-11-23T09:00:00.000Z',
    ...over,
  };
}

const poule: Poule = {
  id: 'p3',
  concoursId: 'c1',
  index: 3,
  teamIds: ['a', 'b', 'c', 'd'],
  terrain: 5,
  updatedAt: '',
};

const numeros: Record<string, number> = { a: 12, b: 34, c: 7, d: 9, e: 3, f: 8, g: 5 };
const options = (matches: Match[]) => ({
  numeroDe: (id: string) => numeros[id],
  poules: [poule],
  matches,
});

describe('parties à annoncer', () => {
  it('ignore les parties jouées, exemptes ou dont un camp manque', () => {
    const ms = [
      match({ id: 'jouee', done: true, scoreA: 13, scoreB: 4 }),
      match({ id: 'exempt', byeB: true, teamBId: null }),
      match({ id: 'attente', teamBId: null }),
      match({ id: 'prete' }),
    ];
    expect(partiesAAnnoncer(ms, new Set()).map((m) => m.id)).toEqual(['prete']);
  });

  it("n'annonce pas deux fois la même partie", () => {
    const m = match({ id: 'm1' });
    const deja = new Set([signatureAnnonce(m)!]);
    expect(partiesAAnnoncer([m], deja)).toEqual([]);
  });

  it('réannonce une partie qui reçoit son terrain, ou dont un camp change', () => {
    const sansTerrain = match({ id: 'm1', terrain: null });
    const deja = new Set(signaturesActuelles([sansTerrain]));
    expect(partiesAAnnoncer([{ ...sansTerrain, terrain: 4 }], deja)).toHaveLength(1);
    expect(partiesAAnnoncer([{ ...sansTerrain, teamBId: 'c' }], deja)).toHaveLength(1);
    // Le score en cours ou un retard ne changent rien à l'appel.
    expect(partiesAAnnoncer([{ ...sansTerrain, retard: true }], deja)).toHaveLength(0);
  });

  it("suit l'ordre d'un appel : étape, tour, terrain", () => {
    const ms = [
      match({ id: 'tableau', stage: 'principal', round: 0, terrain: 1 }),
      match({ id: 't7', terrain: 7 }),
      match({ id: 'sans', terrain: null, position: 0 }),
      match({ id: 't2', terrain: 2, position: 3 }),
    ];
    expect(partiesAAnnoncer(ms, new Set()).map((m) => m.id)).toEqual([
      't2',
      't7',
      'sans',
      'tableau',
    ]);
  });
});

describe('phrase annoncée', () => {
  it('appelle une partie de poule par les numéros et le terrain', () => {
    const m = match({ id: 'm1', pouleId: 'p3', pouleSlot: 'M1' });
    expect(phraseAnnonce(m, options([m]))).toBe('Poule 3 : équipe 12 contre équipe 34, terrain 5.');
  });

  it('nomme le barrage et les parties des gagnants', () => {
    const barrage = match({ id: 'b', pouleId: 'p3', pouleSlot: 'BARRAGE' });
    const gagnants = match({ id: 'g', pouleId: 'p3', pouleSlot: 'GAGNANTS' });
    expect(phraseAnnonce(barrage, options([barrage]))).toBe(
      'Poule 3, barrage : équipe 12 contre équipe 34, terrain 5.',
    );
    expect(contexteAnnonce(gagnants, [poule], [gagnants])).toBe('Poule 3, partie des gagnants');
  });

  it('dit les terrains en lettres quand le concours les peint ainsi', () => {
    const m = match({ id: 'm1', pouleId: 'p3', pouleSlot: 'M2', terrain: 4 });
    expect(phraseAnnonce(m, { ...options([m]), libelleTerrains: 'lettre' })).toBe(
      'Poule 3 : équipe 12 contre équipe 34, terrain D.',
    );
  });

  it("se passe du terrain quand il n'est pas attribué", () => {
    const m = match({ id: 'm1', stage: 'ronde', round: 1, terrain: null });
    expect(phraseAnnonce(m, options([m]))).toBe('Ronde 2 : équipe 12 contre équipe 34.');
  });

  it('dit le tour du tableau au singulier, en toutes lettres', () => {
    // Tableau de 16 : tours 0 (huitièmes) à 3 (finale).
    const tableau = [0, 1, 2, 3].map((round) =>
      match({ id: `r${round}`, stage: 'principal', round }),
    );
    const dits = tableau.map((m) => contexteAnnonce(m, [], tableau));
    expect(dits).toEqual(['Huitième de finale', 'Quart de finale', 'Demi-finale', 'Finale']);
  });

  it('nomme la consolante et le cadrage', () => {
    const cadrage = match({ id: 'c0', stage: 'consolante', round: 0 });
    const exempt = match({ id: 'c1', stage: 'consolante', round: 0, byeB: true, teamBId: null });
    const demi = match({ id: 'c2', stage: 'consolante', round: 1 });
    const finale = match({ id: 'c3', stage: 'consolante', round: 2 });
    const tous = [cadrage, exempt, demi, finale];
    expect(contexteAnnonce(cadrage, [], tous)).toBe('Consolante, cadrage');
    expect(contexteAnnonce(demi, [], tous)).toBe('Consolante, demi-finale');
  });

  it('appelle les joueurs de mêlée par leurs numéros', () => {
    const m = match({
      id: 'm1',
      stage: 'ronde',
      round: 0,
      teamAId: null,
      teamBId: null,
      playersA: ['e', 'f'],
      playersB: ['c', 'd', 'g'],
      terrain: 2,
    });
    expect(phraseAnnonce(m, options([m]))).toBe(
      'Ronde 1 : joueurs 3 et 8 contre joueurs 7, 9 et 5, terrain 2.',
    );
  });
});
