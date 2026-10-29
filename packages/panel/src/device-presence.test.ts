// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DEVICE_STANDING } from "@luke/features/agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { presenceStanding, useDevicePresence } from "./device-presence.js";
import { fakeActPort } from "./testing/app-bridge.js";
import { onRegistry } from "./testing/copy-feedback.js";

/**
 * device-presence.test.ts -- the shared presence judges each device by the service's own count of how long ago it beat, never by comparing two wall clocks, and says it cannot check, not offline, where its read failed.
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

/** What a surface draws of each device it names: its standing as the shared book says it, or nothing where the book does not name it. */
function Standings({ ids }: { ids: readonly string[] }): React.JSX.Element {
  const book = useDevicePresence(true);
  return createElement("p", null, ids.map((id) => presenceStanding(book, id) ?? "none").join(","));
}

/** Draws the devices `ids` name under one registry and lets the read land. */
async function draw(ids: readonly string[]): Promise<HTMLElement> {
  const registry = AtomRegistry.make();
  registries.push(registry);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(registry, createElement(Standings, { ids }))));
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
  return container;
}

/** The service answering each device as `ageMs` old. */
const answeringAges = (ages: Readonly<Record<string, number>>) => ({
  [ACT_KIND.HOSTS_PRESENCE]: () =>
    Promise.resolve({
      devices: Object.entries(ages).map(([deviceId, ageMs]) => ({ deviceId, ageMs })),
    }),
});

test("a window whose clock is five minutes off still reads a beating device online", async () => {
  fakeActPort(answeringAges({ [deviceOf(1)]: 5_000 }));
  const real = Date.now();
  for (const skew of [5 * 60_000, -5 * 60_000]) {
    vi.spyOn(Date, "now").mockReturnValue(real + skew);
    const container = await draw([deviceOf(1)]);
    assert.equal(container.textContent, DEVICE_STANDING.ONLINE, `skew ${skew}`);
  }
});

test("a beat delayed by 25 seconds still reads online, and a device quiet for four beats reads offline", async () => {
  fakeActPort(answeringAges({ [deviceOf(1)]: 25_000 + 15_000, [deviceOf(2)]: 61_000 }));
  const container = await draw([deviceOf(1), deviceOf(2)]);

  assert.equal(container.textContent, `${DEVICE_STANDING.ONLINE},${DEVICE_STANDING.OFFLINE}`);
});

test("a device the service does not name as the account's own has no standing", async () => {
  fakeActPort(answeringAges({ [deviceOf(1)]: 1_000 }));
  const container = await draw([deviceOf(1), deviceOf(9)]);

  assert.equal(container.textContent, `${DEVICE_STANDING.ONLINE},none`);
});

test("a read that failed says unknown, never offline", async () => {
  fakeActPort({ [ACT_KIND.HOSTS_PRESENCE]: () => Promise.reject(new Error("no answer")) });
  const container = await draw([deviceOf(1)]);

  assert.equal(container.textContent, DEVICE_STANDING.UNKNOWN);
});
