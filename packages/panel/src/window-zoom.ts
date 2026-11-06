import { FAILURE_SURFACE } from "@repo/features/shown-failure";
import {
  HOST_CAPABILITY,
  ZOOM_ACTUAL_SIZE,
  ZOOM_STEP,
  type ZoomPercent,
  zoomFactor,
  zoomStepped,
} from "@repo/settings";
import { APP_COMMAND } from "@repo/settings/shortcuts";
import { STATUS_TONE } from "@repo/ui";
import { ACTION_RESULT_STATUS, type ActionResult } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import { useLayoutEffect, useRef } from "react";
import { useAppCommand } from "./app-commands.js";
import { showToast, TOAST_HOLD } from "./toast.js";
import { appStateQuery, selectCapability } from "./use-app-state.js";

const ZOOM_PROPERTY = "--zoom";

const ZOOM_REFUSED = "The window could not be zoomed. Try again.";

export function useWindowZoom(
  zoom: ZoomPercent | undefined,
  write: (zoom: ZoomPercent) => Promise<ActionResult>,
): void {
  const asked = useRef<ZoomPercent | undefined>(undefined);
  const desktopApp =
    useQuery({ ...appStateQuery, select: selectCapability(HOST_CAPABILITY.DESKTOP_APP) }).data ===
    true;

  const offerOf = (next: (from: ZoomPercent) => ZoomPercent): (() => void) | undefined => {
    if (!desktopApp || zoom === undefined || next(zoom) === zoom) return undefined;
    return () => {
      const target = next(asked.current ?? zoom);
      if (target === (asked.current ?? zoom)) return;
      asked.current = target;
      void write(target).then((result) => {
        if (result.status === ACTION_RESULT_STATUS.ACCEPTED) return;
        showToast({
          words: ZOOM_REFUSED,
          tone: STATUS_TONE.DANGER,
          hold: TOAST_HOLD.FAILED,
          failure: { surface: FAILURE_SURFACE.WINDOW_ZOOM, cause: result },
        });
        if (asked.current === target) asked.current = undefined;
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
  useLayoutEffect(() => {
    if (asked.current === zoom) asked.current = undefined;
    const root = document.documentElement;
    root.style.setProperty(ZOOM_PROPERTY, String(zoomFactor(zoom ?? ZOOM_ACTUAL_SIZE)));
  }, [zoom]);
}
