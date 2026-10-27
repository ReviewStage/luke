// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DEVICE_STANDING } from "@luke/features/coding-agent-wire";
import { DEVICE_PRESENCE_MAX_IDS } from "@luke/features/host-wire";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { presenceStanding, useDevicePresence } from "./device-presence.js";
import { fakeActPort } from "./testing/app-bridge.js";
import { onRegistry } from "./testing/copy-feedback.js";

/**
 * device-presence.test.ts -- the shared presence reads every device a surface draws, however many, and judges each by the service's own count of how long ago it beat, never by comparing two wall clocks.
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
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.replaceChildren();
});

/** The id of the nth synthetic device. */
const deviceOf = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

const MANY = Array.from({ length: DEVICE_PRESENCE_MAX_IDS + 6 }, (_, n) => deviceOf(n));

/** What a surface draws of each device it names: its standing as the shared book says it. */
function Standings({ ids }: { ids: readonly string[] }): React.JSX.Element {
  const book = useDevicePresence(ids);
  return createElement("p", null, ids.map((id) => presenceStanding(book, id)).join(","));
}

/** Draws `ids` under one registry and lets the reads land; answers the container and a way to draw other ids. */
async function draw(ids: readonly string[]) {
  const registry = AtomRegistry.make();
  registries.push(registry);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  const render = async (next: readonly string[]) => {
    act(() => root.render(onRegistry(registry, createElement(Standings, { ids: next }))));
    await act(async () => {
      for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
    });
  };
  await render(ids);
  return { container, render };
}

/** The service answering each device named as `ageMs` old. */
const answeringAge = (ageMs: (id: string) => number) => ({
  [ACT_KIND.HOSTS_PRESENCE]: (payload: { ids: readonly string[] }) =>
    Promise.resolve({
      devices: payload.ids.map((deviceId) => ({ deviceId, ageMs: ageMs(deviceId) })),
    }),
});

test("more devices than one read takes are all read, in batches", async () => {
  const sizes: number[] = [];
  fakeActPort({
    [ACT_KIND.HOSTS_PRESENCE]: (payload: { ids: readonly string[] }) => {
      sizes.push(payload.ids.length);
      return Promise.resolve({
        devices: payload.ids.map((deviceId) => ({ deviceId, ageMs: 1_000 })),
      });
    },
  });
  const { container } = await draw(MANY);

  assert.deepEqual(
    sizes.sort((a, b) => b - a),
    [DEVICE_PRESENCE_MAX_IDS, MANY.length - DEVICE_PRESENCE_MAX_IDS],
  );
  assert.ok(
    container.textContent?.split(",").every((each) => each === DEVICE_STANDING.ONLINE),
    "every device named in either batch reads online",
  );
});

test("a batch that fails leaves only its own devices unknown", async () => {
  const last = MANY[MANY.length - 1] ?? "";
  fakeActPort({
    [ACT_KIND.HOSTS_PRESENCE]: (payload: { ids: readonly string[] }) =>
      payload.ids.includes(last)
        ? Promise.reject(new Error("the service did not answer"))
        : Promise.resolve({
            devices: payload.ids.map((deviceId) => ({ deviceId, ageMs: 90_000 })),
          }),
  });
  const { container } = await draw(MANY);
  const standings = container.textContent?.split(",") ?? [];

  assert.equal(
    standings[0],
    DEVICE_STANDING.OFFLINE,
    "a device whose batch answered reads offline",
  );
  assert.equal(standings[standings.length - 1], DEVICE_STANDING.UNKNOWN);
});

test("a window whose clock is five minutes off still reads a beating device online", async () => {
  fakeActPort(answeringAge(() => 5_000));
  const real = Date.now();
  for (const skew of [5 * 60_000, -5 * 60_000]) {
    vi.spyOn(Date, "now").mockReturnValue(real + skew);
    const { container } = await draw([deviceOf(1)]);
    assert.equal(container.textContent, DEVICE_STANDING.ONLINE, `skew ${skew}`);
  }
});

test("a beat delayed by 25 seconds still reads online, and a device quiet for four beats reads offline", async () => {
  fakeActPort(answeringAge((id) => (id === deviceOf(1) ? 25_000 + 15_000 : 61_000)));
  const { container } = await draw([deviceOf(1), deviceOf(2)]);

  assert.equal(container.textContent, `${DEVICE_STANDING.ONLINE},${DEVICE_STANDING.OFFLINE}`);
});

test("drawing another device does not make the first one's standing unknown while the read restarts", async () => {
  const first = deviceOf(1);
  const second = deviceOf(2);
  fakeActPort({
    [ACT_KIND.HOSTS_PRESENCE]: (payload: { ids: readonly string[] }) =>
      payload.ids.length === 1
        ? Promise.resolve({ devices: [{ deviceId: first, ageMs: 1_000 }] })
        : new Promise(() => undefined),
  });
  const { container, render } = await draw([first]);
  assert.equal(container.textContent, DEVICE_STANDING.ONLINE);

  await render([first, second]);

  assert.equal(container.textContent?.split(",")[0], DEVICE_STANDING.ONLINE);
});
