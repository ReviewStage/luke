import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { cn } from "../../cn.js";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { useDisclosureState, useDisclosureSummaryClick } from "../disclosure/disclosure.js";

export const LINE_BUTTON_LOOK = {
  ROW: "row",
  QUOTE: "quote",
  BAND: "band",
} as const;

export type LineButtonLook = (typeof LINE_BUTTON_LOOK)[keyof typeof LINE_BUTTON_LOOK];

const LINE_LAYOUT = "flex w-full min-w-0 items-center gap-icon-gap [&>svg]:flex-none";

const LINE = `ui-line-button ${LINE_LAYOUT} m-0 p-0 [border:0] bg-transparent bg-none text-inherit [font:inherit] text-start list-none select-none cursor-press transition-[color,background-color,opacity] duration-(--ui-duration-hover) ease-motion-exit [&::-webkit-details-marker]:hidden`;

const ROW_BOX = "min-h-[28px] py-0.5 px-1 rounded-ui-6 text-muted-foreground";

const LINE_LOOK = {
  row: `${ROW_BOX} pointer-coarse:min-h-touch data-[look=row]:text-caption hover:not-active:bg-fill-strong active:bg-fill-pressed data-[brightens=true]:hover:text-foreground`,
  quote: "line-clamp-2 [line-clamp:2] wrap-anywhere hover:text-foreground active:opacity-70",
  band: "decoration-1 underline-offset-[0.24em] hover:bg-muted hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline active:bg-fill-pressed",
} as const satisfies Record<LineButtonLook, string>;

type HintProps = Pick<
  ButtonHTMLAttributes<HTMLElement>,
  | "onPointerEnter"
  | "onPointerLeave"
  | "onPointerDown"
  | "onTouchEnd"
  | "onFocus"
  | "onBlur"
  | "aria-describedby"
  | "aria-keyshortcuts"
>;

type DataMarks = { [mark: `data-${string}`]: string | undefined };

type LineBase = HintProps &
  DataMarks & {
    brightens?: boolean | undefined;
    children: ReactNode;
  };

export function LineButton({
  look = LINE_BUTTON_LOOK.ROW,
  brightens,
  onClick,
  id,
  children,
  ...props
}: LineBase & {
  look?: LineButtonLook;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  id?: string | undefined;
  "aria-label"?: string | undefined;
  "aria-expanded"?: boolean | undefined;
  "aria-controls"?: string | undefined;
}): React.JSX.Element {
  return (
    <ButtonPrimitive
      type="button"
      className={cn(LINE, LINE_LOOK[look])}
      data-look={look}
      data-brightens={brightens === true ? true : undefined}
      id={id}
      onClick={pulseOnPress(
        onClick,
        look === LINE_BUTTON_LOOK.BAND ? PRESS_PULSE.FLUSH : PRESS_PULSE.QUIET,
      )}
      {...props}
    >
      {children}
    </ButtonPrimitive>
  );
}

export function LineRow({
  children,
  ...props
}: DataMarks & {
  children: ReactNode;
}): React.JSX.Element {
  return (
    <div {...props} className={`ui-line-row ${LINE_LAYOUT} ${ROW_BOX} text-caption`}>
      {children}
    </div>
  );
}

export function LineSummary({
  brightens,
  onClick,
  children,
  ...props
}: LineBase & {
  onClick?: ((event: MouseEvent<HTMLElement>) => void) | undefined;
}): React.JSX.Element {
  const { open } = useDisclosureState();
  const toggle = useDisclosureSummaryClick();
  const click = (event: MouseEvent<HTMLElement>) => {
    onClick?.(event);
    toggle(event);
  };
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: a summary is the platform's own disclosure control, focusable and opened by Enter and Space; the click it already takes is routed to React's state.
    // biome-ignore lint/a11y/useAriaPropsSupportedByRole: a summary is exposed as its details' disclosure button, which takes aria-expanded; the rule's table gives the element no role.
    <summary
      className={cn(LINE, LINE_LOOK.row)}
      data-look={LINE_BUTTON_LOOK.ROW}
      data-brightens={brightens === true ? true : undefined}
      aria-expanded={open}
      {...props}
      onClick={click}
    >
      {children}
    </summary>
  );
}
