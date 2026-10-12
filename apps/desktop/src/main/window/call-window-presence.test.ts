import assert from "node:assert/strict";
import { LIVE_STATUS, type LiveStatus } from "@sidecar/live";
import type { WebContents } from "electron";
import { test } from "vitest";
import { CALL_WINDOW_BOUNDS, CallWindowPresence, callWindowPosition } from "./call-window-presence";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";

/** A laptop's work area under its menu bar, and a second display to its right. */
const LAPTOP = { x: 0, y: 25, width: 1512, height: 920 };
const MONITOR = { x: 1512, y: 0, width: 2560, height: 1415 };

function presence() {
  const window = { standing: false, shows: 0 };
  const subject = new CallWindowPresence({
    show: () => {
      window.standing = true;
      window.shows += 1;
    },
    hide: () => {
      window.standing = false;
    },
  });
  return { subject, window };
}

/** A panel's renderer, which the presence knows by identity alone. */
function panel(): WebContents {
  // SAFETY: the presence compares panels by identity and reads nothing off one.
  return {} as WebContents;
}

const call = (voiceStatus: LiveStatus, callPlanId: string | undefined = INVITES) => ({
  voiceStatus,
  callPlanId,
});

test("the floating card stands while a call is in progress and no Luke window has the keyboard", () => {
  const { subject, window } = presence();
  const luke = panel();
  subject.panelFocused(luke);
  subject.voiceChanged(call(LIVE_STATUS.CONNECTING));
  // Luke's own window draws the call while it has the keyboard.
  assert.equal(window.standing, false);

  // Another app in front, or Luke minimised or hidden.
  subject.panelBlurred(luke);
  assert.equal(window.standing, true);
  subject.panelFocused(luke);
  assert.equal(window.standing, false);
});

test("the floating card goes with the call, and is told only when its answer changes", () => {
  const { subject, window } = presence();
  subject.voiceChanged(call(LIVE_STATUS.IDLE, undefined));
  assert.equal(window.standing, false);
  subject.voiceChanged(call(LIVE_STATUS.LISTENING));
  subject.voiceChanged(call(LIVE_STATUS.MUTED));
  subject.voiceChanged(call(LIVE_STATUS.SPEAKING));
  assert.equal(window.shows, 1);
  subject.voiceChanged(call(LIVE_STATUS.CLOSING));
  assert.equal(window.standing, false);
  subject.voiceChanged(call(LIVE_STATUS.LISTENING));
  subject.voiceChanged(undefined);
  assert.equal(window.standing, false);
});

test("the keyboard moving between two Luke windows never raises the floating card", () => {
  const { subject, window } = presence();
  const laptop = panel();
  const monitor = panel();
  subject.panelFocused(laptop);
  subject.voiceChanged(call(LIVE_STATUS.LISTENING));
  // The focus lands on the other window before the first one's blur arrives.
  subject.panelFocused(monitor);
  subject.panelBlurred(laptop);
  assert.equal(window.standing, false);
  assert.equal(window.shows, 0);
});

test("the card opens where it was left while that place is on a display, and at the main display's bottom left otherwise", () => {
  const onMonitor = { x: 3000, y: 600 };
  assert.deepEqual(
    callWindowPosition({ saved: onMonitor, workAreas: [LAPTOP, MONITOR], primary: LAPTOP }),
    onMonitor,
  );
  const corner = {
    x: LAPTOP.x + CALL_WINDOW_BOUNDS.INSET,
    y: LAPTOP.y + LAPTOP.height - CALL_WINDOW_BOUNDS.HEIGHT - CALL_WINDOW_BOUNDS.INSET,
  };
  // The monitor unplugged, and a place hanging off the laptop's edge.
  assert.deepEqual(
    callWindowPosition({ saved: onMonitor, workAreas: [LAPTOP], primary: LAPTOP }),
    corner,
  );
  assert.deepEqual(
    callWindowPosition({ saved: { x: 1500, y: 100 }, workAreas: [LAPTOP], primary: LAPTOP }),
    corner,
  );
  assert.deepEqual(
    callWindowPosition({ saved: undefined, workAreas: [LAPTOP], primary: LAPTOP }),
    corner,
  );
});
