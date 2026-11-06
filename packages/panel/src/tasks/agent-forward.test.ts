// @vitest-environment jsdom

import assert from "node:assert/strict";
import { AGENT_STATUS } from "@repo/features/agent-wire";
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
 * tab open on one never starts showing another agent's app; and once a
 * turn, so one the host let go as its sandbox stopped is not taken again
 * while it still reads as at work. Synthetic ids.
 */

const AGENT = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  status: AGENT_STATUS.RUNNING,
  turnId: "5b0e2c1a-7d3f-4e6a-9c8b-2a1f0e3d4c5b",
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

/** Lets the Query client's batched notices reach the hook, which it sends on the next task. */
async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

test("the open tab's agent is forwarded on its own once no other agent is, once a turn", async () => {
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

  // The host let it go as its sandbox stopped, in the same turn: it is not taken again.
  act(() =>
    writeAppState(
      stateWith({}, { portForwarding: { agentId: AGENT.id, on: true, running: true, ports: [] } }),
    ),
  );
  await settle();
  act(() => writeAppState(stateWith({}, { portForwarding: null })));
  await settle();
  assert.deepEqual(sets, [{ agentId: AGENT.id, on: true }]);
});
