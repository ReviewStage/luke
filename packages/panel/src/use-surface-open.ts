import {
  PRODUCT_LAYOUT,
  PRODUCT_SURFACE_EVENT,
  type ProductLayout,
  type ProductSurface,
} from "@repo/features/analytics";
import { useEffect, useRef } from "react";
import { appPlatform } from "./app-platform.js";
import { SHELL_ROOM, type ShellRoom } from "./shell-room.js";

export interface OpenSurface {
  readonly surface: ProductSurface;
  readonly of?: string | undefined;
  readonly side?: boolean | undefined;
}

const LAYOUT_OF_ROOM = {
  [SHELL_ROOM.WIDE]: PRODUCT_LAYOUT.WIDE,
  [SHELL_ROOM.NARROW]: PRODUCT_LAYOUT.NARROW,
} as const satisfies Record<ShellRoom, ProductLayout>;

function sameSurface(one: OpenSurface, other: OpenSurface): boolean {
  return one.surface === other.surface && one.of === other.of && one.side === other.side;
}

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
