import { useEffect, useRef, type RefObject } from 'react';

/** Un élément qui reçoit déjà la frappe : on ne la lui vole pas. */
function estEditable(el: Element | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['button', 'checkbox', 'radio', 'submit', 'reset', 'file', 'range', 'color'].includes(
      el.type,
    );
  }
  return false;
}

/**
 * Ramène la frappe d'une douchette vers son champ quand il a perdu le focus.
 *
 * Une douchette USB ou Bluetooth n'est qu'un clavier : elle « tape » le
 * contenu du QR puis Entrée, là où se trouve le focus. Un clic sur
 * « Retirer » ou « Utiliser la caméra » suffit à le déplacer, et la licence
 * suivante part alors dans le vide — sans que la table de marque, les yeux
 * sur la file, s'en aperçoive.
 *
 * Quand un caractère est frappé hors de tout champ de saisie, on remet le
 * focus sur le champ et on y reporte ce premier caractère ; la suite de la
 * rafale, Entrée comprise, y arrive d'elle-même. Rien n'est capté quand un
 * autre champ est en cours de saisie, ni quand une modale qui ne contient pas
 * le champ est ouverte par-dessus, ni pour les raccourcis (Ctrl, Alt, ⌘) et
 * l'espace, qui actionne le bouton qui a le focus.
 *
 * `ajouter` reçoit le premier caractère : le champ est contrôlé par React,
 * c'est à son état qu'il faut l'ajouter.
 */
export function useCaptureDouchette(
  champ: RefObject<HTMLInputElement>,
  ajouter: (caractere: string) => void,
): void {
  const rappel = useRef(ajouter);
  rappel.current = ajouter;

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const cible = champ.current;
      if (!cible || cible.disabled || e.defaultPrevented) return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
      if (e.key.length !== 1 || e.key === ' ') return;
      const actif = document.activeElement;
      if (actif === cible || estEditable(actif)) return;
      const modales = document.querySelectorAll('[role="dialog"]');
      const dessus = modales[modales.length - 1];
      if (dessus && !dessus.contains(cible)) return;
      e.preventDefault();
      cible.focus();
      rappel.current(e.key);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [champ]);
}
