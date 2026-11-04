// @vitest-environment jsdom

import assert from "node:assert/strict";
import { DEVICE_STANDING } from "@repo/features/agent-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { presenceStanding, useDevicePresence } from "./device-presence.js";
import { fakeActPort } from "./testing/app-bridge.js";
import { handBeats } from "./testing/app-state.js";
import { onRegistry } from "./testing/copy-feedback.js";

/**
 * device-presence.test.ts -- the shared presence judges each device by how long ago its beat was on this machine's clock, and says it cannot check, not offline, where its read failed.
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

test("a beat delayed by 25 seconds still reads online, and a device quiet for four beats reads offline", async () => {
  fakeActPort({});
  handBeats({ [deviceOf(1)]: 25_000 + 15_000, [deviceOf(2)]: 61_000 });
  const container = await draw([deviceOf(1), deviceOf(2)]);

  assert.equal(container.textContent, `${DEVICE_STANDING.ONLINE},${DEVICE_STANDING.OFFLINE}`);
});

test("a device the read does not name as the account's own has no standing", async () => {
  fakeActPort({});
  handBeats({ [deviceOf(1)]: 1_000 });
  const container = await draw([deviceOf(1), deviceOf(9)]);

  assert.equal(container.textContent, `${DEVICE_STANDING.ONLINE},none`);
});

test("a read that failed says unknown, never offline, whether or not one answered before it", async () => {
  fakeActPort({});
  handBeats(undefined);
  assert.equal((await draw([deviceOf(1)])).textContent, DEVICE_STANDING.UNKNOWN);

  handBeats({ [deviceOf(1)]: 61_000 }, { stale: true });
  assert.equal((await draw([deviceOf(1)])).textContent, DEVICE_STANDING.UNKNOWN);
});
