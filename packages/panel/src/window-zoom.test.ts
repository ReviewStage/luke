// @vitest-environment jsdom

import assert from "node:assert/strict";
import { HOST_CAPABILITY, type HostCapability, type ZoomPercent } from "@repo/settings";
import { ACTION_RESULT_STATUS } from "@repo/wire";
import { useQuery } from "@tanstack/react-query";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, test, vi } from "vitest";
import { useAppKeymap } from "./app-commands.js";
import { rendererRegistry } from "./renderer-runtime.js";
import { fakeAppPlatform } from "./testing/app-platform.js";
import { DESKTOP_CAPABILITIES, handCapabilities } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";
import { ToastHost } from "./toast.js";
import { appStateQuery } from "./use-app-state.js";
import { useWindowZoom } from "./window-zoom.js";

/**
 * window-zoom.test.ts -- ⌘+, ⌘−, and ⌘0 are the desktop's: its window zooms,
 * so its keymap claims them, and the web's leaves them to the browser's own
 * zoom, which they would otherwise be taken from for nothing. A size the
 * settings refuse is said in a toast rather than forgotten in silence.
 */

const roots: Root[] = [];

afterEach(() => {
  act(() => {
    for (const root of roots.splice(0)) root.unmount();
  });
  document.body.innerHTML = "";
});

/** A window at 100% whose zoom keys write into `writes`, saying in `landed` whether each render held the document. */
function ZoomWindow({
  writes,
  landed,
}: {
  writes: ZoomPercent[];
  landed: boolean[];
}): ReactElement | null {
  landed.push(useQuery(appStateQuery).data !== undefined);
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
  const landed: boolean[] = [];
  act(() => {
    root.render(onRegistry(AtomRegistry.make(), createElement(ZoomWindow, { writes, landed })));
  });
  await vi.waitFor(() => expect(landed.at(-1)).toBe(true));
}

/** Presses ⌘ and `key`, answering the event, so a test reads whether the window took it. */
function pressCommand(key: string, code: string, repeat = false): KeyboardEvent {
  const event = new KeyboardEvent("keydown", {
    key,
    code,
    metaKey: true,
    repeat,
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

// Note that this test is the file's only one that presses a repeat and so the only one to read the window's capabilities outside React, which its one registry answers for every test after it.
test("a held ⌘+ keeps stepping the browser's zoom on the web, its repeats left alone too", async () => {
  await drawOn(WEB_CAPABILITIES, []);
  assert.equal(pressCommand("+", "Equal").defaultPrevented, false);
  assert.equal(pressCommand("+", "Equal", true).defaultPrevented, false);
});

/** A desktop window at 100% whose every write is refused, beside the toasts it raises. */
function RefusedZoomWindow({ landed }: { landed: boolean[] }): ReactElement {
  function Keys(): null {
    landed.push(useQuery(appStateQuery).data !== undefined);
    useAppKeymap(true);
    useWindowZoom(100, () =>
      Promise.resolve({ status: ACTION_RESULT_STATUS.REJECTED, reason: "Settings are locked." }),
    );
    return null;
  }
  return createElement(
    Fragment,
    null,
    onRegistry(AtomRegistry.make(), createElement(Keys)),
    onRegistry(rendererRegistry, createElement(ToastHost)),
  );
}

test("a zoom size the settings refuse is said in a toast", async () => {
  fakeAppPlatform({});
  handCapabilities(DESKTOP_CAPABILITIES);
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  const landed: boolean[] = [];
  act(() => {
    root.render(createElement(RefusedZoomWindow, { landed }));
  });
  await vi.waitFor(() => expect(landed.at(-1)).toBe(true));

  await act(async () => {
    pressCommand("+", "Equal");
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });

  const said = [...document.querySelectorAll(".ui-toast .ui-toast-words")].map(
    (words) => words.textContent,
  );
  assert.deepEqual(said, ["The window could not be zoomed. Try again."]);
});
