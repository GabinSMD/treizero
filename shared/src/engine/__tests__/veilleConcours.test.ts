import { describe, expect, it } from 'vitest';
import type { Concours } from '../../types';
import { fraicheurLicencies } from '../fraicheurLicencies';
import { afficherVeille, pointsVeille, type EntreeVeille, type PointVeille } from '../veilleConcours';

const NOV_2026 = '2026-11-18T20:00:00.000Z';

const concours: Concours = {
  id: 'c1',
  name: 'Concours du samedi',
  date: '2026-11-19',
  format: 'doublette',
  mode: 'poules',
  consolante: false,
  scoreMax: 13,
  nbTerrains: 8,
  tempsLimite: 60,
  status: 'inscriptions',
  createdAt: NOV_2026,
  updatedAt: NOV_2026,
} as Concours;

function entree(e: Partial<EntreeVeille> = {}): EntreeVeille {
  return {
    concours,
    equipesEngagees: 16,
    fraicheur: fraicheurLicencies('2026-11-10T00:00:00.000Z', 1200, NOV_2026),
    serviceWorker: true,
    stockagePersistant: true,
    statutSynchro: 'synced',
    enAttente: 0,
    ...e,
  };
}

function point<K extends PointVeille['cle']>(points: PointVeille[], cle: K) {
  return points.find((p) => p.cle === cle) as Extract<PointVeille, { cle: K }> | undefined;
}

describe('encart « Prêt pour demain ? »', () => {
  it('ne s affiche qu en inscriptions : il disparaît au tirage', () => {
    expect(afficherVeille({ status: 'inscriptions' })).toBe(true);
    expect(afficherVeille({ status: 'poules' })).toBe(false);
    expect(afficherVeille({ status: 'tableau' })).toBe(false);
    expect(afficherVeille({ status: 'rondes' })).toBe(false);
  });

  it('tout est vert quand tout est prêt', () => {
    const points = pointsVeille(entree({ concours: { ...concours, niveau: 'departemental' } as Concours }));
    expect(points.map((p) => p.cle)).toEqual([
      'licencies',
      'terrains',
      'parametres',
      'horsLigne',
      'synchro',
    ]);
    expect(points.every((p) => p.etat === 'ok')).toBe(true);
  });
});

describe('fichier des licenciés', () => {
  const officiel = { ...concours, categorieAge: 'seniors' } as Concours;

  it('n est pas vérifié pour un concours de club', () => {
    expect(point(pointsVeille(entree()), 'licencies')).toBeUndefined();
  });

  it('alerte sur une base d une saison révolue, pas sur son âge en jours', () => {
    // Octobre 2026 appartient à la saison 2026 ; en novembre, on est en 2027.
    const ancienne = fraicheurLicencies('2026-10-20T00:00:00.000Z', 1200, NOV_2026);
    expect(point(pointsVeille(entree({ concours: officiel, fraicheur: ancienne })), 'licencies')?.etat).toBe(
      'attention',
    );
    // Décembre en février : même saison, donc bon.
    const decembre = fraicheurLicencies('2026-12-01T00:00:00.000Z', 1200, '2027-02-10T00:00:00.000Z');
    expect(point(pointsVeille(entree({ concours: officiel, fraicheur: decembre })), 'licencies')?.etat).toBe('ok');
  });

  it('ne crie pas au loup sur une base sans date lisible', () => {
    const sansDate = fraicheurLicencies('hier', 1200, NOV_2026);
    expect(point(pointsVeille(entree({ concours: officiel, fraicheur: sansDate })), 'licencies')?.etat).toBe('ok');
  });

  it('alerte quand aucun fichier n est importé', () => {
    const vide = fraicheurLicencies(undefined, 0, NOV_2026);
    expect(point(pointsVeille(entree({ concours: officiel, fraicheur: vide })), 'licencies')?.etat).toBe(
      'attention',
    );
  });
});

describe('terrains', () => {
  it('reprend le besoin calculé pour le tirage', () => {
    // 16 équipes en poules : huit terrains, on en a huit.
    expect(point(pointsVeille(entree()), 'terrains')?.etat).toBe('ok');
    // En élimination directe, 16 équipes font huit parties au premier tour. (En
    // poules, le tirage s'adapte lui-même au manque avec des poules de 3.)
    const p = point(
      pointsVeille(entree({ concours: { ...concours, mode: 'elimination_directe', nbTerrains: 6 } })),
      'terrains',
    );
    expect(p?.etat).toBe('attention');
    expect(p?.besoin.manquants).toBe(2);
  });

  it('reste neutre quand aucun terrain n est déclaré', () => {
    expect(point(pointsVeille(entree({ concours: { ...concours, nbTerrains: 0 } })), 'terrains')?.etat).toBe('info');
  });

  it('disparaît quand le besoin n a pas de sens', () => {
    expect(point(pointsVeille(entree({ equipesEngagees: 1 })), 'terrains')).toBeUndefined();
    expect(
      point(pointsVeille(entree({ concours: { ...concours, mode: 'tir_precision' } })), 'terrains'),
    ).toBeUndefined();
  });
});

describe('paramètres', () => {
  it('un concours sans temps limite est un choix, pas un oubli', () => {
    const p = point(pointsVeille(entree({ concours: { ...concours, tempsLimite: undefined } })), 'parametres');
    expect(p?.etat).toBe('info');
    expect(p?.manque).toEqual(['tempsLimite']);
  });

  it('des points de partie absents sont à régler', () => {
    const p = point(pointsVeille(entree({ concours: { ...concours, scoreMax: 0 } })), 'parametres');
    expect(p?.etat).toBe('attention');
  });
});

describe('appareil prêt hors ligne', () => {
  it('alerte tant qu aucun service worker ne sert la page', () => {
    expect(point(pointsVeille(entree({ serviceWorker: false })), 'horsLigne')?.etat).toBe('attention');
  });

  it('signale sans alarmer un stockage que le navigateur peut purger', () => {
    expect(point(pointsVeille(entree({ stockagePersistant: false })), 'horsLigne')?.etat).toBe('info');
    expect(point(pointsVeille(entree({ stockagePersistant: null })), 'horsLigne')?.etat).toBe('ok');
  });
});

describe('synchronisation de cet appareil', () => {
  const etat = (statutSynchro: string, enAttente = 0) =>
    point(pointsVeille(entree({ statutSynchro, enAttente })), 'synchro')?.etat;

  it('alerte sur des modifications pas encore envoyées', () => {
    expect(etat('offline', 3)).toBe('attention');
    expect(etat('synced', 1)).toBe('attention');
  });

  it('alerte quand la synchronisation est en panne ou suspendue', () => {
    expect(etat('auth')).toBe('attention');
    expect(etat('protege')).toBe('attention');
    expect(etat('error')).toBe('attention');
  });

  it('un compte invité ne synchronise pas, par choix', () => {
    expect(etat('guest', 4)).toBe('info');
  });

  it('à jour quand tout est envoyé', () => {
    expect(etat('synced')).toBe('ok');
    expect(etat('offline')).toBe('info');
  });
});
