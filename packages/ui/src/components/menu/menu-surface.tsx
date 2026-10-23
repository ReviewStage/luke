/**
 * menu-surface.tsx -- the menu's surface for a list an app hangs itself: its ground, edge, corner, shadow, inset, entrance, and exit, with the owner's place and keys.
 *
 * `Menu` draws this surface for a list of actions it keys itself, and
 * `PopoverPanel` for a dialog hung from its button. A list whose keys stay
 * somewhere else stands on it too: a searchable menu keyed from its field,
 * the `@` and `/` lists keyed from the editor they were typed in, a crumb's
 * tree, and the one press offered over selected words. The owner places it
 * and keys it; the surface draws it the way every menu is drawn. It stays
 * hidden for the one layout pass that measures where it fits, where its
 * owner says it is not placed yet, and while its owner holds it drawn
 * through its exit it fades, inert, taking no press.
 */

/** How far the surface's edge stands from what it holds: a menu's inset, or none for content that carries its own, as a searchable menu's field and lists do. */
export const MENU_SURFACE_INSET = {
  MENU: "menu",
  NONE: "none",
} as const;

export type MenuSurfaceInset = (typeof MENU_SURFACE_INSET)[keyof typeof MENU_SURFACE_INSET];

/** Which way the surface lays what it holds: a menu's rows one under another, or a bar's field and buttons one beside another. */
export const MENU_SURFACE_FLOW = {
  COLUMN: "column",
  ROW: "row",
} as const;

export type MenuSurfaceFlow = (typeof MENU_SURFACE_FLOW)[keyof typeof MENU_SURFACE_FLOW];

/** The surface itself, a box its owner places by its own class and keys by its own handlers. */
export function MenuSurface({
  className,
  inset = MENU_SURFACE_INSET.MENU,
  flow = MENU_SURFACE_FLOW.COLUMN,
  placed,
  leaving = false,
  children,
  ...rest
}: Omit<React.ComponentPropsWithRef<"div">, "className" | "inert"> & {
  /** The owner's own class, which places it and sets its width and nothing of its look. */
  className?: string | undefined;
  inset?: MenuSurfaceInset | undefined;
  flow?: MenuSurfaceFlow | undefined;
  /** Whether it has been measured into place; hidden while false, drawn at once where the owner measures nothing. */
  placed?: boolean | undefined;
  /** It is on its way out: fading, inert, and taking nothing. */
  leaving?: boolean | undefined;
}): React.JSX.Element {
  return (
    <div
      {...rest}
      className={className === undefined ? "luke-menu-surface" : `luke-menu-surface ${className}`}
      data-inset={inset}
      data-flow={flow === MENU_SURFACE_FLOW.ROW ? flow : undefined}
      data-placed={placed === undefined ? undefined : String(placed)}
      data-leaving={leaving ? "true" : undefined}
      inert={leaving}
    >
      {children}
    </div>
  );
}

/** A glyph in a menu row's column, muted beside the words it leads, as a crumb heading a menu's narrowed list leads with its kind's mark. */
export function MenuGlyph({ children }: { children: React.ReactNode }): React.JSX.Element {
  return <span className="luke-menu-item-glyph">{children}</span>;
}
