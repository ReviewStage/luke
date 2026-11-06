// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_MACHINE, AGENT_STATUS } from "@repo/features/agent-wire";
import { ACT_KIND } from "@repo/host/acts";
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test, vi } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { handState, stateWith } from "../testing/app-state.js";
import { onRegistry, writeAppState, writeHandedAppState } from "../testing/copy-feedback.js";
import { useAutoForward } from "./agent-forward.js";

/**
 * A cloud agent at work whose tab is open is forwarded on its own only while
 * no agent is, so the agent forwarded first keeps its ports and a browser
 * tab open on one never starts showing another agent's app. Synthetic ids.
 */

const AGENT = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  machine: AGENT_MACHINE.VERCEL,
  status: AGENT_STATUS.RUNNING,
  archivedAt: undefined,
} as const;
const OTHER_AGENT_ID = "1d2f3a4b-5c6d-4c6b-9e0a-8b3c7a1e2f4d";

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

function Shown(): null {
  useAutoForward(AGENT, true);
  return null;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

test("the open tab's agent is forwarded on its own only once no other agent is", async () => {
  handState(
    {},
    {
      portForwarding: { agentId: OTHER_AGENT_ID, on: true, running: true, ports: [] },
    },
  );
  const sets: unknown[] = [];
  fakeActPort({
    [ACT_KIND.PORT_FORWARD_SET]: (payload) => {
      sets.push(payload);
      return Promise.resolve({ on: true, running: false, ports: [] });
    },
  });
  await writeHandedAppState();
  const root = createRoot(document.body.appendChild(document.createElement("div")));
  roots.push(root);
  act(() => root.render(onRegistry(AtomRegistry.make(), createElement(Shown))));
  await settle();
  assert.deepEqual(sets, []);

  // The first agent's forwarding ended: the open tab's agent takes the ports.
  act(() => writeAppState(stateWith({}, { portForwarding: null })));
  await vi.waitFor(() => assert.deepEqual(sets, [{ agentId: AGENT.id, on: true }]));
});
