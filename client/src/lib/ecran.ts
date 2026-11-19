import { useEffect, useState } from 'react';

/**
 * Largeur sous laquelle on parle de téléphone. Reprend la borne des feuilles de
 * style (`@media (max-width: 640px)`) : le rendu et la mise en page doivent
 * basculer ensemble.
 */
export const REQUETE_TELEPHONE = '(max-width: 640px)';

function correspond(requete: string): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia(requete).matches
    : false;
}

/** Suit une media query : vrai tant qu'elle correspond. */
export function useMediaQuery(requete: string): boolean {
  const [ok, setOk] = useState(() => correspond(requete));
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const mq = window.matchMedia(requete);
    const suivre = () => setOk(mq.matches);
    suivre();
    mq.addEventListener('change', suivre);
    return () => mq.removeEventListener('change', suivre);
  }, [requete]);
  return ok;
}

/** Vrai sur un écran de téléphone. */
export function useTelephone(): boolean {
  return useMediaQuery(REQUETE_TELEPHONE);
}
