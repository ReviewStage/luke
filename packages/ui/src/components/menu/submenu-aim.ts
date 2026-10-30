/**
 * submenu-aim.ts -- a submenu left standing while the pointer heads for it across its menu's other rows.
 *
 * A system menu's submenu does not give way to every row the pointer
 * crosses on its way there, and neither does `Menu`'s, which Base UI's safe
 * polygon keeps. A menu that hangs its submenus itself, as `SearchableMenu`
 * does, keeps the same rule through `useSubmenuAim`: the pointer's move onto
 * another row is put off while that move heads into the submenu standing
 * beside its row, and taken only once the pointer rests there (`AIM_REST`),
 * since a pointer that stopped on that row means it; reaching the submenu
 * drops it.
 */

import { useAtomSet } from "@effect/atom-react";
import { Duration, Effect } from "effect";
import * as Atom from "effect/reactivity/Atom";
import { useCallback, useEffect, useRef } from "react";

/** How long a pointer heading for a submenu rests on another row before that row takes it: as long as Base UI waits to open a `Menu`'s submenu. */
const AIM_REST = Duration.millis(100);

/** A point in the window, in CSS pixels. */
interface Point {
  readonly x: number;
  readonly y: number;
}

/** Where the pointer was before its last move, and where that move took it. */
interface Trail {
  readonly from: Point | undefined;
  readonly to: Point | undefined;
}

const NO_TRAIL: Trail = { from: undefined, to: undefined };

/**
 * The window's one put-off move: taken once the pointer has rested
 * `AIM_REST`, each new one calling off the last. Note that the move is
 * handed inside a record, as a hint's way up is (`hint.tsx`).
 */
const aimRestAtom = Atom.fn(({ take }: { readonly take: () => void }) =>
  Effect.andThen(Effect.sleep(AIM_REST), Effect.sync(take)),
);

/** Which side of the line from `a` to `b` the point `p` stands on: its sign. */
function sideOf(a: Point, b: Point, p: Point): number {
  return (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x);
}

/** Whether `point` stands in `box`, its edges included. */
function inBox(point: Point, box: DOMRectReadOnly): boolean {
  return point.x >= box.left && point.x <= box.right && point.y >= box.top && point.y <= box.bottom;
}

/**
 * Whether a move from `from` to `to` heads into `box`: `to` stands in the
 * triangle from `from` to the box's near edge, as a pointer making for any
 * row of a submenu beside it passes.
 */
function headsInto(from: Point, to: Point, box: DOMRectReadOnly): boolean {
  const near = from.x <= box.left ? box.left : box.right;
  const top = { x: near, y: box.top };
  const bottom = { x: near, y: box.bottom };
  const sides = [sideOf(from, top, to), sideOf(top, bottom, to), sideOf(bottom, from, to)];
  return sides.every((side) => side >= 0) || sides.every((side) => side <= 0);
}

/**
 * The gate a menu hands each move of the pointer onto one of its rows
 * through while a submenu stands (`standing`) on `submenu`: taken at once,
 * unless the pointer's last move heads into the submenu, when it is put off
 * until the pointer rests. A key, or the pointer reaching the submenu, drops
 * a move put off.
 */
export function useSubmenuAim(
  submenu: React.RefObject<HTMLElement | null>,
  standing: boolean,
): (take: () => void) => void {
  const trail = useRef<Trail>(NO_TRAIL);
  const wait = useAtomSet(aimRestAtom);
  // Note that the window's moves are heard before a row's own, so a row reads the move that brought the pointer onto it.
  useEffect(() => {
    if (!standing) return undefined;
    const moved = (event: MouseEvent) => {
      const to = { x: event.clientX, y: event.clientY };
      trail.current = { from: trail.current.to, to };
      const box = submenu.current?.getBoundingClientRect();
      if (box !== undefined && inBox(to, box)) wait(Atom.Interrupt);
    };
    const keyed = () => wait(Atom.Interrupt);
    document.addEventListener("mousemove", moved, true);
    document.addEventListener("keydown", keyed, true);
    return () => {
      document.removeEventListener("mousemove", moved, true);
      document.removeEventListener("keydown", keyed, true);
      trail.current = NO_TRAIL;
      wait(Atom.Interrupt);
    };
  }, [standing, submenu, wait]);
  return useCallback(
    (take: () => void) => {
      const { from, to } = trail.current;
      const box = submenu.current?.getBoundingClientRect();
      const aimed =
        standing &&
        from !== undefined &&
        to !== undefined &&
        box !== undefined &&
        headsInto(from, to, box);
      if (aimed) {
        wait({ take });
        return;
      }
      wait(Atom.Interrupt);
      take();
    },
    [standing, submenu, wait],
  );
}
