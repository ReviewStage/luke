import { createElement } from "react";
import { cn } from "../../cn.js";
import { DROPDOWN_MENU_SURFACE } from "../../shadcn/dropdown-menu.js";

/**
 * menu-surface.tsx -- the menu's surface for a list an app hangs itself: its ground, edge, corner, shadow, inset, entrance, and exit, with the owner's place and keys.
 *
 * `Menu` draws this surface for a list of actions it keys itself, and
 * `PopoverPanel` for a dialog hung from its button. A list whose keys stay
 * somewhere else stands on it too: a searchable menu keyed from its field,
 * the `@` and `/` lists keyed from the editor they were typed in, a crumb's
 * tree, and a toolbar floated over a message, a picture, or selected code.
 * The owner places it
 * and keys it; the surface draws it the way every menu is drawn. It stays
 * hidden for the one layout pass that measures where it fits, where its
 * owner says it is not placed yet, and while its owner holds it drawn
 * through its exit it fades, inert, taking no press. It wears the menu's
 * own surface classes (`../../shadcn/dropdown-menu.tsx`).
 */

/** How far the surface's edge stands from what it holds: a menu's inset, or none for content that carries its own, as a searchable menu's field and lists do. */
export const MENU_SURFACE_INSET = {
  MENU: "menu",
  NONE: "none",
} as const;

export type MenuSurfaceInset = (typeof MENU_SURFACE_INSET)[keyof typeof MENU_SURFACE_INSET];

/**
 * Which way the surface lays what it holds: a menu's rows one under another;
 * a bar's field and buttons one beside another; or a toolbar floated over
 * what it acts on, its buttons a hair from its edge at a control's corner,
 * shown and hidden by its owner rather than arriving as a menu opens.
 */
export const MENU_SURFACE_FLOW = {
  COLUMN: "column",
  ROW: "row",
  TOOLBAR: "toolbar",
} as const;

export type MenuSurfaceFlow = (typeof MENU_SURFACE_FLOW)[keyof typeof MENU_SURFACE_FLOW];

/** The elements a surface may be: a box, or a span where it hangs in running words, as a picture's tools hang in a paragraph. */
export const MENU_SURFACE_ELEMENT = {
  DIV: "div",
  SPAN: "span",
} as const;

export type MenuSurfaceElement = (typeof MENU_SURFACE_ELEMENT)[keyof typeof MENU_SURFACE_ELEMENT];

/** The surface itself, a box its owner places by its own class and keys by its own handlers. */
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
  /** The owner's own class, which places it and sets its width and nothing of its look. */
  className?: string | undefined;
  inset?: MenuSurfaceInset | undefined;
  flow?: MenuSurfaceFlow | undefined;
  /** Whether it has been measured into place; hidden while false, drawn at once where the owner measures nothing. */
  placed?: boolean | undefined;
  /** It is on its way out: fading, inert, and taking nothing. */
  leaving?: boolean | undefined;
}): React.JSX.Element {
  // Note that the element is made rather than written, because a ref typed
  // for a div is no ref for a span.
  return createElement(
    Element,
    {
      ...rest,
      className: cn(
        "luke-menu-surface",
        DROPDOWN_MENU_SURFACE,
        inset === MENU_SURFACE_INSET.NONE && "p-[0]",
        flow !== MENU_SURFACE_FLOW.COLUMN && "flex-row items-center gap-luke-2",
        // A toolbar's buttons stand a hair from its edge, its corner a row's round that hair out, and it has no entrance of its own, since its owner shows it as the pointer or a selection comes.
        flow === MENU_SURFACE_FLOW.TOOLBAR &&
          "w-max rounded-menu-toolbar p-luke-2 whitespace-nowrap",
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

/** A glyph in a menu row's column, muted beside the words it leads, as a crumb heading a menu's narrowed list leads with its kind's mark. */
export function MenuGlyph({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <span className="luke-menu-item-glyph inline-flex size-menu-glyph flex-none items-center justify-center text-muted-foreground group-data-[variant=destructive]/menu-item:text-inherit [&_svg]:size-menu-glyph [&_svg]:flex-none [&>img]:size-menu-glyph [&>img]:flex-none">
      {children}
    </span>
  );
}
