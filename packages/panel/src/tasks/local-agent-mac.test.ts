// @vitest-environment jsdom

import assert from "node:assert/strict";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort, refusedOnPort } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { LocalAgentMac } from "./local-agent-mac.js";

/**
 * local-agent-mac.test.ts -- the label a local agent wears names its device's standing as the window's shared presence read says it, not as the agent's own read once did.
 * Synthetic ids and names.
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

const DEVICE = "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d15";

/** A minute and a half since the agent's own read saw a beat: past the window the label judges by. */
const READ_SEEN_AT = Date.now() - 90_000;

/** Lets the label's presence read and its redraw land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/** The label as an agent read a minute and a half ago carries it, drawn while the presence read answers as `presence` does. */
async function labelWhile(presence: () => Promise<unknown>): Promise<string> {
  handState(experimentsOn(EXPERIMENT.LOCAL_AGENTS));
  fakeActPort({ [ACT_KIND.HOSTS_PRESENCE]: presence as never });
  const registry = AtomRegistry.make();
  registries.push(registry);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() =>
    root.render(
      onRegistry(
        registry,
        createElement(LocalAgentMac, {
          agent: { mac: { name: "Charles's MacBook Air", seenAt: READ_SEEN_AT, deviceId: DEVICE } },
        }),
      ),
    ),
  );
  await settle();
  return document.body.textContent ?? "";
}

test("a device the presence read finds beating reads online though the agent's own read is old", async () => {
  const label = await labelWhile(() =>
    Promise.resolve({ devices: [{ deviceId: DEVICE, ageMs: 5_000 }] }),
  );
  assert.equal(label, "Runs on: Charles's MacBook Air");
});

test("a device the presence read finds silent reads offline", async () => {
  const label = await labelWhile(() =>
    Promise.resolve({ devices: [{ deviceId: DEVICE, ageMs: 90_000 }] }),
  );
  assert.equal(label, "Runs on: Charles's MacBook Air · Offline");
});

test("a presence read that fails says the status cannot be checked, never offline", async () => {
  const label = await labelWhile(() =>
    Promise.reject(refusedOnPort("The service did not answer.")),
  );
  assert.equal(label, "Runs on: Charles's MacBook Air · Can't check status");
});
