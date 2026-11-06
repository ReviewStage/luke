import type { MouseEvent, ReactNode, Ref } from "react";
import { PRESS_PULSE, pulsePress } from "../../press-pulse.js";

export const COMMAND_LINK_ELEMENT = {
  SPAN: "span",
  H2: "h2",
} as const;

export type CommandLinkElement = (typeof COMMAND_LINK_ELEMENT)[keyof typeof COMMAND_LINK_ELEMENT];

type DataAttributes = { readonly [name: `data-${string}`]: string | undefined };

export function CommandLink({
  as: Tag = COMMAND_LINK_ELEMENT.SPAN,
  className,
  ref,
  onOpen,
  children,
  ...data
}: DataAttributes & {
  as?: CommandLinkElement | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
  onOpen?: (() => void) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const open = (event: MouseEvent<HTMLElement>) => {
    if (onOpen === undefined || !(event.metaKey || event.ctrlKey)) return;
    if (event.target instanceof Element && event.target.closest("button") !== null) return;
    event.preventDefault();
    pulsePress(event.currentTarget, PRESS_PULSE.WORDS);
    onOpen();
  };
  return (
    // biome-ignore lint/a11y/useKeyWithClickEvents: the ⌘-click is a pointer's shortcut alone; the place offers the keyboard the same act elsewhere.
    // biome-ignore lint/a11y/noStaticElementInteractions: as above.
    <Tag
      {...data}
      ref={ref as Ref<HTMLHeadingElement & HTMLSpanElement>}
      className={className === undefined ? "ui-command-link" : `ui-command-link ${className}`}
      onClick={open}
    >
      {children}
    </Tag>
  );
}
