import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "../app-commands";
import { Tooltip } from "../tooltip";
import { type InboxListed, type InboxListView, inboxSteps } from "./inbox-model";

/**
 * inbox-pager.tsx -- stepping through the Inbox's items one at a time: where the chosen one stands, "2 of 8", and the presses and keys that choose the one above or below it.
 *
 * The steps follow the list's own order, its grouping and its Needs-you
 * filter as drawn, settled items among them, so the count matches the
 * list, and they stop at its ends rather than wrapping round. K and J
 * choose the item above and below wherever the Inbox stands, as Linear's
 * Inbox has them: split, they move the chosen row and the item beside it;
 * one column wide, the item standing alone, whose bar draws the pager with
 * its up and down arrows, as Mail's message toolbar does while its list is
 * hidden.
 */

/** What the pager draws and steps by. */
export interface InboxPager {
  readonly at: number;
  readonly total: number;
  /** Chooses the item above the chosen one; none at the list's top. */
  readonly onPrevious: (() => void) | undefined;
  /** Chooses the item below the chosen one; none at the list's foot. */
  readonly onNext: (() => void) | undefined;
}

/** The chosen item's place in the list and the steps either side of it, K and J offered while each has somewhere to go; none where nothing listed is chosen. */
export function useInboxPager(
  view: InboxListView,
  chosen: string | undefined,
  onChoose: (listed: InboxListed) => void,
): InboxPager | undefined {
  const steps = inboxSteps(view, chosen);
  const previous = steps?.previous;
  const next = steps?.next;
  const onPrevious = previous === undefined ? undefined : () => onChoose(previous);
  const onNext = next === undefined ? undefined : () => onChoose(next);
  useAppCommand(APP_COMMAND.PREVIOUS_INBOX_ITEM, onPrevious);
  useAppCommand(APP_COMMAND.NEXT_INBOX_ITEM, onNext);
  if (steps === undefined) return undefined;
  return { at: steps.at, total: steps.total, onPrevious, onNext };
}

/** The pager at the end of an item's bar: "2 of 8", then the arrows up and down the list, each naming its key, stepped back where there is nowhere to go. */
export function InboxPagerControls({ pager }: { pager: InboxPager }): React.JSX.Element {
  return (
    <div className="desktop-toolbar-actions inbox-pager">
      <span className="inbox-pager-count">
        {pager.at} of {pager.total}
      </span>
      <Tooltip label="Previous item" command={APP_COMMAND.PREVIOUS_INBOX_ITEM}>
        <button
          type="button"
          className="icon-button"
          aria-label="Previous item"
          disabled={pager.onPrevious === undefined}
          onClick={pager.onPrevious}
        >
          <ChevronUpIcon className="icon-button-glyph" />
        </button>
      </Tooltip>
      <Tooltip label="Next item" command={APP_COMMAND.NEXT_INBOX_ITEM}>
        <button
          type="button"
          className="icon-button"
          aria-label="Next item"
          disabled={pager.onNext === undefined}
          onClick={pager.onNext}
        >
          <ChevronDownIcon className="icon-button-glyph" />
        </button>
      </Tooltip>
    </div>
  );
}
