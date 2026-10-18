import { searchAnchorProps } from "@luke/settings/settings-anchors";
import { EllipsisIcon, IconButton, SettingsRow, type SettingsRowControl, useMenu } from "@luke/ui";
import { type ReactNode, useRef } from "react";
import { ActionMenu, type MenuAction } from "../desktop/action-menu";
import { Tooltip } from "../tooltip";

/**
 * menu-row.tsx -- a Settings row with actions of its own: a stored key, a connected service, a changeable shortcut.
 *
 * The row's acts live in the window's own menu rather than in buttons along
 * the row, the way a sidebar task's do: a ⋯ at the row's end opens it, and a
 * right-click anywhere on the row opens the same menu at the pointer. The ⋯
 * is always drawn, muted as a toolbar's glyphs are until the pointer is on it,
 * because a ⋯ shown only on hover leaves an empty gap at the end of the row. A
 * row with no act that applies now draws no ⋯ and answers no right-click. An
 * act that cannot be taken back asks first through the confirm dialog, which
 * hands focus back to the ⋯ the menu returned it to.
 *
 * Its acts may come in groups, a rule between each. The ⋯ is `@luke/ui`'s
 * quiet `IconButton`. A row given its words (`row`) stands in `@luke/ui`'s
 * `SettingsRow`, its control and the ⋯ at the row's end; one given
 * `children` still draws them in the window's own row, until its page moves.
 */

/** A row's acts: one list, or lists drawn with a rule between each. */
type MenuRowActions = readonly MenuAction[] | readonly (readonly MenuAction[])[];

/** A row's words as the shared row draws them, and the control standing before its ⋯. */
interface MenuRowWords {
  label: ReactNode;
  /** What rides the label's line without naming the row: a Modified word, a mark. */
  adornment?: ReactNode;
  description?: ReactNode;
  /** What went wrong with the row's last act, or nothing while none did. */
  error?: ReactNode;
  /** What the row grows under its line and owns alone, a stored key's field. */
  below?: ReactNode;
  /** The provider's or service's mark the row leads with. */
  leading?: ReactNode;
  control?: ReactNode;
  /** A control drawn from the row's ids, where the row's words and error must describe it. */
  describedControl?: (control: SettingsRowControl) => ReactNode;
}

/** What the row draws: its words for the shared row, or its own children in the window's row. */
type MenuRowBody =
  | { row: MenuRowWords; children?: undefined }
  | {
      row?: undefined;
      /** The row's words, and any control standing before the ⋯. */
      children: ReactNode;
    };

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
  row,
  children,
}: MenuRowBody & {
  /** What the menu is named: "Linear actions". */
  label: string;
  actions: MenuRowActions;
  /** A muted line over the menu's acts saying what they act on, where the row's words do not. */
  heading?: string;
  /** The id a pressed search result lands on. */
  anchor?: string;
}): React.JSX.Element {
  // The page is drawn whenever the row is, so the menu needs no surface of
  // its own to close with: it closes with the row unmounting.
  const menu = useMenu(true);
  const door = useRef<HTMLButtonElement | null>(null);
  const groups = groupsOf(actions);
  const acting = groups.length > 0;
  const more = !acting ? null : (
    <Tooltip label="More">
      <IconButton ref={door} icon={<EllipsisIcon />} label={label} {...menu.trigger()} />
    </Tooltip>
  );
  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: the right-click is a second door to the ⋯ beside it, which is the keyboard's. */}
      <div
        className={row === undefined ? "settings-row menu-row" : "menu-row"}
        {...(anchor ? searchAnchorProps(anchor) : undefined)}
        onContextMenu={acting ? menu.contextMenu(door) : undefined}
      >
        {row === undefined ? (
          <>
            {children}
            {more}
          </>
        ) : (
          <SettingsRow
            leading={row.leading}
            label={row.label}
            adornment={row.adornment}
            description={row.description}
            error={row.error}
            below={row.below === undefined || row.below === null ? undefined : () => row.below}
          >
            {(control) => (
              <>
                {row.control}
                {row.describedControl?.(control)}
                {more}
              </>
            )}
          </SettingsRow>
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
