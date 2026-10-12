import assert from "node:assert/strict";
import { LIVE_STATUS, type LiveStatus } from "@sidecar/live";
import type { WebContents } from "electron";
import { test } from "vitest";
import { CALL_WINDOW_BOUNDS, CallWindowPresence, callWindowPosition } from "./call-window-presence";

const INVITES = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const BILLING = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

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

test("the pill stands while a call is in progress and no focused panel shows its plan", () => {
  const { subject, window } = presence();
  const luke = panel();
  subject.voiceChanged(call(LIVE_STATUS.IDLE, undefined));
  assert.equal(window.standing, false);

  subject.voiceChanged(call(LIVE_STATUS.CONNECTING));
  assert.equal(window.standing, true);

  // The call's own plan in the focused panel: the call bar is there instead.
  subject.planShown(luke, INVITES);
  subject.panelFocused(luke);
  assert.equal(window.standing, false);

  // Settings or the new-plan page, and another plan, each take the plan off screen.
  subject.planShown(luke, undefined);
  assert.equal(window.standing, true);
  subject.planShown(luke, BILLING);
  assert.equal(window.standing, true);

  // The plan back on screen, then another app in front of it.
  subject.planShown(luke, INVITES);
  assert.equal(window.standing, false);
  subject.panelBlurred(luke);
  assert.equal(window.standing, true);
});

test("the pill goes with the call, whatever is on screen", () => {
  const { subject, window } = presence();
  subject.voiceChanged(call(LIVE_STATUS.LISTENING));
  assert.equal(window.standing, true);
  subject.voiceChanged(call(LIVE_STATUS.MUTED));
  subject.voiceChanged(call(LIVE_STATUS.SPEAKING));
  assert.equal(window.shows, 1);
  subject.voiceChanged(call(LIVE_STATUS.CLOSING));
  assert.equal(window.standing, false);
  subject.voiceChanged(call(LIVE_STATUS.LISTENING));
  subject.voiceChanged(undefined);
  assert.equal(window.standing, false);
});

test("only the focused panel's plan counts: another display's panel showing it does not stand the pill down", () => {
  const { subject, window } = presence();
  const laptop = panel();
  const monitor = panel();
  subject.voiceChanged(call(LIVE_STATUS.LISTENING));
  subject.planShown(monitor, INVITES);
  subject.planShown(laptop, BILLING);
  subject.panelFocused(laptop);
  assert.equal(window.standing, true);
  subject.panelFocused(monitor);
  assert.equal(window.standing, false);
  // A blur arriving late from the panel no longer focused changes nothing.
  subject.panelBlurred(laptop);
  assert.equal(window.standing, false);
});

test("the pill opens where it was left while that place is on a display, and at the main display's top right otherwise", () => {
  const onMonitor = { x: 3000, y: 600 };
  assert.deepEqual(
    callWindowPosition({ saved: onMonitor, workAreas: [LAPTOP, MONITOR], primary: LAPTOP }),
    onMonitor,
  );
  const corner = {
    x: LAPTOP.width - CALL_WINDOW_BOUNDS.WIDTH - CALL_WINDOW_BOUNDS.INSET,
    y: LAPTOP.y + CALL_WINDOW_BOUNDS.INSET,
  };
  // The monitor unplugged, and a place hanging off the laptop's edge.
  assert.deepEqual(
    callWindowPosition({ saved: onMonitor, workAreas: [LAPTOP], primary: LAPTOP }),
    corner,
  );
  assert.deepEqual(
    callWindowPosition({ saved: { x: 1400, y: 100 }, workAreas: [LAPTOP], primary: LAPTOP }),
    corner,
  );
  assert.deepEqual(
    callWindowPosition({ saved: undefined, workAreas: [LAPTOP], primary: LAPTOP }),
    corner,
  );
});
