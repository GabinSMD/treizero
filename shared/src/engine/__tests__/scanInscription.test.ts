import { describe, expect, it } from 'vitest';
import { placerScan } from '../scanInscription';

const vide = { dejaInscrites: new Map<string, number>(), enInscription: new Set<string>() };

describe('placement d un scan dans l équipe en cours d inscription', () => {
  it('un scan prend la place suivante', () => {
    expect(placerScan(['111111'], '222222', 3, vide)).toEqual({ ok: true, complete: false });
  });

  it('le dernier joueur de la formation complète l équipe', () => {
    expect(placerScan(['111111', '222222'], '333333', 3, vide)).toEqual({
      ok: true,
      complete: true,
    });
  });

  it('une équipe déjà complète refuse le scan, avec sa raison', () => {
    // Le défaut corrigé : `[...encours, joueur].slice(0, parEquipe)` coupait ce
    // joueur sans un mot. La table de marque croyait l'avoir scanné.
    const r = placerScan(['111111', '222222'], '333333', 2, vide);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toMatch(/complète/);
  });

  it('une licence déjà scannée pour cette équipe est refusée', () => {
    const r = placerScan(['111111'], '111111', 3, vide);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toMatch(/déjà scannée/);
  });

  it('une licence déjà inscrite dit dans quelle équipe', () => {
    const r = placerScan([], '111111', 3, { ...vide, dejaInscrites: new Map([['111111', 7]]) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toMatch(/n°7/);
  });

  it('une licence de l équipe en train d être enregistrée est refusée', () => {
    // Pendant l'écriture en base, l'équipe complète n'est plus à l'écran et pas
    // encore dans la liste des inscrites : sans cette garde, relire la licence
    // du dernier joueur l'inscrirait une seconde fois dans l'équipe suivante.
    const r = placerScan([], '333333', 3, { ...vide, enInscription: new Set(['333333']) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.raison).toMatch(/en cours d'inscription/);
  });

  it('le scan qui suit une équipe partie à l enregistrement ouvre l équipe suivante', () => {
    expect(
      placerScan([], '444444', 3, { ...vide, enInscription: new Set(['111111', '222222', '333333']) }),
    ).toEqual({ ok: true, complete: false });
  });

  it('en tête-à-tête, chaque scan complète une équipe', () => {
    expect(placerScan([], '111111', 1, vide)).toEqual({ ok: true, complete: true });
  });
});
