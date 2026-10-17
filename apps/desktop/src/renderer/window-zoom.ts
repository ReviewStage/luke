/**
 * window-zoom.ts -- the window's zoom as the page meets it: ⌘+, ⌘−, and ⌘0 stepping the one stored size Settings' pop-up writes too, and the size told to the CSS.
 *
 * The keys write the setting rather than zooming the page themselves, so a
 * press and a pick are one value: main zooms every panel from the settings it
 * publishes, and the next press steps from whatever that value is now. A
 * press landing before the last one's write has come back steps from the
 * size that write asked for, so two quick presses are two steps. A step that
 * would go past the smallest or largest size is not offered, so the key falls
 * through to nothing and the command palette leaves it out.
 */

import {
  ZOOM_ACTUAL_SIZE,
  ZOOM_STEP,
  type ZoomPercent,
  zoomFactor,
  zoomStepped,
} from "@luke/settings";
import { APP_COMMAND } from "@luke/settings/shortcuts";
import { ACTION_RESULT_STATUS, type ActionResult } from "@luke/wire";
import { useLayoutEffect, useRef } from "react";
import { useAppCommand } from "./app-commands";

/** The custom property desktop.css divides the traffic lights' width by, since the page zoom does not scale them. */
const ZOOM_PROPERTY = "--zoom";

/**
 * Offers the zoom commands over the stored size, `undefined` until the
 * settings have arrived, and keeps `--zoom` on the document's root at it.
 */
export function useWindowZoom(
  zoom: ZoomPercent | undefined,
  write: (zoom: ZoomPercent) => Promise<ActionResult>,
): void {
  // The size a press asked for that the settings do not say yet.
  const asked = useRef<ZoomPercent | undefined>(undefined);

  /** A write of the size `next` steps to from the latest size asked for, or nothing at that size already. */
  const offerOf = (next: (from: ZoomPercent) => ZoomPercent): (() => void) | undefined => {
    if (zoom === undefined || next(zoom) === zoom) return undefined;
    return () => {
      const target = next(asked.current ?? zoom);
      if (target === (asked.current ?? zoom)) return;
      asked.current = target;
      void write(target).then((result) => {
        // Note that a refused size is forgotten, because no snapshot will
        // ever arrive saying it.
        if (result.status !== ACTION_RESULT_STATUS.ACCEPTED && asked.current === target) {
          asked.current = undefined;
        }
      });
    };
  };
  useAppCommand(
    APP_COMMAND.ZOOM_IN,
    offerOf((from) => zoomStepped(from, ZOOM_STEP.IN)),
  );
  useAppCommand(
    APP_COMMAND.ZOOM_OUT,
    offerOf((from) => zoomStepped(from, ZOOM_STEP.OUT)),
  );
  useAppCommand(
    APP_COMMAND.ACTUAL_SIZE,
    offerOf(() => ZOOM_ACTUAL_SIZE),
  );
  // A layout effect, so the title bar is laid out at the new clearance in
  // the same frame the size first draws in. The settings saying the size a
  // press asked for is that press come back.
  useLayoutEffect(() => {
    if (asked.current === zoom) asked.current = undefined;
    const root = document.documentElement;
    root.style.setProperty(ZOOM_PROPERTY, String(zoomFactor(zoom ?? ZOOM_ACTUAL_SIZE)));
  }, [zoom]);
}
