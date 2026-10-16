/**
 * modal-shell.tsx -- every modal's frame over the window, which is `@luke/ui`'s shared `Dialog`.
 *
 * The window's dialogs still hand the card a class and `data-` attributes of
 * their own for their screen's room, so they reach the shared dialog through
 * the compatibility door, the same dialog with a class beside its own; each
 * moves onto the barrel's when its screen is migrated.
 */

export { DIALOG_ROLE as MODAL_ROLE } from "@luke/ui";
export { CompatDialog as ModalShell } from "@luke/ui/compat";
