import { createElement, type HTMLAttributes, type ReactNode, type Ref } from "react";

export const COMPOSER_LOOK = {
  CARD: "card",
  FIELD: "field",
  INPUT: "input",
  BARE: "bare",
} as const;

export type ComposerLook = (typeof COMPOSER_LOOK)[keyof typeof COMPOSER_LOOK];

export const COMPOSER_ELEMENT = {
  FORM: "form",
  DIV: "div",
} as const;

export type ComposerElement = (typeof COMPOSER_ELEMENT)[keyof typeof COMPOSER_ELEMENT];

const LOOK_CLASS: Record<ComposerLook, string> = {
  [COMPOSER_LOOK.CARD]: "rounded-dialog border border-border bg-surface shadow-composer",
  [COMPOSER_LOOK.FIELD]: "rounded-control border border-border bg-ground",
  [COMPOSER_LOOK.INPUT]:
    "rounded-control border border-border-strong bg-field transition-[background-color] duration-(--ui-duration-hover) ease-motion-exit focus-within:bg-field-focus",
  [COMPOSER_LOOK.BARE]: "rounded-dialog border-0 bg-transparent",
};

const DROPPING = "data-[dropping=true]:border-border-selected";

export function ComposerFrame({
  as: Element = COMPOSER_ELEMENT.DIV,
  look = COMPOSER_LOOK.CARD,
  dropping = false,
  className,
  ref,
  children,
  ...rest
}: Omit<HTMLAttributes<HTMLElement>, "className" | "children"> & {
  as?: ComposerElement;
  look?: ComposerLook;
  dropping?: boolean | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
  children: ReactNode;
}): React.JSX.Element {
  return createElement(
    Element,
    {
      ...rest,
      ref,
      className: ["ui-composer-frame group/composer", LOOK_CLASS[look], DROPPING, className ?? ""]
        .filter((part) => part !== "")
        .join(" "),
      noValidate: Element === COMPOSER_ELEMENT.FORM ? true : undefined,
      "data-look": look,
      "data-dropping": dropping ? "true" : undefined,
    },
    children,
  );
}
