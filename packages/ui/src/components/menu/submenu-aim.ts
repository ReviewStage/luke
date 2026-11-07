/**
 * submenu-aim.ts -- a submenu left standing while the pointer heads for it across its menu's other rows.
 *
 * A system menu's submenu does not give way to every row the pointer
 * crosses on its way there, and neither does a menu of ours: `Menu`'s
 * submenus and panels and `SearchableMenu`'s submenus all keep the same rule
 * through `useSubmenuAim`. The pointer's move onto another row is put off
 * while the pointer heads into the submenu standing beside its row: while
 * each move lands inside the triangle from where it was to the submenu's
 * near edge, however slowly. It is taken once the pointer rests there
 * (`AIM_REST`), since a pointer that stopped on that row means it, or at once
 * where the pointer turns away from the submenu; reaching the submenu drops
 * it. A row whose own submenu the move would open waits for the pointer to
 * rest on it too, so passing over it on the way elsewhere opens nothing.
 */

import { Duration, Effect } from "effect";
import { useCallback, useEffect, useRef } from "react";
import { makeWait } from "../../wait.js";

/** How long the pointer rests on a row before that row takes it from a submenu, or opens its own: as long as Base UI waits to open a submenu. */
const AIM_REST = Duration.millis(100);

/** How far past the submenu's top and foot a move still heads into it, in CSS pixels, so a hand's slight arc toward its first or last row counts. */
const AIM_GIVE = 6;

/** A point in the window, in CSS pixels. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A move put off: what it takes; whether it waits on the pointer heading
 * into the submenu standing (`aiming`); and, where it opens the submenu of
 * the row it landed on, that row, which it waits on only while the pointer
 * stays there.
 */
interface PutOff {
  readonly take: () => void;
  readonly aiming: boolean;
  readonly opening: Element | undefined;
}

/** The window's one put-off move: taken once the pointer has rested `AIM_REST`, each new one calling off the last. */
const aimRest = makeWait();

/** Which side of the line from `a` to `b` the point `p` stands on: its sign. */
function sideOf(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/**
 * Whether a move from `from` to `to` heads into `box`: `to` stands in the
 * triangle from `from` to the box's near edge, stretched `AIM_GIVE` past its
 * top and foot, as a pointer making for any row of a submenu beside it passes.
 */
function headsInto(from: Point, to: Point, box: DOMRectReadOnly): boolean {
  const near = from.x <= box.left ? box.left : box.right;
  const top = { x: near, y: box.top - AIM_GIVE };
  const bottom = { x: near, y: box.bottom + AIM_GIVE };
  const sides = [sideOf(from, top, to), sideOf(top, bottom, to), sideOf(bottom, from, to)];
  return sides.every((side) => side >= 0) || sides.every((side) => side <= 0);
}

/**
 * The gate a menu hands each move of the pointer onto one of its rows
 * through while a submenu stands (`standing`) on `submenu`: put off for the
 * pointer's next moves to decide, taken once it rests, or at once where it
 * turns away from the submenu. Note that the next moves decide rather than
 * the last, because a browser tells a row the pointer arrived before it
 * tells the window the move that brought it there. A move that opens the
 * submenu of the row it landed on names that row (`opening`), and is put
 * off until the pointer rests there, dropped where it leaves the row first.
 * A key, the pointer reaching the submenu, or the submenu going drops a
 * move put off.
 */
export function useSubmenuAim(
  submenu: React.RefObject<HTMLElement | null>,
  standing: boolean,
): (take: () => void, opening?: Element) => void {
  const last = useRef<Point | undefined>(undefined);
  const putOff = useRef<PutOff | undefined>(undefined);
  const drop = useCallback(() => {
    putOff.current = undefined;
    aimRest.stop();
  }, []);
  // Note that putting a move off again restarts its rest, since the wait calls off the last.
  const rest = useCallback((move: PutOff) => {
    putOff.current = move;
    aimRest.start(
      Effect.andThen(
        Effect.sleep(AIM_REST),
        Effect.sync(() => {
          putOff.current = undefined;
          move.take();
        }),
      ),
    );
  }, []);
  // Note that the pointer is followed for as long as the menu stands, a
  // submenu or none, so the first move after the one that opened a submenu
  // already has where it came from. A move heading on into the submenu
  // restarts the rest of the move put off; one turning away takes it at
  // once, or leaves it waiting on its row where it opens that row's own.
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
  // Note that a row's own submenu still opens once the pointer rests on it with none standing.
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
