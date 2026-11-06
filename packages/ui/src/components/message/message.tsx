import { type HTMLAttributes, type ReactNode, useState } from "react";

const OWN_CONTROL =
  "a, button, summary, input, textarea, select, label, [role='button'], [role='tab']";

const NO_HOVER = "(hover: none)";

const FRAME = "ui-message group/message";

const ACTIONS =
  "ui-message-actions pointer-events-none flex flex-none items-center gap-ui-2 pointer-coarse:gap-ui-20 opacity-0 transition-opacity duration-(--ui-duration-hover) ease-motion-exit focus-within:pointer-events-auto focus-within:opacity-100 has-[[aria-describedby]]:pointer-events-auto has-[[aria-describedby]]:opacity-100 group-hover/message:pointer-events-auto group-hover/message:opacity-100 no-hover:group-data-[actions-shown=true]/message:pointer-events-auto no-hover:group-data-[actions-shown=true]/message:opacity-100";

export function MessageFrame({
  revealActionsOnTap = false,
  className,
  ...props
}: Omit<HTMLAttributes<HTMLDivElement>, "className" | "onClick"> & {
  revealActionsOnTap?: boolean;
  className?: string | undefined;
}): React.JSX.Element {
  const [actionsShown, setActionsShown] = useState(false);
  const tap = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.defaultPrevented) return;
    if (event.target instanceof Element && event.target.closest(OWN_CONTROL) !== null) return;
    if (window.getSelection()?.isCollapsed === false) return;
    if (!window.matchMedia(NO_HOVER).matches) return;
    setActionsShown((shown) => !shown);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a tap stands in for the hover a finger lacks; the keyboard reaches the actions themselves, which show while they hold it.
    // biome-ignore lint/a11y/useKeyWithClickEvents: as above, the keyboard needs no key here, since focusing an action shows the bar.
    <div
      {...props}
      className={className === undefined ? FRAME : `${FRAME} ${className}`}
      data-actions-shown={actionsShown ? "true" : undefined}
      onClick={revealActionsOnTap ? tap : undefined}
    />
  );
}

export function MessageActions({ children }: { children?: ReactNode }): React.JSX.Element {
  return <div className={ACTIONS}>{children}</div>;
}
