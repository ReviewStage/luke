import { INBOX_STATUS } from "@luke/features/inbox-wire";
import type { CatalogModel } from "@luke/features/models-wire";
import {
  APP_COMMAND,
  APP_SHORTCUTS,
  type ShortcutChord,
  shortcutAria,
} from "@luke/settings/shortcuts";
import {
  IconButton,
  LIST_VARIANT,
  List,
  ListRow,
  type ListRowHint,
  OneLine,
  RowHint,
  RowHintOptions,
  Shortcut,
  Tooltip,
  useMinute,
} from "@luke/ui";
import { ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { cloneElement, useState } from "react";
import { useAppCommand } from "../app-commands.js";
import { InboxItemCard, InboxItemEnd, ItemMark } from "./inbox-item-parts.js";
import {
  INBOX_DIRECTION,
  type InboxDirection,
  type InboxListed,
  type InboxListView,
  inboxSteps,
  nextNeedingYou,
} from "./inbox-model.js";
import { cardTitle } from "./tool-call-model.js";

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
 * item that needs the developer the way they last stepped, up after K and
 * down after J or before either, wrapping round the list, so answering one
 * leads to the next without the list in between; it never moves on by
 * itself, so an answer is seen landing before the developer leaves it. A
 * press on a row turns no way, so Next goes on the way the keys last went.
 */

/** What a hint names as the key it is reached by: the chord, on the row's press, the row's card hung through `RowHintOptions` beside it. */
function keyHint(chord: ShortcutChord): ListRowHint {
  return ({ label, children }) => (
    <RowHint label={label}>
      {cloneElement(children, { "aria-keyshortcuts": shortcutAria(chord) })}
    </RowHint>
  );
}

/** How Next reads and which key reaches it, each way through the list: K and an arrow up, or J as it always read. */
const NEXT_WAY = {
  [INBOX_DIRECTION.UP]: {
    lead: "Next ↑",
    chord: APP_SHORTCUTS[APP_COMMAND.PREVIOUS_INBOX_ITEM].chord,
    Hint: keyHint(APP_SHORTCUTS[APP_COMMAND.PREVIOUS_INBOX_ITEM].chord),
  },
  [INBOX_DIRECTION.DOWN]: {
    lead: "Next",
    chord: APP_SHORTCUTS[APP_COMMAND.NEXT_INBOX_ITEM].chord,
    Hint: keyHint(APP_SHORTCUTS[APP_COMMAND.NEXT_INBOX_ITEM].chord),
  },
} as const satisfies Record<
  InboxDirection,
  { lead: string; chord: ShortcutChord; Hint: ListRowHint }
>;

/** What the pager draws and steps by. */
export interface InboxPager {
  /** Where the chosen item's row stands among the rows, counted from one; none where the filter draws it no row. */
  readonly count: { readonly at: number; readonly total: number } | undefined;
  /** Chooses the item above the chosen one; none at the list's top. */
  readonly onPrevious: (() => void) | undefined;
  /** Chooses the item below the chosen one; none at the list's foot. */
  readonly onNext: (() => void) | undefined;
}

/** The next item that needs the developer, as a settled item offers it: the Inbox's own row of it, which way it was looked for in, whether that way's key reaches it too, and the press that opens it. */
export interface InboxNext {
  readonly listed: InboxListed;
  readonly models: readonly CatalogModel[] | undefined;
  readonly readerId: string | undefined;
  /** The way the developer last stepped, which it was looked for in, wrapping round past the list's end. */
  readonly direction: InboxDirection;
  /** Whether it is also the item that way's key chooses, the one just beside it in the list, so the row may name the key. */
  readonly byKey: boolean;
  readonly onOpen: () => void;
}

/** The next item that needs the developer from the chosen one among the rows, the way they last stepped, offered where it is settled; none while it waits, or where nothing else does. */
export function inboxNext(
  view: InboxListView,
  chosen: InboxListed | undefined,
  seams: {
    readonly models: readonly CatalogModel[] | undefined;
    readonly readerId: string | undefined;
  },
  onChoose: (listed: InboxListed) => void,
  folded: (key: string) => boolean,
  direction: InboxDirection,
): InboxNext | undefined {
  if (chosen === undefined || chosen.item.status === INBOX_STATUS.OPEN) return undefined;
  const next = nextNeedingYou(view, chosen.item.id, folded, direction);
  if (next === undefined) return undefined;
  const steps = inboxSteps(view, chosen.item.id, folded);
  const beside = direction === INBOX_DIRECTION.UP ? steps?.previous : steps?.next;
  return {
    listed: next,
    ...seams,
    direction,
    byKey: beside?.item.id === next.item.id,
    onOpen: () => onChoose(next),
  };
}

/**
 * The row a settled item offers over its box, a card of one row: Next, an
 * arrow up where it lies above, the item's agent's tile and title, the marks
 * the Inbox's own row wears at its end, and K or J where that key reaches
 * it. The item's card hangs beside it, as the Inbox's row hangs it.
 */
export function InboxNextUp({ next }: { next: InboxNext }): React.JSX.Element {
  const way = NEXT_WAY[next.direction];
  const now = useMinute();
  const { listed, models, readerId } = next;
  const { holder, item } = listed;
  const title = cardTitle(item.title);
  return (
    <div className="inbox-next-dock">
      <List label="Next item" variant={LIST_VARIANT.CARD}>
        <RowHintOptions
          card={<InboxItemCard listed={listed} now={now} models={models} readerId={readerId} />}
          cardBeside
        >
          <ListRow
            leading={
              <span className="inbox-row-mark">
                <ItemMark
                  holder={holder}
                  agentId={item.agentId}
                  models={models}
                  readerId={readerId}
                  plain
                />
              </span>
            }
            title={
              <span className="inbox-next-words">
                <span className="inbox-next-lead">{way.lead}</span>
                <OneLine className="inbox-next-title" words={title}>
                  {title}
                </OneLine>
              </span>
            }
            meta={
              <InboxItemEnd
                listed={listed}
                now={now}
                readerId={readerId}
                after={next.byKey ? <Shortcut chord={way.chord} /> : undefined}
              />
            }
            unread
            hint={{ Hint: next.byKey ? way.Hint : RowHint, label: title }}
            onPress={next.onOpen}
          />
        </RowHintOptions>
      </List>
    </div>
  );
}

/** Where the Inbox stands: whether it is on screen, and which of its groups are folded away. */
export interface InboxPagerPlace {
  readonly shown: boolean;
  readonly folded: (key: string) => boolean;
}

/** The pager, where the steps hold the chosen item, and the way the developer last stepped, which Next follows. */
export interface InboxPaging {
  readonly pager: InboxPager | undefined;
  /** Up after K or the arrow up, down after J or the arrow down, and down before either. */
  readonly direction: InboxDirection;
}

/** The chosen item's place among the rows drawn and the steps either side of it, which keep it in its place where it has no row, K and J offered while the Inbox is on screen and each has somewhere to go, and the way the last of them went; no pager where the steps do not hold the chosen item. */
export function useInboxPager(
  steps: InboxListView,
  rows: InboxListView,
  chosen: string | undefined,
  onChoose: (listed: InboxListed) => void,
  place: InboxPagerPlace,
): InboxPaging {
  const [direction, setDirection] = useState<InboxDirection>(INBOX_DIRECTION.DOWN);
  const at = inboxSteps(steps, chosen, place.folded);
  const row = inboxSteps(rows, chosen, place.folded);
  const previous = at?.previous;
  const next = at?.next;
  const onPrevious =
    previous === undefined
      ? undefined
      : () => {
          setDirection(INBOX_DIRECTION.UP);
          onChoose(previous);
        };
  const onNext =
    next === undefined
      ? undefined
      : () => {
          setDirection(INBOX_DIRECTION.DOWN);
          onChoose(next);
        };
  useAppCommand(APP_COMMAND.PREVIOUS_INBOX_ITEM, place.shown ? onPrevious : undefined);
  useAppCommand(APP_COMMAND.NEXT_INBOX_ITEM, place.shown ? onNext : undefined);
  const pager =
    at === undefined
      ? undefined
      : {
          count: row === undefined ? undefined : { at: row.at, total: row.total },
          onPrevious,
          onNext,
        };
  return { pager, direction };
}

/** The pager at the end of an item's bar: "2 of 8" where the item has a row, then the arrows up and down the list, each naming its key, stepped back where there is nowhere to go. */
export function InboxPagerControls({ pager }: { pager: InboxPager }): React.JSX.Element {
  return (
    <div className="luke-toolbar-actions inbox-pager">
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
