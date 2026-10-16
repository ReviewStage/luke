import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { EllipsisIcon } from "@luke/ui";
import { useRef } from "react";
import { ActionMenu, type MenuAction, useActionMenu } from "../desktop/action-menu";
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
 *
 * Its acts may come in groups, a rule between each.
 */

/** A row's acts: one list, or lists drawn with a rule between each. */
type MenuRowActions = readonly MenuAction[] | readonly (readonly MenuAction[])[];

/** Whether a row's acts came in groups rather than as one list. */
function grouped(actions: MenuRowActions): actions is readonly (readonly MenuAction[])[] {
  return actions.every((entry) => Array.isArray(entry));
}

/** The row's acts as the menu draws them: in groups, none of them empty. */
function groupsOf(actions: MenuRowActions): readonly (readonly MenuAction[])[] {
  const groups = grouped(actions) ? actions : [actions];
  return groups.filter((group) => group.length > 0);
}

export function MenuRow({
  label,
  actions,
  heading,
  anchor,
  children,
}: {
  /** What the menu is named: "Linear actions". */
  label: string;
  actions: MenuRowActions;
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
  const door = useRef<HTMLButtonElement | null>(null);
  const groups = groupsOf(actions);
  const acting = groups.length > 0;
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the right-click is a second door to the ⋯ beside it, which is the keyboard's. */}
      <div
        className="settings-row menu-row"
        {...(anchor ? searchAnchorProps(anchor) : undefined)}
        onContextMenu={acting ? menu.contextMenu(door) : undefined}
      >
        {children}
        {!acting ? null : (
          <Tooltip label="More">
            <button
              ref={door}
              type="button"
              className="icon-button"
              aria-label={label}
              {...menu.trigger()}
            >
              <EllipsisIcon />
            </button>
          </Tooltip>
        )}
      </div>
      {menu.drawn === undefined ? null : (
        <ActionMenu
          label={label}
          menu={menu.drawn}
          groups={groups}
          {...(heading === undefined ? undefined : { heading })}
          onClose={menu.close}
        />
      )}
    </>
  );
}
