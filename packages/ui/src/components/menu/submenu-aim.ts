import { useAtomSet } from "@effect/atom-react";
import { Duration, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useEffect, useRef } from "react";

const AIM_REST = Duration.millis(100);

const AIM_GIVE = 6;

interface Point {
  readonly x: number;
  readonly y: number;
}

interface PutOff {
  readonly take: () => void;
  readonly aiming: boolean;
  readonly opening: Element | undefined;
}

const aimRestAtom = Atom.fn(({ take }: { readonly take: () => void }) =>
  Effect.andThen(Effect.sleep(AIM_REST), Effect.sync(take)),
);

function sideOf(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

function headsInto(from: Point, to: Point, box: DOMRectReadOnly): boolean {
  const near = from.x <= box.left ? box.left : box.right;
  const top = { x: near, y: box.top - AIM_GIVE };
  const bottom = { x: near, y: box.bottom + AIM_GIVE };
  const sides = [sideOf(from, top, to), sideOf(top, bottom, to), sideOf(bottom, from, to)];
  return sides.every((side) => side >= 0) || sides.every((side) => side <= 0);
}

export function useSubmenuAim(
  submenu: React.RefObject<HTMLElement | null>,
  standing: boolean,
): (take: () => void, opening?: Element) => void {
  const last = useRef<Point | undefined>(undefined);
  const putOff = useRef<PutOff | undefined>(undefined);
  const wait = useAtomSet(aimRestAtom);
  const drop = useCallback(() => {
    putOff.current = undefined;
    wait(Atom.Interrupt);
  }, [wait]);
  const rest = useCallback(
    (move: PutOff) => {
      putOff.current = move;
      wait({
        take: () => {
          putOff.current = undefined;
          move.take();
        },
      });
    },
    [wait],
  );
  useEffect(() => {
    const moved = (event: MouseEvent) => {
      const from = last.current;
      const to = { x: event.clientX, y: event.clientY };
      last.current = to;
      const move = putOff.current;
      if (move === undefined) return;
      const target = event.target instanceof Node ? event.target : null;
      if (!move.aiming) {
        if (move.opening?.contains(target) !== true) drop();
        return;
      }
      const surface = submenu.current;
      if (surface === null || surface.contains(target)) return drop();
      if (from !== undefined && headsInto(from, to, surface.getBoundingClientRect())) {
        return rest(move);
      }
      if (move.opening !== undefined) return rest({ ...move, aiming: false });
      drop();
      move.take();
    };
    document.addEventListener("mousemove", moved, true);
    document.addEventListener("keydown", drop, true);
    return () => {
      document.removeEventListener("mousemove", moved, true);
      document.removeEventListener("keydown", drop, true);
      drop();
    };
  }, [submenu, drop, rest]);
  useEffect(() => {
    if (!standing && putOff.current?.aiming === true) drop();
  }, [standing, drop]);
  return useCallback(
    (take: () => void, opening?: Element) => {
      if (standing && submenu.current !== null) return rest({ take, aiming: true, opening });
      if (opening !== undefined) return rest({ take, aiming: false, opening });
      drop();
      take();
    },
    [standing, submenu, drop, rest],
  );
}
