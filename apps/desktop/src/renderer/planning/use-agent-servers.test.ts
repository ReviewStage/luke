// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  CODING_AGENT_CALL_FAILURE,
  type CodingAgentAgentAnswer,
} from "@sidecar/hosted/coding-agent-view";
import { CODING_AGENT_STATUS, type CodingAgentSummary } from "@sidecar/hosted/coding-agent-wire";
import { INTEGRATION_PROVIDER, type IntegrationProvider } from "@sidecar/hosted/integration-wire";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import type { AgentServersControl } from "./agent-servers";
import { useAgentServers } from "./use-agent-servers";

/**
 * The switches of a started agent's MCP servers as one control: a switch is
 * drawn the moment it is pressed, the agent the service answers is what
 * stands after, and a change the service refused falls back to what the
 * agent holds. The service is the test's own promise per change.
 */

const AGENT: CodingAgentSummary = {
  id: "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21",
  planId: "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10",
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 1_800_000_000_000,
  status: CODING_AGENT_STATUS.COMPLETED,
  turnId: null,
};

const LINEAR = INTEGRATION_PROVIDER.LINEAR;

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

/** The control over the agent given, its writes answered by the promises the test hands out. */
function mount(agent: CodingAgentSummary) {
  let control: AgentServersControl | undefined;
  const answers: ((answer: CodingAgentAgentAnswer) => void)[] = [];
  const written: (readonly IntegrationProvider[])[] = [];
  function Probe({ held }: { held: CodingAgentSummary }) {
    control = useAgentServers({
      agent: held,
      write: (_agentId, disabledServers) => {
        written.push(disabledServers);
        return new Promise((resolve) => {
          answers.push(resolve);
        });
      },
      onOpenSettings: () => undefined,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  roots.push(root);
  act(() => root.render(createElement(Probe, { held: agent })));
  return {
    control: () => control ?? assert.fail("the probe did not render"),
    written,
    /** Answers the oldest change still out, then lets the answer land. */
    answer: async (answer: CodingAgentAgentAnswer, next: CodingAgentSummary) => {
      await act(async () => {
        answers.shift()?.(answer);
        root.render(createElement(Probe, { held: next }));
        await Promise.resolve();
      });
    },
  };
}

test("a switch is drawn the moment it is pressed, and the agent the service answers stands after", async () => {
  const tab = mount(AGENT);
  assert.deepEqual(tab.control().disabled, []);

  act(() => tab.control().onSwitch([LINEAR]));
  assert.deepEqual(tab.written, [[LINEAR]]);
  assert.deepEqual(tab.control().disabled, [LINEAR], "the switch shows before the answer");

  const off = { ...AGENT, disabledServers: [LINEAR] };
  await tab.answer({ agent: off }, off);
  assert.deepEqual(tab.control().disabled, [LINEAR]);
});

test("a change the service refused falls back to what the agent holds", async () => {
  const tab = mount({ ...AGENT, disabledServers: [LINEAR] });

  act(() => tab.control().onSwitch([]));
  assert.deepEqual(tab.control().disabled, []);

  await tab.answer(
    { failure: CODING_AGENT_CALL_FAILURE.NOT_FOUND },
    { ...AGENT, disabledServers: [LINEAR] },
  );
  assert.deepEqual(tab.control().disabled, [LINEAR]);
});
