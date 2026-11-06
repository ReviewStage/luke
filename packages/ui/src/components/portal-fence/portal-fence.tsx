import type { ReactNode, SyntheticEvent } from "react";

function stopped(event: SyntheticEvent): void {
  event.stopPropagation();
}

export function PortalFence({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: the fence takes nothing itself; it keeps what the controls it holds took from reaching the tree around it.
    <span
      className="ui-portal-fence contents"
      onClick={stopped}
      onKeyDown={stopped}
      onPointerDown={stopped}
      onMouseDown={stopped}
    >
      {children}
    </span>
  );
}
