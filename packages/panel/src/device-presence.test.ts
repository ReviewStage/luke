// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DEVICE_PRESENCE_MAX_IDS } from "@luke/features/host-wire";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { useDevicePresence } from "./device-presence.js";
import { fakeActPort } from "./testing/app-bridge.js";
import { onRegistry } from "./testing/copy-feedback.js";

/**
 * device-presence.test.ts -- the shared presence reads every device a surface draws, however many, in batches the service takes.
 * Synthetic ids.
 */

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.replaceChildren();
});

/** The id of the nth synthetic device. */
const deviceOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const IDS = Array.from({ length: DEVICE_PRESENCE_MAX_IDS + 6 }, (_, n) => deviceOf(n));

function Beats(): React.JSX.Element {
  const book = useDevicePresence(IDS);
  return createElement("p", null, String(book.beats.size));
}

test("more devices than one read takes are all read, in batches, and every beat lands", async () => {
  const sizes: number[] = [];
  fakeActPort({
    [ACT_KIND.HOSTS_PRESENCE]: (payload: { ids: readonly string[] }) => {
      sizes.push(payload.ids.length);
      return Promise.resolve({
        devices: payload.ids.map((deviceId) => ({ deviceId, seenAt: Date.now() })),
      });
    },
  });
  const registry = AtomRegistry.make();
  registries.push(registry);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(registry, createElement(Beats))));
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });

  assert.deepEqual(
    sizes.sort((a, b) => b - a),
    [DEVICE_PRESENCE_MAX_IDS, IDS.length - DEVICE_PRESENCE_MAX_IDS],
  );
  assert.equal(container.textContent, String(IDS.length));
});
