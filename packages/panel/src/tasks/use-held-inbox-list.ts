import { useLayoutEffect, useRef } from "react";
import {
  type InboxGroup,
  type InboxListView,
  type InboxPlace,
  inboxList,
  inboxPlaces,
  listedItems,
} from "./inbox-model.js";
import { type HeldOrder, useHeldOrder } from "./use-held-order.js";

/**
 * use-held-inbox-list.ts -- an Inbox's rows and its steps, held still (`use-held-order.ts`) while
 * the list is shown, so the row the reader is on stays where it is.
 *
 * The chosen item's row stays while it is chosen, once the list drew it,
 * though answering or reading it leaves the scope shown, so it goes gray
 * where it stood (`isDone`) rather than leaving under the reader; choosing
 * another row lets it go, and so does another scope or search, or the list
 * being hidden, so an item settled while it was hidden is gone once the
 * list is shown again. An item the
 * list never drew, chosen by a link, gets no row. While the list is shown
 * every row keeps the place it was first drawn in, when its item changed, so
 * an answer, which changes it, moves no row; hidden, or scoped or searched
 * anew, it is drawn again where each item stands now. A row that leaves the list lets its
 * place go, so a later change brings it back where it stands then.
 */

/** What an Inbox lists and how, bar the item chosen and the places held, which this module adds. */
type InboxFilter = Omit<Parameters<typeof inboxList>[1], "chosen" | "places">;

/** What an Inbox draws: its rows, its steps, and the chosen item its rows kept. */
interface Drawn {
  readonly list: InboxListView;
  readonly steps: InboxListView;
  readonly kept: string | undefined;
}

/** Whether two searches ask for the same words. */
function sameSearch(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return a.length === b.length && a.every((word, at) => word === b[at]);
}

/** Whether a list drawn under one filter lists the same items as under another, for the same reader, in the same order. */
function sameScope(was: InboxFilter | undefined, now: InboxFilter): boolean {
  return (
    was !== undefined &&
    was.show === now.show &&
    was.readerId === now.readerId &&
    sameSearch(was.search, now.search)
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
  const keptLast = useRef<string | undefined>(undefined);
  const order: HeldOrder<InboxFilter, InboxPlace, Drawn> = {
    sameOrder: sameScope,
    draw: (places, was) => {
      const matching = inboxList(groups, { ...filter, chosen: undefined, places });
      const listed = listedItems(matching).some(({ item }) => item.id === chosen);
      // Note that the chosen row is kept only once the list drew it, so one chosen from outside the scope never gets a row.
      const kept =
        chosen !== undefined && (listed || (keptLast.current === chosen && sameScope(was, filter)))
          ? chosen
          : undefined;
      const list =
        kept === undefined || listed
          ? matching
          : inboxList(groups, { ...filter, chosen: kept, places });
      const steps = inboxList(groups, { ...filter, chosen, places });
      return { list, steps, kept };
    },
    placesOf: ({ list }, held) => inboxPlaces(list, held),
  };
  const { list, steps, kept } = useHeldOrder(filter, shown, order);
  useLayoutEffect(() => {
    keptLast.current = shown ? kept : undefined;
  });
  return { list, steps };
}
