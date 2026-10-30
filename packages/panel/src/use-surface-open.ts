import {
  PRODUCT_LAYOUT,
  PRODUCT_SURFACE_EVENT,
  type ProductLayout,
  type ProductSurface,
} from "@luke/features/analytics";
import { useEffect, useRef } from "react";
import { appPlatform } from "./app-platform.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";

/**
 * use-surface-open.ts -- counts each surface of the panel as it is opened, once, from where the window's place moves.
 *
 * A surface is a kind of page or pane, never which task, agent, file, or
 * person it showed: the count carries the kind and the layout alone. `of` is
 * what tells two opens of one kind apart, so opening another task is another
 * open though no id is sent, and it never leaves this file. A surface is
 * counted as it arrives in the list and not again while it stays, so a
 * render, a room turned, or a place that moves within the surface counts
 * nothing; one left and opened again counts again.
 */

/** A surface the window shows now, and which one of its kind, which no count carries. */
export interface OpenSurface {
  readonly surface: ProductSurface;
  readonly of?: string | undefined;
}

const LAYOUT_OF_ROOM = {
  [SHELL_ROOM.WIDE]: PRODUCT_LAYOUT.WIDE,
  [SHELL_ROOM.NARROW]: PRODUCT_LAYOUT.NARROW,
} as const satisfies Record<ShellRoom, ProductLayout>;

function sameSurface(one: OpenSurface, other: OpenSurface): boolean {
  return one.surface === other.surface && one.of === other.of;
}

/** Counts each of `surfaces` that was not among those shown before, in the layout `room` gives. */
export function useSurfaceOpen(surfaces: readonly OpenSurface[], room: ShellRoom): void {
  const shown = useRef<readonly OpenSurface[]>([]);
  useEffect(() => {
    const before = shown.current;
    shown.current = surfaces;
    for (const opened of surfaces) {
      if (before.some((held) => sameSurface(held, opened))) continue;
      appPlatform().recordSurfaceEvent(PRODUCT_SURFACE_EVENT.SURFACE_OPEN, {
        surface: opened.surface,
        layout: LAYOUT_OF_ROOM[room],
      });
    }
  }, [surfaces, room]);
}
