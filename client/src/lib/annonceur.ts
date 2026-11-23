/**
 * Voix de l'écran d'affichage : la synthèse vocale du navigateur
 * (`speechSynthesis`), en français.
 *
 * - **Hors réseau** : on préfère une voix installée sur l'appareil
 *   (`localService`) ; celles « en ligne » (Google, Microsoft Online…) se taisent
 *   au boulodrome sans réseau.
 * - **Sans voix française** : on lit quand même, en demandant le français ; le
 *   navigateur prend sa voix par défaut, avec son accent. L'écran le signale.
 * - **File d'attente** : une annonce n'en coupe jamais une autre. On attend la
 *   fin de chacune (avec un filet de sécurité : certains navigateurs oublient de
 *   prévenir qu'ils ont fini) et on laisse un court silence entre deux.
 */

export type EtatVoix =
  /** Pas de synthèse vocale dans ce navigateur. */
  | { type: 'absente' }
  /** Voix française trouvée. */
  | { type: 'francaise'; nom: string; horsLigne: boolean }
  /** Aucune voix française : la voix par défaut lira le texte. */
  | { type: 'defaut' };

const SILENCE_ENTRE_ANNONCES_MS = 700;

export function syntheseDisponible(): boolean {
  return (
    typeof window !== 'undefined' &&
    'speechSynthesis' in window &&
    typeof window.SpeechSynthesisUtterance === 'function'
  );
}

/**
 * La meilleure voix française : installée sur l'appareil d'abord (elle marche
 * sans réseau), puis française de France, puis n'importe quel français.
 */
export function choisirVoix(voix: SpeechSynthesisVoice[]): SpeechSynthesisVoice | null {
  const fr = voix.filter((v) => v.lang.toLowerCase().replace('_', '-').startsWith('fr'));
  if (fr.length === 0) return null;
  const note = (v: SpeechSynthesisVoice) =>
    (v.localService ? 2 : 0) + (v.lang.toLowerCase().replace('_', '-') === 'fr-fr' ? 1 : 0);
  return [...fr].sort((a, b) => note(b) - note(a))[0] ?? null;
}

export function etatVoix(): EtatVoix {
  if (!syntheseDisponible()) return { type: 'absente' };
  const v = choisirVoix(window.speechSynthesis.getVoices());
  return v ? { type: 'francaise', nom: v.name, horsLigne: v.localService } : { type: 'defaut' };
}

/**
 * Suit la liste des voix : elle arrive souvent après le chargement de la page
 * (événement `voiceschanged`), parfois jamais quand il n'y en a pas.
 */
export function suivreVoix(rappel: () => void): () => void {
  if (!syntheseDisponible()) return () => {};
  const synth = window.speechSynthesis;
  synth.addEventListener?.('voiceschanged', rappel);
  return () => synth.removeEventListener?.('voiceschanged', rappel);
}

/** Durée raisonnable d'une phrase lue posément, pour le filet de sécurité. */
function dureeMaxMs(texte: string): number {
  return 4000 + texte.length * 120;
}

/** File d'annonces lues l'une après l'autre. */
export class Annonceur {
  private file: string[] = [];
  private enCours = false;
  private minuteur: number | undefined;
  private arrete = false;

  constructor(private readonly surChangement: () => void = () => {}) {}

  /** Nombre d'annonces en attente, celle en cours comprise. */
  get enAttente(): number {
    return this.file.length + (this.enCours ? 1 : 0);
  }

  annoncer(texte: string): void {
    if (!syntheseDisponible() || this.arrete) return;
    this.file.push(texte);
    this.surChangement();
    if (!this.enCours) this.suivante();
  }

  /** Vide la file et coupe l'annonce en cours. */
  arreter(): void {
    this.arrete = true;
    this.file = [];
    this.enCours = false;
    window.clearTimeout(this.minuteur);
    if (syntheseDisponible()) window.speechSynthesis.cancel();
    this.surChangement();
  }

  private suivante(): void {
    const texte = this.file.shift();
    if (texte === undefined || this.arrete) {
      this.enCours = false;
      this.surChangement();
      return;
    }
    this.enCours = true;
    this.surChangement();

    const synth = window.speechSynthesis;
    const enonce = new SpeechSynthesisUtterance(texte);
    const voix = choisirVoix(synth.getVoices());
    if (voix) enonce.voice = voix;
    enonce.lang = voix?.lang ?? 'fr-FR';
    enonce.rate = 0.95;

    let fini = false;
    const terminer = () => {
      if (fini) return;
      fini = true;
      window.clearTimeout(this.minuteur);
      // Un court silence : deux appels collés se comprennent mal.
      this.minuteur = window.setTimeout(() => this.suivante(), SILENCE_ENTRE_ANNONCES_MS);
    };
    enonce.onend = terminer;
    enonce.onerror = terminer;
    // Filet de sécurité : sans `end`, la file resterait bloquée pour la journée.
    this.minuteur = window.setTimeout(terminer, dureeMaxMs(texte));
    // Chrome se met parfois en pause tout seul après une longue inactivité.
    if (synth.paused) synth.resume();
    synth.speak(enonce);
  }
}
