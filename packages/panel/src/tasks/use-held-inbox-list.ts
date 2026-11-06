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

type InboxFilter = Omit<Parameters<typeof inboxList>[1], "chosen" | "places">;

interface Drawn {
  readonly list: InboxListView;
  readonly steps: InboxListView;
  readonly kept: string | undefined;
  readonly heldBack: boolean;
}

interface DrawnFrom {
  readonly groups: readonly InboxGroup[];
  readonly filter: InboxFilter;
  readonly chosen: string | undefined;
  readonly pointing: boolean;
  readonly shown: boolean;
}

function heldPlaces(
  places: ReadonlyMap<string, InboxPlace>,
  chosen: string | undefined,
  pointing: boolean,
): ReadonlyMap<string, InboxPlace> {
  if (pointing) return places;
  const place = chosen === undefined ? undefined : places.get(chosen);
  return chosen === undefined || place === undefined ? NO_PLACES : new Map([[chosen, place]]);
}

function sameWhose(a: InboxWhose = EVERYONES, b: InboxWhose = EVERYONES): boolean {
  if (a.kind !== INBOX_WHOSE.PERSON || b.kind !== INBOX_WHOSE.PERSON) return a.kind === b.kind;
  return a.userId === b.userId;
}

function sameSearch(a: readonly string[] = [], b: readonly string[] = []): boolean {
  return a.length === b.length && a.every((word, at) => word === b[at]);
}

function sameScope(was: InboxFilter | undefined, now: InboxFilter): boolean {
  return (
    was !== undefined &&
    was.show === now.show &&
    was.readerId === now.readerId &&
    sameWhose(was.whose, now.whose) &&
    sameSearch(was.search, now.search)
  );
}

function sameOrder(was: InboxFilter | undefined, now: InboxFilter): boolean {
  return sameScope(was, now);
}

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

function holdsBack(list: InboxListView, held: ReadonlyMap<string, InboxPlace>): boolean {
  if (held.size === 0) return false;
  for (const [id, now] of inboxPlaces(list, NO_PLACES)) {
    const place = held.get(id);
    if (place !== undefined && place.at !== now.at) return true;
  }
  return false;
}
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
      const chosenNow = last.current === undefined || last.current.from.chosen !== chosen;
      const kept =
        chosen !== undefined &&
        (listed || chosenNow || (keptLast.current === chosen && sameScope(was, filter)))
          ? chosen
          : undefined;
      const list =
        kept === undefined || listed
          ? matching
          : inboxList(groups, { ...filter, chosen: kept, places });
      const steps = inboxList(groups, { ...filter, chosen, places });
      return { list, steps, kept, heldBack: pointing && holdsBack(list, places) };
    },
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
  const onPointing = useCallback((now: boolean) => {
    pointer.current = now;
    if (!now && last.current?.drawn.heldBack === true) redraw();
  }, []);
  return { list: drawn.list, steps: drawn.steps, onPointing };
}
