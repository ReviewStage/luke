// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_MACHINE, type AgentSummary } from "@luke/features/agent-wire";
import { ACT_KIND } from "@luke/host/acts";
import { EXPERIMENT, type Experiment } from "@luke/settings";
import { experimentsOn } from "@luke/settings/testing";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test } from "vitest";
import { fakeActPort, refusedOnPort } from "../testing/app-bridge.js";
import { handState } from "../testing/app-state.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { AgentPlace } from "./agent-place.js";

/**
 * agent-place.test.ts -- the chip an agent's box wears says where it runs: a device named with its standing as the window's shared presence read says it, not as the agent's own read once did, or the cloud; and nothing while the Local agents experiment is off.
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

/** Lets go of every box drawn so far. */
function clear(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.replaceChildren();
}

afterEach(clear);

const DEVICE = "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d15";

/** A minute and a half since the agent's own read saw a beat: past the window the label judges by. */
const READ_SEEN_AT = Date.now() - 90_000;

/** Lets the label's presence read and its redraw land. */
async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

/** An agent's box drawn with `agent` while the presence read answers as `presence` does, and what the box then says. */
async function placeOf(
  agent: Pick<AgentSummary, "mac" | "machine">,
  presence: () => Promise<unknown>,
  experiments: readonly Experiment[] = [EXPERIMENT.LOCAL_AGENTS],
): Promise<string> {
  clear();
  handState(experimentsOn(...experiments));
  fakeActPort({ [ACT_KIND.HOSTS_PRESENCE]: presence as never });
  const registry = AtomRegistry.make();
  registries.push(registry);
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(onRegistry(registry, createElement(AgentPlace, { agent }))));
  await settle();
  return document.body.textContent ?? "";
}

/** The chip of an agent on a device whose own read, a minute and a half ago, saw a beat, drawn while the presence read answers as `presence` does. */
function labelWhile(presence: () => Promise<unknown>): Promise<string> {
  return placeOf(
    {
      machine: AGENT_MACHINE.DEVICE,
      mac: { name: "Charles's MacBook Air", seenAt: READ_SEEN_AT, deviceId: DEVICE },
    },
    presence,
  );
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

test("a device the account does not own, which the read does not name, shows its name alone", async () => {
  const label = await labelWhile(() => Promise.resolve({ devices: [] }));
  assert.equal(label, "Runs on: Charles's MacBook Air");
});

/** A presence read that is never asked for, since an agent in the cloud has no device to read. */
const noRead = () => Promise.reject(refusedOnPort("No read is asked."));

test("an agent in the cloud says Cloud", async () => {
  assert.equal(await placeOf({}, noRead), "Runs on: Cloud");
});

test("nothing is said of where an agent runs while the Local agents experiment is off", async () => {
  assert.equal(await placeOf({}, noRead, []), "");
});
