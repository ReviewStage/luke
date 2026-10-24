// @vitest-environment jsdom

import assert from "node:assert/strict";
import { HOST_CAPABILITY, type HostCapability, type ZoomPercent } from "@luke/settings";
import { ACTION_RESULT_STATUS } from "@luke/wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { useAppKeymap } from "./app-commands.js";
import { fakeAppPlatform } from "./testing/app-platform.js";
import { DESKTOP_CAPABILITIES, handCapabilities } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { useWindowZoom } from "./window-zoom.js";

/**
 * window-zoom.test.ts -- ⌘+, ⌘−, and ⌘0 are the desktop's: its window zooms,
 * so its keymap claims them, and the web's leaves them to the browser's own
 * zoom, which they would otherwise be taken from for nothing.
 */

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** A window at 100% whose zoom keys write into `writes`. */
function ZoomWindow({ writes }: { writes: ZoomPercent[] }): ReactElement | null {
  useAppKeymap(true);
  useWindowZoom(100, (zoom) => {
    writes.push(zoom);
    return Promise.resolve({ status: ACTION_RESULT_STATUS.ACCEPTED });
  });
  return null;
}

/** Draws the window on a platform offering `capabilities`, once its document has arrived. */
async function drawOn(
  capabilities: readonly HostCapability[],
  writes: ZoomPercent[],
): Promise<void> {
  fakeAppPlatform({});
  handCapabilities(capabilities);
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  await act(async () => {
    root.render(onRegistry(AtomRegistry.make(), createElement(ZoomWindow, { writes })));
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** Presses ⌘ and `key`, answering the event, so a test reads whether the window took it. */
function pressCommand(key: string, code: string): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    code,
    metaKey: true,
    bubbles: true,
    cancelable: true,
  });
  act(() => {
    document.body.dispatchEvent(event);
  });
  return event;
}

const ZOOM_KEYS = [
  { name: "⌘+", key: "+", code: "Equal", zoom: 110 },
  { name: "⌘−", key: "-", code: "Minus", zoom: 90 },
] as const;

const WEB_CAPABILITIES = DESKTOP_CAPABILITIES.filter(
  (each) => each !== HOST_CAPABILITY.DESKTOP_APP,
);

for (const { name, key, code, zoom } of ZOOM_KEYS) {
  test(`${name} is left to the browser's own zoom on the web`, async () => {
    const writes: ZoomPercent[] = [];
    await drawOn(WEB_CAPABILITIES, writes);
    assert.equal(pressCommand(key, code).defaultPrevented, false);
    assert.deepEqual(writes, []);
  });

  test(`${name} zooms the desktop and is taken by its keymap`, async () => {
    const writes: ZoomPercent[] = [];
    await drawOn(DESKTOP_CAPABILITIES, writes);
    assert.equal(pressCommand(key, code).defaultPrevented, true);
    assert.deepEqual(writes, [zoom]);
  });
}
