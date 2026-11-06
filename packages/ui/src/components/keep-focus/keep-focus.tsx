import { createElement, type HTMLAttributes, type MouseEvent, type ReactNode } from "react";

function keepFocus(event: MouseEvent<HTMLElement>): void {
  event.preventDefault();
}

export function KeepFocus({
  className,
  children,
  ...rest
}: Omit<
  HTMLAttributes<HTMLDivElement>,
  "className" | "onClick" | "onPointerDown" | "onMouseDown" | "role"
> & {
  className?: string | undefined;
  children?: ReactNode;
}): React.JSX.Element {
  return createElement(
    "div",
    {
      ...rest,
      className: className === undefined ? "ui-keep-focus" : `ui-keep-focus ${className}`,
      onMouseDown: keepFocus,
    },
    children,
  );
}
