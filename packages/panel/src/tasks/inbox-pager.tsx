import { APP_COMMAND, APP_SHORTCUTS } from "@luke/settings/shortcuts";
import { PAGER_AXIS, Pager } from "@luke/ui";
import { useAppCommand } from "../app-commands.js";
import { type InboxListed, type InboxListView, inboxEnds, inboxSteps } from "./inbox-model.js";

/**
 * inbox-pager.tsx -- stepping through the Inbox's items one at a time: where the chosen one stands, "2 of 8", and the presses and keys that choose the one above or below it.
 *
 * The steps follow the list's own order, its grouping and its Needs-you
 * filter as drawn, settled items among them and a folded group's left out,
 * so the count matches the rows, and they stop at its ends rather than
 * wrapping round. The item read keeps its place among the steps where the
 * filter draws it no row, once it is answered, so they still reach the rows
 * either side; the pager then counts nothing, there being no row to count it
 * as. With nothing chosen, J chooses the first row and K the last. K and J are offered only while the Inbox is on screen, so
 * a page drawn over it, a full-screen side panel or Settings, keeps them. K and J
 * choose the item above and below wherever the Inbox stands, as Linear's
 * Inbox has them: split, they move the chosen row and the item beside it;
 * one column wide, the item standing alone, whose bar draws the pager with
 * its up and down arrows, as Mail's message toolbar does while its list is
 * hidden. An Inbox narrowed to a channel pages its own list alike.
 */

/** What the pager draws and steps by. */
export interface InboxPager {
  /** Where the chosen item's row stands among the rows, counted from one; none where the filter draws it no row. */
  readonly count: { readonly at: number; readonly total: number } | undefined;
  /** Chooses the item above the chosen one; none at the list's top. */
  readonly onPrevious: (() => void) | undefined;
  /** Chooses the item below the chosen one; none at the list's foot. */
  readonly onNext: (() => void) | undefined;
}

/** Where the Inbox stands: whether it is on screen. */
export interface InboxPagerPlace {
  readonly shown: boolean;
}

/** The chosen item's place among the rows drawn and the steps either side of it, which keep it in its place where it has no row, K and J offered while the Inbox is on screen and each has somewhere to go, the last row and the first while nothing is chosen; none where the steps do not hold the chosen item. */
export function useInboxPager(
  steps: InboxListView,
  rows: InboxListView,
  chosen: string | undefined,
  onChoose: (listed: InboxListed) => void,
  place: InboxPagerPlace,
): InboxPager | undefined {
  const at = inboxSteps(steps, chosen);
  const row = inboxSteps(rows, chosen);
  // Note that with nothing chosen J chooses the first row and K the last, so the empty pane's "step with J K" holds.
  const ends = chosen === undefined ? inboxEnds(steps) : undefined;
  const previous = at === undefined ? ends?.last : at.previous;
  const next = at === undefined ? ends?.first : at.next;
  const onPrevious = previous === undefined ? undefined : () => onChoose(previous);
  const onNext = next === undefined ? undefined : () => onChoose(next);
  useAppCommand(APP_COMMAND.PREVIOUS_INBOX_ITEM, place.shown ? onPrevious : undefined);
  useAppCommand(APP_COMMAND.NEXT_INBOX_ITEM, place.shown ? onNext : undefined);
  if (at === undefined) return undefined;
  return {
    count: row === undefined ? undefined : { at: row.at, total: row.total },
    onPrevious,
    onNext,
  };
}

/** The pager at the end of an item's bar: "2 of 8" where the item has a row, then the arrows up and down the list, each naming its key, stepped back where there is nowhere to go. */
export function InboxPagerControls({ pager }: { pager: InboxPager }): React.JSX.Element {
  return (
    <Pager
      axis={PAGER_AXIS.VERTICAL}
      place={pager.count}
      previous={{
        label: "Previous item",
        chord: APP_SHORTCUTS[APP_COMMAND.PREVIOUS_INBOX_ITEM].chord,
        onStep: pager.onPrevious,
      }}
      next={{
        label: "Next item",
        chord: APP_SHORTCUTS[APP_COMMAND.NEXT_INBOX_ITEM].chord,
        onStep: pager.onNext,
      }}
    />
  );
}
