import type { HTMLAttributes, ReactNode, Ref } from "react";
import { Card as ShadcnCard } from "../../shadcn/card.js";
import { TEXT_ELEMENT, TEXT_VARIANT, Text } from "../text/text.js";

export const CARD_PADDING = {
  FLUSH: "flush",
  NONE: "none",
  SNUG: "snug",
  COMPACT: "compact",
  REGULAR: "regular",
} as const;

export type CardPadding = (typeof CARD_PADDING)[keyof typeof CARD_PADDING];

export const CARD_LOOK = {
  SURFACE: "surface",
  RAISED: "raised",
  TINT: "tint",
  CODE: "code",
  OUTLINE: "outline",
  WELL: "well",
} as const;

export type CardLook = (typeof CARD_LOOK)[keyof typeof CARD_LOOK];

export const CARD_CORNER = {
  CARD: "card",
  CONTROL: "control",
  MENU: "menu",
} as const;

export type CardCorner = (typeof CARD_CORNER)[keyof typeof CARD_CORNER];

export const CARD_ELEMENT = {
  DIV: "div",
  ARTICLE: "article",
  FIGURE: "figure",
  LI: "li",
  SECTION: "section",
  SPAN: "span",
} as const;

export type CardElement = (typeof CARD_ELEMENT)[keyof typeof CARD_ELEMENT];

export const CARD_SHADOW = {
  NONE: "none",
  SOFT: "soft",
  MENU: "menu",
} as const;

export type CardShadow = (typeof CARD_SHADOW)[keyof typeof CARD_SHADOW];

export const CARD_HOVER = {
  NONE: "none",
  WASH: "wash",
  LIFT: "lift",
} as const;

export type CardHover = (typeof CARD_HOVER)[keyof typeof CARD_HOVER];

export const CARD_DROP_TARGET = "data-drop-target";

const PADDING_CLASS: Record<CardPadding, string> = {
  [CARD_PADDING.FLUSH]: "p-0",
  [CARD_PADDING.NONE]: "p-0",
  [CARD_PADDING.SNUG]: "px-card py-card-snug",
  [CARD_PADDING.COMPACT]: "px-card py-card-compact",
  [CARD_PADDING.REGULAR]: "p-card",
};

const LOOK_CLASS: Record<CardLook, string> = {
  [CARD_LOOK.SURFACE]: "bg-card-surface border-border",
  [CARD_LOOK.RAISED]: "bg-background border-border-strong",
  [CARD_LOOK.TINT]: "bg-muted border-border",
  [CARD_LOOK.CODE]: "bg-card-code border-border",
  [CARD_LOOK.OUTLINE]: "bg-transparent border-border",
  [CARD_LOOK.WELL]: "bg-well border-transparent",
};

const SHADOW_CLASS: Record<CardShadow, string> = {
  [CARD_SHADOW.NONE]: "",
  [CARD_SHADOW.SOFT]: "shadow-card-soft",
  [CARD_SHADOW.MENU]: "shadow-menu",
};

const HOVER_CLASS: Record<CardHover, string> = {
  [CARD_HOVER.NONE]: "",
  [CARD_HOVER.WASH]:
    "hover:bg-[linear-gradient(var(--color-muted),var(--color-muted))] data-[lit=true]:bg-[linear-gradient(var(--color-muted),var(--color-muted))]",
  [CARD_HOVER.LIFT]:
    "hover:not-data-[drop-target=true]:border-border-strong data-[lit=true]:not-data-[drop-target=true]:border-border-strong hover:shadow-card-lift data-[lit=true]:shadow-card-lift",
};

const DROP_TARGET_CLASS =
  "data-[drop-target=true]:border-card-drop data-[drop-target=true]:bg-[linear-gradient(var(--color-muted),var(--color-muted))]";

function cornerClass(look: CardLook, corner: CardCorner): string {
  if (corner === CARD_CORNER.MENU) return "rounded-menu";
  if (look === CARD_LOOK.RAISED) return "rounded-card-raised";
  return corner === CARD_CORNER.CONTROL ? "rounded-control" : "rounded-card";
}

function overflowClass(look: CardLook, padding: CardPadding): string {
  if (look === CARD_LOOK.RAISED) return "overflow-visible";
  if (padding !== CARD_PADDING.FLUSH) return "";
  return "overflow-clip [--ui-focus-ring-offset:var(--ui-focus-ring-inset)]";
}

function transitionClass(look: CardLook, hover: CardHover): string {
  if (look !== CARD_LOOK.WELL || hover === CARD_HOVER.LIFT) return "";
  return "transition-[border-color] duration-(--ui-duration-hover) ease-plain";
}

function frameClass(
  look: CardLook,
  corner: CardCorner,
  padding: CardPadding,
  shadow: CardShadow,
  hover: CardHover,
  dashed: boolean,
  className: string | undefined,
): string {
  return [
    "ui-card",
    LOOK_CLASS[look],
    cornerClass(look, corner),
    PADDING_CLASS[padding],
    overflowClass(look, padding),
    dashed ? "border-dashed" : "",
    SHADOW_CLASS[shadow],
    HOVER_CLASS[hover],
    DROP_TARGET_CLASS,
    transitionClass(look, hover),
    className ?? "",
  ]
    .filter((part) => part !== "")
    .join(" ");
}

export function Card({
  as: Element = CARD_ELEMENT.DIV,
  look = CARD_LOOK.SURFACE,
  corner = CARD_CORNER.CARD,
  padding = CARD_PADDING.REGULAR,
  shadow = CARD_SHADOW.NONE,
  hover = CARD_HOVER.NONE,
  lit = false,
  dashed = false,
  className,
  ref,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, "className" | "children"> & {
  as?: CardElement;
  look?: CardLook;
  corner?: CardCorner;
  padding?: CardPadding;
  shadow?: CardShadow;
  hover?: CardHover;
  lit?: boolean | undefined;
  dashed?: boolean | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return (
    <ShadcnCard
      {...rest}
      as={Element}
      ref={ref}
      className={frameClass(look, corner, padding, shadow, hover, dashed, className)}
      data-look={look}
      data-corner={corner}
      data-padding={padding}
      data-shadow={shadow === CARD_SHADOW.NONE ? undefined : shadow}
      data-hover={hover === CARD_HOVER.NONE ? undefined : hover}
      data-lit={lit ? "true" : undefined}
      data-dashed={dashed ? "true" : undefined}
    >
      {children}
    </ShadcnCard>
  );
}

export function CardHead({ children }: { children: ReactNode }): React.JSX.Element {
  return (
    <Text
      as={TEXT_ELEMENT.DIV}
      variant={TEXT_VARIANT.GROUP}
      className="ui-card-head flex min-h-control min-w-0 flex-wrap items-center justify-between gap-x-card-head-gap gap-y-card-head-block px-card-head-inline py-card-head-block"
    >
      {children}
    </Text>
  );
}
