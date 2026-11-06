import type { HTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../../cn.js";
import { TEXT_ROLE_CLASS, TEXT_VARIANT, type TextVariant } from "./text-role.js";

export { TEXT_VARIANT, type TextVariant } from "./text-role.js";

export const TEXT_TONE = {
  DEFAULT: "default",
  MUTED: "muted",
} as const;

export type TextTone = (typeof TEXT_TONE)[keyof typeof TEXT_TONE];

export const TEXT_FONT = {
  SANS: "sans",
  MONO: "mono",
} as const;

export type TextFont = (typeof TEXT_FONT)[keyof typeof TEXT_FONT];

export const TEXT_TRUNCATE = {
  START: "start",
} as const;

export type TextTruncate = (typeof TEXT_TRUNCATE)[keyof typeof TEXT_TRUNCATE];

export const TEXT_ELEMENT = {
  P: "p",
  SPAN: "span",
  DIV: "div",
  H1: "h1",
  H2: "h2",
  H3: "h3",
  H4: "h4",
  H5: "h5",
  H6: "h6",
} as const;

export type TextElement = (typeof TEXT_ELEMENT)[keyof typeof TEXT_ELEMENT];

const TEXT_BASE =
  "ui-text m-0 wrap-anywhere data-[tone=muted]:text-muted-foreground data-[font=mono]:font-mono";

function roleClass(variant: TextVariant): string {
  if (variant === TEXT_VARIANT.INHERIT) return "[font:inherit] text-inherit";
  const ink = variant === TEXT_VARIANT.GROUP ? "text-muted-foreground" : "text-foreground";
  return `${TEXT_ROLE_CLASS[variant]} font-ui ${ink}`;
}

function truncateClass(truncate: boolean | TextTruncate): string | undefined {
  if (truncate === false) return undefined;
  const cut = "min-w-0 overflow-clip text-ellipsis whitespace-nowrap";
  return truncate === TEXT_TRUNCATE.START ? `${cut} [direction:rtl] text-left` : cut;
}

export function Text({
  variant = TEXT_VARIANT.BODY,
  as: Element = TEXT_ELEMENT.P,
  tone = TEXT_TONE.DEFAULT,
  font = TEXT_FONT.SANS,
  truncate = false,
  id,
  className,
  ref,
  children,
  ...attributes
}: {
  variant?: TextVariant;
  as?: TextElement;
  tone?: TextTone;
  font?: TextFont;
  truncate?: boolean | TextTruncate;
  id?: string | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
} & Omit<HTMLAttributes<HTMLElement>, "children" | "className" | "id">): React.JSX.Element {
  return (
    <Element
      {...attributes}
      ref={ref as Ref<HTMLDivElement> | undefined}
      className={cn(TEXT_BASE, roleClass(variant), truncateClass(truncate), className)}
      data-variant={variant}
      data-tone={tone}
      data-font={font}
      data-truncate={
        truncate === TEXT_TRUNCATE.START ? TEXT_TRUNCATE.START : truncate ? "" : undefined
      }
      id={id}
    >
      {children}
    </Element>
  );
}
