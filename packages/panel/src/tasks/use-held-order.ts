import { useLayoutEffect, useRef } from "react";

const NO_PLACES: ReadonlyMap<string, never> = new Map<string, never>();

interface Held<V, P> {
  readonly view: V;
  readonly places: ReadonlyMap<string, P>;
}

export interface HeldOrder<V, P, L> {
  readonly sameOrder: (was: V, now: V) => boolean;
  readonly draw: (places: ReadonlyMap<string, P>, was: V | undefined) => L;
  readonly placesOf: (drawn: L, held: ReadonlyMap<string, P>) => ReadonlyMap<string, P>;
}

export function useHeldOrder<V, P, L>(view: V, shown: boolean, order: HeldOrder<V, P, L>): L {
  const held = useRef<Held<V, P> | undefined>(undefined);
  const last = shown ? held.current : undefined;
  const places = last !== undefined && order.sameOrder(last.view, view) ? last.places : NO_PLACES;
  const drawn = order.draw(places, last?.view);
  useLayoutEffect(() => {
    held.current = shown ? { view, places: order.placesOf(drawn, places) } : undefined;
    return () => {
      held.current = undefined;
    };
  });
  return drawn;
}
