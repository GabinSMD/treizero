import { Camera, Square } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { decoderImageQr } from '../lib/qr';

interface Props {
  /** Contenu brut d'un QR lu. Un même code n'est rendu qu'une fois en 2,5 s. */
  onCode: (contenu: string) => void;
}

/**
 * Lecture de QR code à la caméra, pour l'inscription comme pour le dépôt des
 * licences (manuel §3.B.2, §3.C).
 *
 * Le décodage est celui de `decoderImageQr` : `BarcodeDetector` quand le
 * navigateur l'offre (Chrome, Android), sinon jsQR, embarqué dans
 * l'application, donc fonctionnel hors ligne.
 *
 * `onCode` est relu à chaque image via une référence : la boucle de lecture
 * démarre une fois, et un rappel capturé au démarrage travaillerait sur l'état
 * de ce moment-là, perdant les joueurs scannés depuis.
 */
export function CameraQr({ onCode }: Props) {
  const [etat, setEtat] = useState<'inactive' | 'demande' | 'active' | 'refusee'>('inactive');
  const [erreur, setErreur] = useState<string | null>(null);

  const video = useRef<HTMLVideoElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const flux = useRef<MediaStream | null>(null);
  const boucle = useRef<number | null>(null);
  const dernier = useRef<{ contenu: string; at: number }>({ contenu: '', at: 0 });
  const rappel = useRef(onCode);
  rappel.current = onCode;

  const arreter = (): void => {
    if (boucle.current !== null) {
      cancelAnimationFrame(boucle.current);
      boucle.current = null;
    }
    flux.current?.getTracks().forEach((t) => t.stop());
    flux.current = null;
  };

  useEffect(() => arreter, []);

  const lu = (contenu: string): void => {
    const maintenant = Date.now();
    if (contenu === dernier.current.contenu && maintenant - dernier.current.at < 2500) return;
    dernier.current = { contenu, at: maintenant };
    rappel.current(contenu);
  };

  const lireImages = (): void => {
    const tick = async (): Promise<void> => {
      const v = video.current;
      const c = canvas.current;
      if (v && c && v.readyState === v.HAVE_ENOUGH_DATA) {
        c.width = v.videoWidth;
        c.height = v.videoHeight;
        c.getContext('2d', { willReadFrequently: true })?.drawImage(v, 0, 0, c.width, c.height);
        const contenu = await decoderImageQr(c);
        if (contenu) lu(contenu);
      }
      // Arrêtée entre-temps : ne pas relancer la boucle.
      if (flux.current) boucle.current = requestAnimationFrame(() => void tick());
    };
    boucle.current = requestAnimationFrame(() => void tick());
  };

  const demarrer = async (): Promise<void> => {
    setEtat('demande');
    setErreur(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      });
      flux.current = stream;
      if (video.current) {
        video.current.srcObject = stream;
        await video.current.play();
      }
      setEtat('active');
      lireImages();
    } catch (err) {
      setEtat('refusee');
      setErreur(
        err instanceof Error && err.name === 'NotAllowedError'
          ? 'Accès à la caméra refusé. Autorisez-le dans le navigateur, ou utilisez une douchette.'
          : 'Caméra indisponible sur cet appareil. Utilisez une douchette ou la saisie manuelle.',
      );
    }
  };

  return (
    <div className="scan-camera">
      {etat === 'inactive' && (
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => void demarrer()}>
          <Camera className="ic" aria-hidden /> Utiliser la caméra
        </button>
      )}
      {etat === 'demande' && <p className="hint">Autorisation de la caméra…</p>}
      {etat === 'refusee' && <p className="hint scan-alerte">{erreur}</p>}
      <video
        ref={video}
        className={etat === 'active' ? 'scan-video' : 'scan-video scan-video-off'}
        muted
        playsInline
      />
      <canvas ref={canvas} className="scan-canvas" />
      {etat === 'active' && (
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => {
            arreter();
            setEtat('inactive');
          }}
        >
          <Square className="ic" aria-hidden /> Arrêter la caméra
        </button>
      )}
    </div>
  );
}
