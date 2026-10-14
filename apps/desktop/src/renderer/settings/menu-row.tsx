import { EllipsisIcon } from "@sidecar/panel";
import { useRef } from "react";
import { ActionMenu, type MenuAction, useActionMenu } from "../desktop/action-menu";
import { searchAnchorProps } from "../settings-anchors";
import { Tooltip } from "../tooltip";

/**
 * menu-row.tsx -- a Settings row with actions of its own: a stored key, a connected service, a changeable shortcut.
 *
 * The row's acts live in the window's own menu rather than in buttons along
 * the row, the way a sidebar plan's do: a ⋯ at the row's end opens it, and a
 * right-click anywhere on the row opens the same menu at the pointer. The ⋯
 * is always drawn, muted as a toolbar's glyphs are until the pointer is on it,
 * because a ⋯ shown only on hover leaves an empty gap at the end of the row. A
 * row with no act that applies now draws no ⋯ and answers no right-click. An
 * act that cannot be taken back asks first through the confirm dialog, which
 * hands focus back to the ⋯ the menu returned it to.
 */
export function MenuRow({
  label,
  actions,
  heading,
  anchor,
  children,
}: {
  /** What the menu is named: "Linear actions". */
  label: string;
  actions: readonly MenuAction[];
  /** A muted line over the menu's acts saying what they act on, where the row's words do not. */
  heading?: string;
  /** The id a pressed search result lands on. */
  anchor?: string;
  /** The row's words, and any control standing before the ⋯. */
  children: React.ReactNode;
}): React.JSX.Element {
  // The page is drawn whenever the row is, so the menu needs no surface of
  // its own to close with: it closes with the row unmounting.
  const menu = useActionMenu(true);
  const ellipsis = useRef<HTMLButtonElement | null>(null);
  const acting = actions.length > 0;
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the right-click is a second door to the ⋯ beside it, which is the keyboard's. */}
      <div
        className="settings-row menu-row"
        {...(anchor ? searchAnchorProps(anchor) : undefined)}
        onContextMenu={acting ? menu.contextMenu(ellipsis) : undefined}
      >
        {children}
        {acting ? (
          <Tooltip label="More">
            <button
              ref={ellipsis}
              type="button"
              className="icon-button"
              aria-label={label}
              {...menu.trigger()}
            >
              <EllipsisIcon />
            </button>
          </Tooltip>
        ) : null}
      </div>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={label}
          menu={menu.drawn}
          groups={[actions]}
          {...(heading === undefined ? undefined : { heading })}
          onClose={menu.close}
        />
      )}
    </>
  );
}
