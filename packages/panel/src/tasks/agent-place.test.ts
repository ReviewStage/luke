// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_MACHINE, type AgentSummary } from "@repo/features/agent-wire";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, test, vi } from "vitest";
import { appBridge } from "../app-bridge.js";
import { fakeActPort } from "../testing/app-bridge.js";
import { handBeats } from "../testing/app-state.js";
import { onRegistry, writeAppState } from "../testing/copy-feedback.js";
import { AgentPlace } from "./agent-place.js";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

beforeAll(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
});

const roots: Root[] = [];
const registries: AtomRegistry.AtomRegistry[] = [];

function clear(): void {
  for (const root of roots.splice(0)) act(() => root.unmount());
  for (const registry of registries.splice(0)) registry.dispose();
  document.body.replaceChildren();
}

afterEach(clear);

const DEVICE = "3f6b0c2e-8d1a-4b5e-9c7d-2a4e6f8b0d15";

const READ_SEEN_AT = Date.now() - 90_000;

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 20; tick += 1) await new Promise((done) => setTimeout(done, 0));
  });
}

async function placeOf(
  agent: Pick<AgentSummary, "mac" | "machine">,
  ages: Readonly<Record<string, number>> | undefined,
): Promise<string> {
  clear();
  fakeActPort({});
  handBeats(ages);
  writeAppState(await appBridge().requestAppState());
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

function labelWhile(ages: Readonly<Record<string, number>> | undefined): Promise<string> {
  return placeOf(
    {
      machine: AGENT_MACHINE.DEVICE,
      mac: { name: "Charles's MacBook Air", seenAt: READ_SEEN_AT, deviceId: DEVICE },
    },
    ages,
  );
}

test("a device the presence read finds beating reads online though the agent's own read is old", async () => {
  const label = await labelWhile({ [DEVICE]: 5_000 });
  assert.equal(label, "Runs on: Charles's MacBook Air");
});

test("a device the presence read finds silent reads offline", async () => {
  const label = await labelWhile({ [DEVICE]: 90_000 });
  assert.equal(label, "Runs on: Charles's MacBook Air · Offline");
});

test("a presence read that fails says the status cannot be checked, never offline", async () => {
  await labelWhile(undefined);
  await vi.waitFor(() =>
    assert.equal(document.body.textContent, "Runs on: Charles's MacBook Air · Can't check status"),
  );
});

test("a device the account does not own, which the read does not name, shows its name alone", async () => {
  const label = await labelWhile({});
  assert.equal(label, "Runs on: Charles's MacBook Air");
});

test("an agent in the cloud says Cloud, whatever the beats say", async () => {
  assert.equal(await placeOf({}, undefined), "Runs on: Cloud");
});
