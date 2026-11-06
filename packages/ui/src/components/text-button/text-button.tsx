import { Button as ButtonPrimitive } from "@base-ui/react/button";
import type { ButtonHTMLAttributes, MouseEvent, ReactNode } from "react";
import { cn } from "../../cn.js";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { useLinkAddress } from "../menu/link-address.js";

export const TEXT_BUTTON_TONE = {
  QUIET: "quiet",
  ACCENT: "accent",
} as const;

export type TextButtonTone = (typeof TEXT_BUTTON_TONE)[keyof typeof TEXT_BUTTON_TONE];

type HintProps = Pick<
  ButtonHTMLAttributes<HTMLButtonElement>,
  | "onPointerEnter"
  | "onPointerLeave"
  | "onPointerDown"
  | "onFocus"
  | "onBlur"
  | "aria-describedby"
  | "aria-keyshortcuts"
>;

export const TEXT_BUTTON_LINES = {
  ONE: "one",
  TWO: "two",
  WHOLE: "whole",
} as const;

export type TextButtonLines = (typeof TEXT_BUTTON_LINES)[keyof typeof TEXT_BUTTON_LINES];

const TEXT =
  "ui-text-button align-baseline min-w-0 max-w-full m-0 p-0 [border:0] rounded-[2px] bg-transparent bg-none text-inherit [font:inherit] text-start text-ellipsis cursor-press transition-[color,text-decoration-color] duration-(--ui-duration-hover) ease-motion-exit [&_svg]:size-[0.8em] [&_svg]:ms-0.5 [&_svg]:align-[-0.05em]";

const TEXT_LINES = {
  one: "inline-block overflow-clip whitespace-nowrap",
  two: "[display:-webkit-inline-box] overflow-hidden wrap-anywhere whitespace-normal [-webkit-box-orient:vertical] [-webkit-line-clamp:2]",
  whole:
    "inline-block overflow-clip whitespace-nowrap pointer-coarse:relative pointer-coarse:overflow-visible pointer-coarse:before:absolute pointer-coarse:before:top-1/2 pointer-coarse:before:left-1/2 pointer-coarse:before:w-[max(100%,var(--ui-touch-target))] pointer-coarse:before:h-touch pointer-coarse:before:[transform:translate(-50%,-50%)] pointer-coarse:before:content-['']",
} as const satisfies Record<TextButtonLines, string>;

const UNDERLINE_ON_HOVER = "no-underline decoration-1 underline-offset-[0.24em]";

const TEXT_TONE = {
  quiet: `${UNDERLINE_ON_HOVER} hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline`,
  accent: `${UNDERLINE_ON_HOVER} text-accent-ink data-[tone=accent]:font-label hover:underline focus-visible:underline`,
} as const satisfies Record<TextButtonTone, string>;

function preventFocusMove(event: MouseEvent<HTMLButtonElement>): void {
  event.preventDefault();
}

export function TextButton({
  tone = TEXT_BUTTON_TONE.QUIET,
  lines = TEXT_BUTTON_LINES.ONE,
  onClick,
  keepFocus,
  id,
  linkHref,
  children,
  ...props
}: HintProps & {
  tone?: TextButtonTone;
  lines?: TextButtonLines;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  keepFocus?: boolean | undefined;
  id?: string | undefined;
  linkHref?: string | undefined;
  "aria-label"?: string | undefined;
  "aria-expanded"?: boolean | undefined;
  "aria-controls"?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const linkAddress = useLinkAddress(linkHref);
  return (
    <ButtonPrimitive
      type="button"
      className={cn(TEXT, TEXT_LINES[lines], TEXT_TONE[tone])}
      data-tone={tone}
      data-lines={lines}
      ref={linkAddress}
      id={id}
      aria-label={props["aria-label"]}
      aria-expanded={props["aria-expanded"]}
      aria-controls={props["aria-controls"]}
      aria-describedby={props["aria-describedby"]}
      aria-keyshortcuts={props["aria-keyshortcuts"]}
      onPointerEnter={props.onPointerEnter}
      onPointerLeave={props.onPointerLeave}
      onPointerDown={props.onPointerDown}
      onFocus={props.onFocus}
      onBlur={props.onBlur}
      onMouseDown={keepFocus === true ? preventFocusMove : undefined}
      onClick={pulseOnPress(onClick, PRESS_PULSE.WORDS)}
    >
      {children}
    </ButtonPrimitive>
  );
}
