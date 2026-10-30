import { useCallback, useLayoutEffect, useReducer, useRef } from "react";
import {
  EVERYONES,
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
import { type HeldOrder, useHeldOrder } from "./use-held-order.js";

/**
 * use-held-inbox-list.ts -- an Inbox's rows and its steps, held still (`use-held-order.ts`) while
 * the list is shown, so the row the reader is on stays where it is.
 *
 * The chosen item's row stays while it is chosen, once the list drew it,
 * though answering or reading it leaves the scope shown, so it goes gray
 * where it stood (`isDone`) rather than leaving under the reader; choosing
 * another row lets it go, and so does another scope or Addressed to, or the list
 * being hidden, so an item settled while it was hidden is gone once the
 * list is shown again. An item the
 * list never drew, chosen by a link, gets no row. While the pointer is over
 * the list every row keeps the place it was first drawn in, when its item
 * changed, so nothing moves under the reader's
 * hand; once it leaves, every row but the chosen one stands where its item
 * does now, and the chosen row keeps its place while it stays chosen, so an
 * answer, which changes it, moves no row. Hidden, or
 * scoped, searched, or Addressed to chosen anew, the list is drawn again where each
 * item stands now. A row that leaves the list lets its place go, so a later
 * change brings it back where it stands then.
 *
 * Note that the pointer is kept where the next draw reads it rather than in
 * state, as ⌘K lights a row without ranking any, because a pointer crossing
 * a long list is no reason to draw it again: it draws again as the pointer
 * leaves only where a row held still stands apart from where its item does
 * now. Note too that the list is drawn again only as what it is drawn from
 * moves, since the page around it draws again for much that moves no row.
 */

/** What an Inbox lists and how, bar the item chosen and the places held, which this module adds. */
type InboxFilter = Omit<Parameters<typeof inboxList>[1], "chosen" | "places">;

/** What an Inbox draws: its rows, its steps, the chosen item its rows kept, and whether a row held still stands apart from where its item does now. */
interface Drawn {
  readonly list: InboxListView;
  readonly steps: InboxListView;
  readonly kept: string | undefined;
  readonly heldBack: boolean;
}

/** What a draw was drawn from, by which the next draw from the same is the same draw (`sameDraw`). */
interface DrawnFrom {
  readonly groups: readonly InboxGroup[];
  readonly filter: InboxFilter;
  readonly chosen: string | undefined;
  readonly pointing: boolean;
  readonly shown: boolean;
}

/** The places held of `chosen` alone, or of every row while the pointer is over the list. */
function heldPlaces(
  places: ReadonlyMap<string, InboxPlace>,
  chosen: string | undefined,
  pointing: boolean,
): ReadonlyMap<string, InboxPlace> {
  if (pointing) return places;
  const place = chosen === undefined ? undefined : places.get(chosen);
  return chosen === undefined || place === undefined ? NO_PLACES : new Map([[chosen, place]]);
}

/** Whether two Addressed to choices name the same people. */
function sameWhose(a: InboxWhose = EVERYONES, b: InboxWhose = EVERYONES): boolean {
  if (a.kind !== INBOX_WHOSE.PERSON || b.kind !== INBOX_WHOSE.PERSON) return a.kind === b.kind;
  return a.userId === b.userId;
}

/** Whether two searches ask for the same words. */
function sameSearch(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return a.length === b.length && a.every((word, at) => word === b[at]);
}

/** Whether a list drawn under one filter lists the same items as under another, for the same reader. */
function sameScope(was: InboxFilter | undefined, now: InboxFilter): boolean {
  return (
    was !== undefined &&
    was.show === now.show &&
    was.readerId === now.readerId &&
    sameWhose(was.whose, now.whose) &&
    sameSearch(was.search, now.search)
  );
}

/** Whether a list drawn under one filter lists the same items as under another, in the same order: every list stands the latest first. */
function sameOrder(was: InboxFilter | undefined, now: InboxFilter): boolean {
  return sameScope(was, now);
}

/**
 * Whether a draw is drawn from what the last one was, so it draws the same.
 * Note that the places it holds need no comparing, because they are where
 * the last draw stood its rows, which the same draw stands where they are.
 */
function sameDraw(was: DrawnFrom | undefined, now: DrawnFrom): boolean {
  return (
    was !== undefined &&
    was.groups === now.groups &&
    sameOrder(was.filter, now.filter) &&
    was.chosen === now.chosen &&
    was.pointing === now.pointing &&
    was.shown === now.shown
  );
}

/** Whether a row's place held stands apart from where its item stands now, so letting the hold go moves it. */
function holdsBack(list: InboxListView, held: ReadonlyMap<string, InboxPlace>): boolean {
  if (held.size === 0) return false;
  for (const [id, now] of inboxPlaces(list, NO_PLACES)) {
    const place = held.get(id);
    if (place !== undefined && place.at !== now.at) return true;
  }
  return false;
}
/**
 * The rows an Inbox draws (`list`) and the items K, J, and Next step through
 * (`steps`), which keep the chosen item in its place whether or not it has a
 * row, both held still as the module's head says while `shown`; and what the
 * list tells as the pointer comes onto it and leaves (`onPointing`).
 */
export function useHeldInboxList(
  groups: readonly InboxGroup[],
  filter: InboxFilter,
  chosen: string | undefined,
  shown: boolean,
): {
  readonly list: InboxListView;
  readonly steps: InboxListView;
  readonly onPointing: (pointing: boolean) => void;
} {
  const keptLast = useRef<string | undefined>(undefined);
  // Note that the hold is the pointer's and not the list's being shown, because the Inbox may stand open for as long as the window does.
  const pointer = useRef(false);
  const pointing = pointer.current;
  const last = useRef<{ readonly from: DrawnFrom; readonly drawn: Drawn }>(undefined);
  const placed = useRef<{
    readonly drawn: Drawn;
    readonly places: ReadonlyMap<string, InboxPlace>;
  }>(undefined);
  const [, redraw] = useReducer((count: number) => count + 1, 0);
  const from: DrawnFrom = { groups, filter, chosen, pointing, shown };
  const order: HeldOrder<InboxFilter, InboxPlace, Drawn> = {
    sameOrder,
    draw: (held, was) => {
      if (last.current !== undefined && sameDraw(last.current.from, from))
        return last.current.drawn;
      const places = heldPlaces(held, chosen, pointing);
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
      return { list, steps, kept, heldBack: pointing && holdsBack(list, places) };
    },
    // Note that the same draw over the places it was drawn from stands its rows where they were, so their places stand as they were.
    placesOf: (drawn, held) => {
      if (placed.current?.drawn === drawn && placed.current.places === held) return held;
      const places = inboxPlaces(drawn.list, heldPlaces(held, chosen, pointing));
      placed.current = { drawn, places };
      return places;
    },
  };
  const drawn = useHeldOrder(filter, shown, order);
  useLayoutEffect(() => {
    keptLast.current = shown ? drawn.kept : undefined;
    last.current = { from, drawn };
  });
  // Note that only the pointer leaving a list it held apart from where its items stand draws it again.
  const onPointing = useCallback((now: boolean) => {
    pointer.current = now;
    if (!now && last.current?.drawn.heldBack === true) redraw();
  }, []);
  return { list: drawn.list, steps: drawn.steps, onPointing };
}
