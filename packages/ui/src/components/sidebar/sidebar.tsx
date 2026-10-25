import type { ReactNode, Ref } from "react";

/**
 * sidebar.tsx -- the parts of the app's sidebar every surface that draws it shares: the head naming whose it is, the places under it, the rule that parts them from a list, and the foot with the account's row.
 *
 * The panel's sidebar, Settings' page list, a version history's versions,
 * and the web's admin dashboard all stand these in the column the app's
 * shell lays (`@luke/panel`'s `shell.css`), so the four read as one product
 * from one set of boxes rather than copies of them. The column itself, its
 * ground, insets, width, and slide, stays the shell's, and so does what
 * each part holds.
 *
 * Each part keeps the class the window's own sheets and its tests know it
 * by (`sidebar-places`, `sidebar-foot`, `sidebar-account-row`), a placement
 * hook rather than a look: the account's row is the container the foot's
 * pills fold in (`@container sidebar-foot`), and a sheet may restage a part
 * by its hook. Each draws in Tailwind utilities over the shared theme and
 * takes no class or style of its own.
 */

/**
 * The head of the sidebar: a face on its tile beside a name, and under the
 * name, muted, where the head stands on a surface that is the name's own
 * but not the app itself (the admin dashboard's "Admin"). The face is the
 * caller's, which fills the tile's middle; `faceRef` is the tile, the box a
 * face's hover is read against, which outlives a face remounted to play.
 */
export function SidebarIdentity({
  name,
  qualifier,
  face,
  faceRef,
}: {
  name: string;
  qualifier?: string | undefined;
  /** The face, drawn to fill its seat (a `WingFace` with `fill`). */
  face: ReactNode;
  faceRef?: Ref<HTMLSpanElement> | undefined;
}): React.JSX.Element {
  return (
    <div className="sidebar-identity flex items-center gap-luke-12 px-row-inset pt-luke-2 pb-section-gap">
      <span
        ref={faceRef}
        className="grid size-luke-40 flex-none place-items-center rounded-luke-14 bg-fill-strong"
      >
        <span className="grid size-luke-24">{face}</span>
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-dialog-size font-dialog tracking-identity">{name}</span>
        {qualifier === undefined ? null : (
          <span className="text-caption-inline text-muted-foreground">{qualifier}</span>
        )}
      </span>
    </div>
  );
}

/**
 * The sidebar's places, each a `NavItem` a list's gap from the next, as the
 * rows under them are: a navigation landmark where it is named (`label`),
 * the admin's sections, and a plain column where its rows are commands.
 */
export function SidebarPlaces({
  label,
  children,
}: {
  /** The landmark's name, which makes it one; none leaves it a plain column. */
  label?: string | undefined;
  children: ReactNode;
}): React.JSX.Element {
  const className = "sidebar-places mb-list-gap flex flex-none flex-col gap-list-gap";
  return label === undefined ? (
    <div className={className}>{children}</div>
  ) : (
    <nav aria-label={label} className={className}>
      {children}
    </nav>
  );
}

/** The hairline under the places that parts them from the list, at the rows' inset. */
export function SidebarRule(): React.JSX.Element {
  return <hr className="sidebar-rule mx-row-inset my-luke-8 h-px flex-none border-0 bg-border" />;
}

/** The foot of the column: what docks above the account's row, and the row. */
export function SidebarFoot({ children }: { children?: ReactNode }): React.JSX.Element {
  return <div className="sidebar-foot flex flex-col pt-luke-8">{children}</div>;
}

/**
 * The foot's one row: the account at its start, taking what room is left,
 * and whatever stands after it. It is the container the foot's pills fold
 * in as the column narrows (`sidebar-foot`).
 */
export function SidebarAccountRow({ children }: { children?: ReactNode }): React.JSX.Element {
  return (
    <div className="sidebar-account-row @container/sidebar-foot flex items-center gap-luke-4">
      {children}
    </div>
  );
}
