/**
 * drawer-scrim.tsx -- the dimmed window under a phone's drawer: it darkens as the drawer opens and clears as it shuts, and while a finger swipes the drawer it is as dark as the drawer is open (`use-drawer-swipe.ts`).
 *
 * It takes no press and speaks as nothing: the drawer's owner already puts
 * the drawer away on a press outside it, and keeps the work under it out of
 * reach while it stands. It covers its stage edge to edge, over the stage's
 * own flow and under a drawer standing on the layer above.
 */
export function DrawerScrim({ open }: { open: boolean }): React.JSX.Element {
  return <div className="luke-drawer-scrim" data-open={String(open)} aria-hidden="true" />;
}
