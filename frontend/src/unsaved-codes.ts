/**
 * Codes de récupération affichés une seule fois (P9-MFA-e) : tant qu'ils sont à l'écran, quitter
 * l'écran (changement d'onglet, fermeture de la page) demande une confirmation.
 */
let pending = false;

const onBeforeUnload = (event: BeforeUnloadEvent) => {
  event.preventDefault();
  event.returnValue = '';
};

export function setUnsavedCodes(value: boolean): void {
  if (value === pending) return;
  pending = value;
  if (value) window.addEventListener('beforeunload', onBeforeUnload);
  else window.removeEventListener('beforeunload', onBeforeUnload);
}

export function confirmLeaveUnsavedCodes(): boolean {
  return (
    !pending ||
    window.confirm(
      'Vos codes de récupération ne seront plus affichés. Quitter sans les avoir conservés ?',
    )
  );
}
