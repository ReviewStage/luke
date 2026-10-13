import { EllipsisIcon } from "@sidecar/panel";
import { useRef } from "react";
import {
  ActionMenu,
  atPointer,
  dropBelow,
  type MenuAction,
  useActionMenu,
} from "../desktop/action-menu";
import { searchAnchorProps } from "../settings-anchors";
import { Tooltip } from "../tooltip";

/**
 * menu-row.tsx -- a Settings row with actions of its own: a stored key, a connected service, a changeable shortcut.
 *
 * The row's acts live in the window's own menu rather than in buttons along
 * the row, the way a sidebar plan's do: a ⋯ at the row's end opens it, and a
 * right-click anywhere on the row opens the same menu at the pointer. The ⋯
 * is drawn while the row is hovered, holds the keyboard, or has its menu
 * open, and keeps its room otherwise, so the row never shifts as it shows. A
 * row with no act that applies now draws no ⋯ and answers no right-click. An
 * act that cannot be taken back asks first through the confirm dialog, which
 * hands focus back to the ⋯ the menu returned it to.
 */
export function MenuRow({
  label,
  actions,
  anchor,
  children,
}: {
  /** What the menu is named: "Linear actions". */
  label: string;
  actions: readonly MenuAction[];
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
        data-menu-open={String(menu.open !== undefined)}
        {...(anchor ? searchAnchorProps(anchor) : undefined)}
        onContextMenu={(event) => {
          if (!acting) return;
          event.preventDefault();
          menu.show(atPointer(event), ellipsis.current ?? event.currentTarget);
        }}
      >
        {children}
        {acting ? (
          <Tooltip label="More">
            <button
              ref={ellipsis}
              type="button"
              className="icon-button menu-row-more"
              aria-label={label}
              aria-haspopup="menu"
              aria-expanded={menu.open !== undefined}
              onClick={(event) => {
                if (menu.open !== undefined) {
                  menu.close(true);
                  return;
                }
                menu.show(dropBelow(event.currentTarget), event.currentTarget);
              }}
            >
              <EllipsisIcon />
            </button>
          </Tooltip>
        ) : null}
      </div>
      {menu.drawn === undefined ? null : (
        <ActionMenu label={label} menu={menu.drawn} groups={[actions]} onClose={menu.close} />
      )}
    </>
  );
}
