import { createElement, type HTMLAttributes, type ReactNode, type Ref } from "react";

export const PANE_PIN_ELEMENT = {
  ASIDE: "aside",
  DIV: "div",
} as const;

export type PanePinElement = (typeof PANE_PIN_ELEMENT)[keyof typeof PANE_PIN_ELEMENT];

export function PanePin({
  as: Element = PANE_PIN_ELEMENT.ASIDE,
  onPin,
  className,
  ref,
  children,
  ...rest
}: Omit<
  HTMLAttributes<HTMLElement>,
  "className" | "onClick" | "onPointerDown" | "onMouseDown" | "role"
> & {
  as?: PanePinElement;
  onPin: (() => void) | undefined;
  className?: string | undefined;
  ref?: Ref<HTMLElement> | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return createElement(
    Element,
    {
      ...rest,
      ref,
      className: className === undefined ? "ui-pane-pin" : `ui-pane-pin ${className}`,
      onPointerDown: onPin === undefined ? undefined : () => onPin(),
    },
    children,
  );
}
