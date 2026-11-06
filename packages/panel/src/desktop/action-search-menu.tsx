import {
  type MenuPanel,
  type MenuRow,
  type PopoverAlign,
  SEARCHABLE_MENU_LAYER,
  SearchableMenu,
} from "@repo/ui";
import { useId } from "react";
import type { MenuAction } from "./action-menu.js";

/**
 * action-search-menu.tsx -- a long menu's actions drawn as a searchable menu, which lists only the rows near its view: a pull request's reviewers and labels, a filter's people and repositories.
 *
 * The window's menu (`ActionMenu`, over Base UI's) draws every item it is
 * handed and walks only those it drew, so a list that may run to hundreds,
 * a repository's assignable users or a workspace's members, is drawn here
 * instead: `@repo/ui`'s `SearchableMenu`, whose field narrows the rows and
 * whose list draws only those near its view. Each action is a row of it, by
 * its place among the actions, and a pick takes the action, as choosing the
 * item would: one that `stays` leaves the menu standing, as a filter's
 * values toggled one after another do, and any other closes it. The rows
 * each action marks `checked` are drawn checked, several at once.
 *
 * It hangs from a button of its owner's (`align`), or stands as the panel
 * an item of the window's menu opens beside it (`actionSearchPanel`), its
 * Escape going back to that item.
 */

/** What a searchable menu of actions lists and says. */
export interface ActionSearch {
  /** What the list is, for assistive technology. */
  readonly label: string;
  /** The search field's placeholder. */
  readonly placeholder: string;
  /** Said when a query matches nothing. */
  readonly noMatch: string;
  readonly actions: readonly MenuAction[];
  /** Said in the list's place while there is nothing to list: reading, a failure, none at all. */
  readonly note?: React.ReactNode;
  /** Whether its words are the app's own, which a screen recording shows as they read, but for an action that is `replayMasked`. */
  readonly replayUnmasked?: boolean | undefined;
}

/** Where the menu stands: hung from its owner's button's edge, or in a panel of the window's menu, which places it. */
type ActionSearchPlace = { readonly align: PopoverAlign } | { readonly embedded: true };

/** Each action as a row, named by its place among the actions, which a pick hands back. */
function actionRows(actions: readonly MenuAction[]): readonly MenuRow[] {
  return actions.map((action, at) => ({
    id: String(at),
    label: action.label,
    icon: action.icon,
    detail: action.detail,
    // Note that the detail is matched too, as a person's email is beside their name.
    ...(action.detail === undefined ? {} : { terms: [action.detail] }),
    card: action.card,
    replayMasked: action.replayMasked,
  }));
}

/** The rows of the actions on now, drawn checked. */
function checkedRows(actions: readonly MenuAction[]): ReadonlySet<string> {
  return new Set(actions.flatMap((action, at) => (action.checked === true ? [String(at)] : [])));
}

/**
 * The menu of `search`'s actions at `place`: a pick takes its action, and
 * closes the menu (`onDone`) unless the action stays; Escape is `onClose`,
 * and focus leaving it `onLeave`.
 */
export function ActionSearchMenu({
  id,
  search,
  place,
  leaving,
  menuRef,
  onDone,
  onClose,
  onLeave,
}: {
  /** The menu's id, which its button's `aria-controls` names; one is minted where none is given. */
  id?: string | undefined;
  search: ActionSearch;
  place: ActionSearchPlace;
  /** The menu is on its way out: drawn fading, and taking nothing. */
  leaving?: boolean | undefined;
  /** Hands the menu's element to the hold its owner draws it through its exit with. */
  menuRef?: ((element: HTMLElement | null) => void) | undefined;
  onDone: () => void;
  onClose: () => void;
  onLeave: (left: EventTarget | null) => void;
}): React.JSX.Element {
  const minted = useId();
  const { actions } = search;
  return (
    <SearchableMenu
      {...("embedded" in place
        ? { layer: SEARCHABLE_MENU_LAYER.EMBEDDED }
        : { align: place.align })}
      id={id ?? minted}
      ref={menuRef}
      leaving={leaving}
      label={search.label}
      placeholder={search.placeholder}
      rows={actionRows(actions)}
      value={undefined}
      checked={checkedRows(actions)}
      note={search.note}
      noMatch={search.noMatch}
      replayUnmasked={search.replayUnmasked}
      onPick={(picked) => {
        const action = actions[Number(picked)];
        if (action === undefined) return;
        if (action.stays !== true) onDone();
        action.onSelect();
      }}
      onClose={onClose}
      onLeave={onLeave}
    />
  );
}

/** An item of the window's menu that opens `search` beside it as its panel, a pick that does not stay closing the whole menu. */
export function actionSearchPanel(
  item: { readonly label: string; readonly icon?: React.JSX.Element },
  search: ActionSearch,
): MenuPanel {
  return {
    ...item,
    panel: ({ back, close }) => (
      <ActionSearchMenu
        search={search}
        place={{ embedded: true }}
        onDone={close}
        onClose={back}
        onLeave={() => undefined}
      />
    ),
  };
}
