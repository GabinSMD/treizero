/**
 * Décodage du contenu d'un QR code de licence (manuel §3.B.2 et §3.B.3).
 *
 * Le format exact encodé dans une licence FFPJP n'est pas documenté dans le
 * manuel — il n'y figure que des copies d'écran du lecteur. On décode donc
 * les formes plausibles (numéro seul, champs séparés, JSON, adresse web) et,
 * surtout, on **ne devine pas** : un contenu non reconnu est rendu tel quel
 * pour que la table de marque décide, plutôt que d'inscrire un joueur avec un
 * mauvais numéro.
 */

export interface LicenceQr {
  /** Numéro de licence, si on a su le reconnaître. */
  licence?: string;
  nom?: string;
  prenom?: string;
  /** « Prénom NOM », prêt pour le champ joueur. */
  name?: string;
  /** Contenu brut du QR, toujours renseigné. */
  brut: string;
}

/** Un numéro de licence fédérale : 6 à 11 chiffres, une fois la ponctuation ôtée. */
const LICENCE_RE = /^\d{6,11}$/;

const CLES_LICENCE = ['licence', 'license', 'lic', 'numlicence', 'numero', 'num'];
const CLES_NOM = ['nom', 'lastname', 'name'];
const CLES_PRENOM = ['prenom', 'firstname'];

const chiffres = (s: string): string => s.replace(/[\s.\-/]/g, '');

/**
 * Touches de la rangée des chiffres d'un clavier AZERTY, sans Maj, de 1 à 0.
 * Une douchette réglée en QWERTY (le réglage d'usine) envoie les codes de ces
 * touches pour écrire des chiffres : branchée sur un poste français, elle
 * « tape » donc `&é"'(-è_çà` au lieu de `1234567890`. Le piège est courant, et
 * le reconfigurer demande de scanner les codes-barres de son manuel, que la
 * table de marque n'a jamais sous la main le jour du concours.
 */
const RANGEE_AZERTY = '&é"\'(-è_çà';

/**
 * Rétablit les chiffres d'une saisie faite par une douchette QWERTY sur un
 * clavier AZERTY. Ne touche qu'une saisie faite **uniquement** de ces touches
 * (et de ponctuation de licence) : `l'équipe` ou un nom à accent restent tels
 * quels.
 */
function depuisRangeeAzerty(texte: string): string | null {
  if (!/^[&é"'(\-è_çà\s.]+$/.test(texte) || !/[&é"'(è_çà]/.test(texte)) return null;
  let sortie = '';
  for (const c of texte) {
    const i = RANGEE_AZERTY.indexOf(c);
    // `-` est à la fois le 6 et un séparateur : dans cette rangée, c'est le 6.
    sortie += i >= 0 ? String((i + 1) % 10) : c;
  }
  return sortie;
}

const normCle = (s: string): string =>
  s
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z]/g, '');

function estLicence(valeur: string): boolean {
  return LICENCE_RE.test(chiffres(valeur));
}

/** Assemble « Prénom NOM » à partir de ce qu'on a. */
function composerNom(nom?: string, prenom?: string): string | undefined {
  const complet = [prenom, nom].filter(Boolean).join(' ').trim();
  return complet || undefined;
}

/** Paires clé=valeur, quel que soit le séparateur de champs. */
function depuisPaires(champs: string[]): Partial<LicenceQr> | null {
  const trouve: Partial<LicenceQr> = {};
  let auMoinsUne = false;
  for (const champ of champs) {
    const eq = champ.indexOf('=');
    const deuxPoints = champ.indexOf(':');
    const coupe = eq >= 0 ? eq : deuxPoints;
    if (coupe <= 0) continue;
    const cle = normCle(champ.slice(0, coupe));
    const valeur = champ.slice(coupe + 1).trim();
    if (!valeur) continue;
    if (CLES_LICENCE.includes(cle) && estLicence(valeur)) {
      trouve.licence = chiffres(valeur);
      auMoinsUne = true;
    } else if (CLES_NOM.includes(cle)) {
      trouve.nom = valeur;
      auMoinsUne = true;
    } else if (CLES_PRENOM.includes(cle)) {
      trouve.prenom = valeur;
      auMoinsUne = true;
    }
  }
  return auMoinsUne ? trouve : null;
}

/** Champs positionnels : le nombre est la licence, les mots sont nom puis prénom. */
function depuisChamps(champs: string[]): Partial<LicenceQr> {
  const trouve: Partial<LicenceQr> = {};
  const mots: string[] = [];
  for (const champ of champs) {
    const v = champ.trim();
    if (!v) continue;
    if (!trouve.licence && estLicence(v)) {
      trouve.licence = chiffres(v);
      continue;
    }
    if (/[a-zA-ZÀ-ÿ]/.test(v)) mots.push(v);
  }
  if (mots.length > 0) trouve.nom = mots[0];
  if (mots.length > 1) trouve.prenom = mots[1];
  return trouve;
}

function depuisJson(texte: string): Partial<LicenceQr> | null {
  if (!texte.startsWith('{')) return null;
  try {
    const objet = JSON.parse(texte) as Record<string, unknown>;
    const trouve: Partial<LicenceQr> = {};
    for (const [cle, valeur] of Object.entries(objet)) {
      if (typeof valeur !== 'string' && typeof valeur !== 'number') continue;
      const v = String(valeur);
      const k = normCle(cle);
      if (CLES_LICENCE.includes(k) && estLicence(v)) trouve.licence = chiffres(v);
      else if (CLES_NOM.includes(k)) trouve.nom = v;
      else if (CLES_PRENOM.includes(k)) trouve.prenom = v;
    }
    return trouve;
  } catch {
    return null;
  }
}

function depuisUrl(texte: string): Partial<LicenceQr> | null {
  if (!/^https?:\/\//i.test(texte)) return null;
  try {
    const url = new URL(texte);
    const trouve: Partial<LicenceQr> = {};
    for (const [cle, valeur] of url.searchParams) {
      const k = normCle(cle);
      if (CLES_LICENCE.includes(k) && estLicence(valeur)) trouve.licence = chiffres(valeur);
      else if (CLES_NOM.includes(k)) trouve.nom = valeur;
      else if (CLES_PRENOM.includes(k)) trouve.prenom = valeur;
    }
    if (!trouve.licence) {
      const segments = url.pathname.split('/').filter(Boolean);
      const dernier = segments.at(-1);
      if (dernier && estLicence(dernier)) trouve.licence = chiffres(dernier);
    }
    return trouve;
  } catch {
    return null;
  }
}

/**
 * Décode le contenu d'un QR code (ou d'une saisie de douchette). Rend `null`
 * si le contenu est vide ; sinon le brut est toujours présent, la licence
 * seulement si elle a été reconnue.
 */
export function parseLicenceQr(contenu: string): LicenceQr | null {
  const brut = contenu.trim();
  if (!brut) return null;

  const azerty = depuisRangeeAzerty(brut);
  if (azerty && estLicence(azerty)) return { licence: chiffres(azerty), brut };

  const champs = brut.split(/[;|,\t\n]+/);
  const trouve =
    depuisJson(brut) ??
    depuisUrl(brut) ??
    depuisPaires(champs) ??
    (estLicence(brut) ? { licence: chiffres(brut) } : depuisChamps(champs));

  return {
    ...trouve,
    name: composerNom(trouve.nom, trouve.prenom),
    brut,
  };
}
