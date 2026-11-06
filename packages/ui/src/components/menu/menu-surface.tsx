import { createElement } from "react";
import { cn } from "../../cn.js";
import { REPLAY_MASKED } from "../../session-replay-marks.js";
import { DROPDOWN_MENU_SURFACE } from "../../shadcn/dropdown-menu.js";

export const MENU_SURFACE_INSET = {
  MENU: "menu",
  NONE: "none",
} as const;

export type MenuSurfaceInset = (typeof MENU_SURFACE_INSET)[keyof typeof MENU_SURFACE_INSET];

export const MENU_SURFACE_FLOW = {
  COLUMN: "column",
  ROW: "row",
  TOOLBAR: "toolbar",
} as const;

export type MenuSurfaceFlow = (typeof MENU_SURFACE_FLOW)[keyof typeof MENU_SURFACE_FLOW];

export const MENU_SURFACE_ELEMENT = {
  DIV: "div",
  SPAN: "span",
} as const;

export type MenuSurfaceElement = (typeof MENU_SURFACE_ELEMENT)[keyof typeof MENU_SURFACE_ELEMENT];

export function MenuSurface({
  as: Element = MENU_SURFACE_ELEMENT.DIV,
  className,
  inset = MENU_SURFACE_INSET.MENU,
  flow = MENU_SURFACE_FLOW.COLUMN,
  placed,
  leaving = false,
  children,
  ...rest
}: Omit<React.ComponentPropsWithRef<"div">, "className" | "inert"> & {
  as?: MenuSurfaceElement | undefined;
  className?: string | undefined;
  inset?: MenuSurfaceInset | undefined;
  flow?: MenuSurfaceFlow | undefined;
  placed?: boolean | undefined;
  leaving?: boolean | undefined;
}): React.JSX.Element {
  return createElement(
    Element,
    {
      ...rest,
      className: cn(
        "ui-menu-surface",
        DROPDOWN_MENU_SURFACE,
        inset === MENU_SURFACE_INSET.NONE && "p-[0]",
        flow !== MENU_SURFACE_FLOW.COLUMN && "flex-row items-center gap-ui-2",
        flow === MENU_SURFACE_FLOW.TOOLBAR && "w-max rounded-menu-toolbar p-ui-2 whitespace-nowrap",
        flow === MENU_SURFACE_FLOW.TOOLBAR && !leaving && "animate-none",
        className,
      ),
      "data-inset": inset,
      "data-flow": flow === MENU_SURFACE_FLOW.COLUMN ? undefined : flow,
      "data-placed": placed === undefined ? undefined : String(placed),
      "data-leaving": leaving ? "true" : undefined,
      inert: leaving,
    },
    children,
  );
}

export function MenuGlyph({
  masked = false,
  children,
}: {
  masked?: boolean | undefined;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <span
      {...(masked ? REPLAY_MASKED : undefined)}
      className="ui-menu-item-glyph inline-flex size-menu-glyph flex-none items-center justify-center text-muted-foreground group-data-[variant=destructive]/menu-item:text-inherit [&_svg]:size-menu-glyph [&_svg]:flex-none [&>img]:size-menu-glyph [&>img]:flex-none"
    >
      {children}
    </span>
  );
}
