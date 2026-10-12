/**
 * window-zoom.ts -- the window's zoom as the page meets it: ⌘+, ⌘−, and ⌘0 stepping the one stored size Settings' pop-up writes too, and the size told to the CSS.
 *
 * The keys write the setting rather than zooming the page themselves, so a
 * press and a pick are one value: main zooms every panel from the settings it
 * publishes, and the next press steps from whatever that value is now. A
 * step that would go past the smallest or largest size is not offered, so
 * the key falls through to nothing and the command palette leaves it out.
 */

import {
  ZOOM_ACTUAL_SIZE,
  ZOOM_STEP,
  type ZoomPercent,
  zoomFactor,
  zoomStepped,
} from "@sidecar/settings";
import { useLayoutEffect } from "react";
import { APP_COMMAND } from "#shared/shortcuts";
import { useAppCommand } from "./app-commands";

/** The custom property desktop.css divides the traffic lights' width by, since the page zoom does not scale them. */
const ZOOM_PROPERTY = "--zoom";

/** A write of the size `next` steps to, or nothing when that is the size standing. */
function offerOf(
  zoom: ZoomPercent | undefined,
  next: (zoom: ZoomPercent) => ZoomPercent,
  write: (zoom: ZoomPercent) => void,
): (() => void) | undefined {
  if (zoom === undefined) return undefined;
  const target = next(zoom);
  return target === zoom ? undefined : () => write(target);
}

/**
 * Offers the zoom commands over the stored size, `undefined` until the
 * settings have arrived, and keeps `--zoom` on the document's root at it.
 */
export function useWindowZoom(
  zoom: ZoomPercent | undefined,
  write: (zoom: ZoomPercent) => void,
): void {
  useAppCommand(
    APP_COMMAND.ZOOM_IN,
    offerOf(zoom, (at) => zoomStepped(at, ZOOM_STEP.IN), write),
  );
  useAppCommand(
    APP_COMMAND.ZOOM_OUT,
    offerOf(zoom, (at) => zoomStepped(at, ZOOM_STEP.OUT), write),
  );
  useAppCommand(
    APP_COMMAND.ACTUAL_SIZE,
    offerOf(zoom, () => ZOOM_ACTUAL_SIZE, write),
  );
  // A layout effect, so the title bar is laid out at the new clearance in
  // the same frame the size first draws in.
  useLayoutEffect(() => {
    const root = document.documentElement;
    root.style.setProperty(ZOOM_PROPERTY, String(zoomFactor(zoom ?? ZOOM_ACTUAL_SIZE)));
  }, [zoom]);
}
