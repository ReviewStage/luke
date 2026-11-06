const SCRIM =
  "ui-drawer-scrim pointer-events-none absolute inset-0 z-1 bg-scrim opacity-0 transition-opacity duration-(--ui-duration-pane) ease-pane data-[open=true]:opacity-100 [[data-ui-drawer-drag]>&]:opacity-[var(--ui-drawer-progress,0)] [[data-ui-drawer-drag]>&]:transition-none";

export function DrawerScrim({ open }: { open: boolean }): React.JSX.Element {
  return <div className={SCRIM} data-open={String(open)} aria-hidden="true" />;
}
