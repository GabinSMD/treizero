import { describe, expect, it } from 'vitest';
import { fileInscriptions, placerScan } from '../scanInscription';

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

  it('dix scans enchaînés en doublette donnent cinq équipes, base encore muette', () => {
    // Le cas de la douchette : aucune écriture n'est revenue de la base, chaque
    // équipe complète part à l'enregistrement et le scan suivant arrive aussitôt.
    const enInscription = new Set<string>();
    const equipes: string[][] = [];
    let encours: string[] = [];
    for (let i = 0; i < 10; i++) {
      const licence = String(100000 + i);
      const r = placerScan(encours, licence, 2, { dejaInscrites: new Map(), enInscription });
      expect(r.ok).toBe(true);
      encours = [...encours, licence];
      if (r.ok && r.complete) {
        for (const l of encours) enInscription.add(l);
        equipes.push(encours);
        encours = [];
      }
    }
    expect(equipes).toHaveLength(5);
    expect(new Set(equipes.flat()).size).toBe(10);
  });
});

describe('file des inscriptions', () => {
  /** Inscription simulée : lit les dossards pris, attend la base, puis écrit. */
  const inscrire = (dossards: number[]) => async (): Promise<number> => {
    const lu = dossards.length;
    await new Promise((r) => setTimeout(r, 1));
    const numero = lu + 1;
    dossards.push(numero);
    return numero;
  };

  it('deux équipes complétées coup sur coup reçoivent deux dossards différents', async () => {
    // Sans file, les deux écritures lisent la même liste et prennent le n°1.
    const dossards: number[] = [];
    const enFile = fileInscriptions();
    const numeros = await Promise.all([
      enFile(inscrire(dossards)),
      enFile(inscrire(dossards)),
      enFile(inscrire(dossards)),
    ]);
    expect(numeros).toEqual([1, 2, 3]);
    expect(dossards).toEqual([1, 2, 3]);
  });

  it('un échec revient à son appelant sans bloquer les inscriptions suivantes', async () => {
    const dossards: number[] = [];
    const enFile = fileInscriptions();
    const echec = enFile(async () => {
      throw new Error('base indisponible');
    });
    const suivante = enFile(inscrire(dossards));
    await expect(echec).rejects.toThrow('base indisponible');
    await expect(suivante).resolves.toBe(1);
  });
});

describe('consigne d une équipe complète', () => {
  it('l appelant peut dire quoi faire à la place de « inscrivez-la »', () => {
    const r = placerScan(['1'], '2', 1, { ...vide, siComplete: (l) => `retirez-en un pour ${l}.` });
    expect(!r.ok && r.raison).toBe('Équipe complète (1 joueur) : retirez-en un pour 2.');
  });
});
