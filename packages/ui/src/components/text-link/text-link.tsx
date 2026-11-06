import type { FocusEventHandler, MouseEvent, PointerEventHandler, ReactNode } from "react";
import { ArrowUpRightIcon } from "../../face/glyphs.js";
import { PRESS_PULSE, pulseOnPress } from "../../press-pulse.js";
import { TEXT_FONT, type TextFont } from "../text/text.js";
import { TEXT_ROLE_CLASS, TEXT_VARIANT, type TextVariant } from "../text/text-role.js";
import { TEXT_LINK_LOOK, type TextLinkLook } from "./text-link-look.js";

export { TEXT_LINK_LOOK, type TextLinkLook } from "./text-link-look.js";

export const TEXT_LINK_HEIGHT = {
  TEXT: "text",
  CONTROL: "control",
} as const;

export type TextLinkHeight = (typeof TEXT_LINK_HEIGHT)[keyof typeof TEXT_LINK_HEIGHT];

export const TEXT_LINK_CURRENT = {
  PAGE: "page",
  SECTION: "true",
} as const;

export type TextLinkCurrent = (typeof TEXT_LINK_CURRENT)[keyof typeof TEXT_LINK_CURRENT];

const LINK_BASE =
  "ui-text-link group/text-link rounded-text-link wrap-anywhere transition-[color,text-decoration-color] duration-(--ui-duration-hover) ease-motion-exit";

const LOOK_CLASS = {
  [TEXT_LINK_LOOK.QUIET]: {
    rest: "text-muted-foreground no-underline",
    lit: "hover:text-foreground [&[aria-current]]:text-foreground",
  },
  [TEXT_LINK_LOOK.UNDERLINED]: {
    rest: "text-inherit underline decoration-link-underline decoration-1 underline-offset-[0.24em] hover:decoration-current focus-visible:decoration-current",
    lit: "",
  },
  [TEXT_LINK_LOOK.HEADING]: {
    rest: "text-foreground no-underline",
    lit: "hover:text-accent-ink",
  },
} as const satisfies Record<TextLinkLook, { rest: string; lit: string }>;

const FONT_CLASS = {
  [TEXT_FONT.SANS]: "font-ui",
  [TEXT_FONT.MONO]: "font-mono",
} as const satisfies Record<TextFont, string>;

const CONTROL_HEIGHT = "inline-flex items-center min-h-control";

function linkClass(
  look: TextLinkLook,
  variant: TextVariant | undefined,
  font: TextFont | undefined,
  height: TextLinkHeight,
  linked: boolean,
): string {
  const { rest, lit } = LOOK_CLASS[look];
  return [
    LINK_BASE,
    rest,
    linked ? `cursor-link in-[[contenteditable]]:cursor-text ${lit}` : undefined,
    font === undefined ? undefined : FONT_CLASS[font],
    height === TEXT_LINK_HEIGHT.CONTROL ? CONTROL_HEIGHT : undefined,
    variant === undefined || variant === TEXT_VARIANT.INHERIT
      ? undefined
      : TEXT_ROLE_CLASS[variant],
  ]
    .filter((part) => part !== undefined && part !== "")
    .join(" ");
}

export const TEXT_LINK_MARK_CLASS = linkClass(
  TEXT_LINK_LOOK.UNDERLINED,
  undefined,
  undefined,
  TEXT_LINK_HEIGHT.TEXT,
  true,
);

const LEAD = "ui-text-link-lead me-icon-gap inline-flex align-[-0.1em]";

const OUT_HELD = "ui-text-link-out-held whitespace-nowrap";

function outWords(children: ReactNode): ReactNode {
  if (typeof children !== "string" || children === "") {
    return (
      <>
        {children}
        <ArrowUpRightIcon />
      </>
    );
  }
  const letters = Array.from(children);
  const last = letters.pop();
  return (
    <>
      {letters.join("")}
      <span className={OUT_HELD}>
        {last}
        <ArrowUpRightIcon />
      </span>
    </>
  );
}

type HintProps = {
  onPointerEnter?: PointerEventHandler<HTMLElement> | undefined;
  onPointerLeave?: PointerEventHandler<HTMLElement> | undefined;
  onPointerDown?: PointerEventHandler<HTMLElement> | undefined;
  onFocus?: FocusEventHandler<HTMLElement> | undefined;
  onBlur?: FocusEventHandler<HTMLElement> | undefined;
  "aria-describedby"?: string | undefined;
};

export function TextLink({
  href,
  look = TEXT_LINK_LOOK.QUIET,
  variant,
  font,
  height = TEXT_LINK_HEIGHT.TEXT,
  current,
  external = false,
  newTab = false,
  lead,
  onClick,
  children,
  ...hint
}: HintProps & {
  href: string | undefined;
  look?: TextLinkLook;
  variant?: TextVariant | undefined;
  font?: TextFont | undefined;
  height?: TextLinkHeight;
  current?: TextLinkCurrent | undefined;
  external?: boolean;
  newTab?: boolean;
  lead?: React.JSX.Element | undefined;
  onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const words = (
    <>
      {lead === undefined ? null : <span className={LEAD}>{lead}</span>}
      {external ? outWords(children) : children}
    </>
  );
  const face = {
    "data-look": look,
    "data-variant": variant,
    "data-font": font,
    "data-height": height,
  };
  if (href === undefined) {
    return (
      <span className={linkClass(look, variant, font, height, false)} {...face} {...hint}>
        {words}
      </span>
    );
  }
  return (
    <a
      className={linkClass(look, variant, font, height, true)}
      {...face}
      {...hint}
      href={href}
      aria-current={current}
      target={newTab ? "_blank" : undefined}
      rel={newTab ? "noreferrer" : undefined}
      onClick={pulseOnPress(onClick, PRESS_PULSE.WORDS)}
    >
      {words}
    </a>
  );
}
