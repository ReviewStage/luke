/**
 * drawer-scrim.tsx -- the dimmed window under a phone's drawer: it darkens as the drawer opens and clears as it shuts, and while a finger swipes the drawer it is as dark as the drawer is open (`use-drawer-swipe.ts`).
 *
 * It takes no press and speaks as nothing: the drawer's owner already puts
 * the drawer away on a press outside it, and keeps the work under it out of
 * reach while it stands. It covers its stage edge to edge, over the stage's
 * own flow and under a drawer standing on the layer above.
 */
/**
 * The scrim fades in and out with the drawer, on the pane's own beat, since
 * the drawer is a pane and travels on it (docs/DESIGN.md); while a finger
 * swipes the drawer it stands at the share open the swipe writes on its
 * stage and plays nothing, so it follows the finger.
 */
const SCRIM =
  "luke-drawer-scrim pointer-events-none absolute inset-0 z-1 bg-scrim opacity-0 transition-opacity duration-(--luke-duration-pane) ease-pane data-[open=true]:opacity-100 [[data-luke-drawer-drag]>&]:opacity-[var(--luke-drawer-progress,0)] [[data-luke-drawer-drag]>&]:transition-none";

export function DrawerScrim({ open }: { open: boolean }): React.JSX.Element {
  return <div className={SCRIM} data-open={String(open)} aria-hidden="true" />;
}
