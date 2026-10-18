import { INBOX_STATUS } from "@luke/features/inbox-wire";
import { APP_COMMAND, APP_SHORTCUTS, shortcutAria } from "@luke/settings/shortcuts";
import { IconButton, LIST_VARIANT, List, ListRow, type ListRowHint } from "@luke/ui";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cloneElement } from "react";
import { useAppCommand } from "../app-commands";
import { Shortcut } from "../shortcut";
import { Tooltip } from "../tooltip";
import { type InboxListed, type InboxListView, inboxSteps, nextNeedingYou } from "./inbox-model";
import { cardTitle } from "./tool-call-model";

/**
 * inbox-pager.tsx -- stepping through the Inbox's items one at a time: where the chosen one stands, "2 of 8", and the presses and keys that choose the one above or below it.
 *
 * The steps follow the list's own order, its grouping and its Needs-you
 * filter as drawn, settled items among them and a folded group's left out,
 * so the count matches the rows, and they stop at its ends rather than
 * wrapping round. The item read keeps its place among the steps where the
 * filter draws it no row, once it is answered, so they still reach the rows
 * either side; the pager then counts nothing, there being no row to count it
 * as. K and J are offered only while the Inbox is on screen, so
 * a page drawn over it, a full-screen side panel or Settings, keeps them. K and J
 * choose the item above and below wherever the Inbox stands, as Linear's
 * Inbox has them: split, they move the chosen row and the item beside it;
 * one column wide, the item standing alone, whose bar draws the pager with
 * its up and down arrows, as Mail's message toolbar does while its list is
 * hidden. Once an item is settled, the row over its box offers the next
 * item that needs the developer, wrapping round the list, so answering one
 * leads to the next without the list in between; it never moves on by
 * itself, so an answer is seen landing before the developer leaves it.
 */

/** J, the chord that chooses the item below. */
const NEXT_CHORD = APP_SHORTCUTS[APP_COMMAND.NEXT_INBOX_ITEM].chord;

/** What the pager draws and steps by. */
export interface InboxPager {
  /** Where the chosen item's row stands among the rows, counted from one; none where the filter draws it no row. */
  readonly count: { readonly at: number; readonly total: number } | undefined;
  /** Chooses the item above the chosen one; none at the list's top. */
  readonly onPrevious: (() => void) | undefined;
  /** Chooses the item below the chosen one; none at the list's foot. */
  readonly onNext: (() => void) | undefined;
}

/** The next item that needs the developer, as a settled item offers it: its agent's tile and title, whether J reaches it too, and the press that opens it. */
export interface InboxNext {
  readonly title: string;
  readonly mark: React.ReactNode;
  /** Whether it is also the item J chooses, the one just below in the list, so the row may name the key. */
  readonly byKey: boolean;
  readonly onOpen: () => void;
}

/** The next item that needs the developer after the chosen one among the rows, offered where it is settled; none while it waits, or where nothing else does. */
export function inboxNext(
  view: InboxListView,
  chosen: InboxListed | undefined,
  mark: (listed: InboxListed) => React.ReactNode,
  onChoose: (listed: InboxListed) => void,
  folded: (key: string) => boolean,
): InboxNext | undefined {
  if (chosen === undefined || chosen.item.status === INBOX_STATUS.OPEN) return undefined;
  const next = nextNeedingYou(view, chosen.item.id, folded);
  if (next === undefined) return undefined;
  return {
    title: cardTitle(next.item.title),
    mark: mark(next),
    byKey: inboxSteps(view, chosen.item.id, folded)?.next?.item.id === next.item.id,
    onOpen: () => onChoose(next),
  };
}

/** What a row J reaches says it is reached by: J, on the row's press. */
const NextKey: ListRowHint = ({ children }) =>
  cloneElement(children, { "aria-keyshortcuts": shortcutAria(NEXT_CHORD) });

/** The row a settled item offers over its box, a card of one row: Next, the item's agent's tile and title, and J where J reaches it. */
export function InboxNextUp({ next }: { next: InboxNext }): React.JSX.Element {
  return (
    <div className="inbox-next-dock">
      <List label="Next item" variant={LIST_VARIANT.CARD}>
        <ListRow
          leading={<span className="inbox-row-mark">{next.mark}</span>}
          title={
            <span className="inbox-next-words">
              <span className="inbox-next-lead">Next</span>
              <span>{next.title}</span>
            </span>
          }
          meta={next.byKey ? <Shortcut chord={NEXT_CHORD} /> : null}
          unread
          hint={next.byKey ? { Hint: NextKey, label: next.title } : undefined}
          onPress={next.onOpen}
        />
      </List>
    </div>
  );
}

/** Where the Inbox stands: whether it is on screen, and which of its groups are folded away. */
export interface InboxPagerPlace {
  readonly shown: boolean;
  readonly folded: (key: string) => boolean;
}

/** The chosen item's place among the rows drawn and the steps either side of it, which keep it in its place where it has no row, K and J offered while the Inbox is on screen and each has somewhere to go; none where the steps do not hold the chosen item. */
export function useInboxPager(
  steps: InboxListView,
  rows: InboxListView,
  chosen: string | undefined,
  onChoose: (listed: InboxListed) => void,
  place: InboxPagerPlace,
): InboxPager | undefined {
  const at = inboxSteps(steps, chosen, place.folded);
  const row = inboxSteps(rows, chosen, place.folded);
  const previous = at?.previous;
  const next = at?.next;
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
    <div className="desktop-toolbar-actions inbox-pager">
      {pager.count === undefined ? null : (
        <span className="inbox-pager-count">
          {pager.count.at} of {pager.count.total}
        </span>
      )}
      <Tooltip label="Previous item" command={APP_COMMAND.PREVIOUS_INBOX_ITEM}>
        <IconButton
          icon={<ChevronUpIcon />}
          label="Previous item"
          disabled={pager.onPrevious === undefined}
          onClick={pager.onPrevious}
        />
      </Tooltip>
      <Tooltip label="Next item" command={APP_COMMAND.NEXT_INBOX_ITEM}>
        <IconButton
          icon={<ChevronDownIcon />}
          label="Next item"
          disabled={pager.onNext === undefined}
          onClick={pager.onNext}
        />
      </Tooltip>
    </div>
  );
}
