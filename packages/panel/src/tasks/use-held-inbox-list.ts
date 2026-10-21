import { useLayoutEffect, useRef } from "react";
import {
  EVERYONES,
  INBOX_SORT,
  INBOX_WHOSE,
  type InboxGroup,
  type InboxListView,
  type InboxPlace,
  type InboxWhose,
  inboxList,
  inboxPlaces,
  listedItems,
  NO_PLACES,
} from "./inbox-model.js";

/**
 * use-held-inbox-list.ts -- an Inbox's rows and its steps, held still while
 * the list is shown, so the row the reader is on stays where it is.
 *
 * The chosen item's row stays while it is chosen, once the list drew it,
 * though answering or reading it leaves the scope shown, so it goes gray
 * where it stood (`isDone`) rather than leaving under the reader; choosing
 * another row lets it go, and so does another scope or Whose, or the list
 * being hidden, so an item settled while it was hidden is gone once the
 * list is shown again. An item the
 * list never drew, chosen by a link, gets no row. While the list is shown
 * every row keeps the place it was first drawn in, when its item changed and
 * the status it stood under, so an answer, which changes both, moves no row;
 * hidden, or sorted, grouped, scoped, or Whose chosen anew, it is drawn
 * again where each item stands now. A row that leaves the list lets its
 * place go, so a later change brings it back where it stands then.
 */

/** What an Inbox lists and how, bar the item chosen and the places held, which this module adds. */
type InboxFilter = Omit<Parameters<typeof inboxList>[1], "chosen" | "places">;

/** What the list last drawn held: the filter it was drawn under, the chosen item its rows kept, and each row's place. */
interface Held {
  readonly filter: InboxFilter | undefined;
  readonly kept: string | undefined;
  readonly places: ReadonlyMap<string, InboxPlace>;
}

const NOTHING_HELD: Held = { filter: undefined, kept: undefined, places: NO_PLACES };

/** Whether two Whose choices name the same people. */
function sameWhose(a: InboxWhose = EVERYONES, b: InboxWhose = EVERYONES): boolean {
  if (a.kind !== INBOX_WHOSE.PERSON || b.kind !== INBOX_WHOSE.PERSON) return a.kind === b.kind;
  return a.userId === b.userId;
}

/** Whether a list drawn under one filter lists the same items as under another, for the same reader. */
function sameScope(was: InboxFilter | undefined, now: InboxFilter): boolean {
  return (
    was !== undefined &&
    was.show === now.show &&
    was.readerId === now.readerId &&
    sameWhose(was.whose, now.whose)
  );
}

/** Whether a list drawn under one filter lists the same items as under another, in the same order and groups. */
function sameOrder(was: InboxFilter | undefined, now: InboxFilter): boolean {
  return (
    sameScope(was, now) &&
    was?.grouping === now.grouping &&
    (was.sort ?? INBOX_SORT.LATEST) === (now.sort ?? INBOX_SORT.LATEST)
  );
}

/**
 * The rows an Inbox draws (`list`) and the items K, J, and Next step through
 * (`steps`), which keep the chosen item in its place whether or not it has a
 * row, both held still as the module's head says while `shown`.
 */
export function useHeldInboxList(
  groups: readonly InboxGroup[],
  filter: InboxFilter,
  chosen: string | undefined,
  shown: boolean,
): { readonly list: InboxListView; readonly steps: InboxListView } {
  const held = useRef<Held>(NOTHING_HELD);
  const last = held.current;
  const places = shown && sameOrder(last.filter, filter) ? last.places : NO_PLACES;
  const matching = inboxList(groups, { ...filter, chosen: undefined, places });
  const listed = listedItems(matching).some(({ item }) => item.id === chosen);
  // Note that the chosen row is kept only once the list drew it, so one chosen from outside the scope never gets a row.
  const kept =
    chosen !== undefined &&
    (listed || (shown && last.kept === chosen && sameScope(last.filter, filter)))
      ? chosen
      : undefined;
  const list =
    kept === undefined || listed
      ? matching
      : inboxList(groups, { ...filter, chosen: kept, places });
  const steps = inboxList(groups, { ...filter, chosen, places });
  // Note that what was drawn is held once it is on screen, so a render React drops holds nothing.
  useLayoutEffect(() => {
    held.current = shown
      ? { filter, kept, places: inboxPlaces(list, places) }
      : { filter, kept: undefined, places: NO_PLACES };
  });
  return { list, steps };
}
