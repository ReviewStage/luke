// @vitest-environment jsdom

import assert from "node:assert/strict";
import {
  AGENT_MACHINE,
  AGENT_STATUS,
  type AgentRunsOnRequest,
  type AgentSummary,
} from "@repo/features/agent-wire";
import { DEVICE_KIND } from "@repo/features/device-agent-wire";
import { type MacOffer, MODEL_PROVIDER } from "@repo/features/models-wire";
import { EXPERIMENT } from "@repo/settings";
import { experimentsOn } from "@repo/settings/testing";
import { Effect } from "effect";
import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { fakeActPort } from "../testing/app-bridge.js";
import { handBeats, handState } from "../testing/app-state.js";
import { editorBundleLanded, installEditorLayout, pressInComposer } from "../testing/composer.js";
import { withQueryClient, writeHandedAppState } from "../testing/copy-feedback.js";
import { installScrollIntoView } from "../testing/scroll-into-view.js";
import { agentsControl } from "../testing/tasks-control.js";
import { DraftAgentTab } from "./draft-agent-tab.js";
import { continueFork } from "./fork-model.js";
import type { AgentDraft } from "./use-agents.js";

/**
 * draft-agent-tab-runs-on.test.ts -- a draft agent's Runs on, with Bring
 * your own host on and the member's Studio online: the chip starts where
 * the member's newest agent on the task runs, a teammate's newer one aside,
 * and a send left on it names no place, leaving it to the service; a place
 * picked is sent with the start; a continue's draft starts on its source's
 * place, named as the source names it where the member's list does not, and
 * sends a pick with the continue. With the experiment off no chip
 * stands and a send names no place, one picked before among them.
 * Synthetic throughout.
 */

const TASK_ID = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const ME = "user-me";
const TEAMMATE = "user-teammate";
const STUDIO = "6f0c1d0e-6b1a-4d43-9a49-2b7b6f1f0a11";

const DEVICES: readonly MacOffer[] = [
  {
    deviceId: STUDIO,
    name: "Studio",
    providers: [MODEL_PROVIDER.ANTHROPIC],
    kind: DEVICE_KIND.DESKTOP,
    seenAt: Date.now(),
  },
];

const DRAFT: AgentDraft = {
  id: "draft-1",
  prompt: "Fix the invite email",
  attachments: [],
  choice: undefined,
  disabledServers: [],
};

/** An agent of the task started by `userId` at `createdAt`, in the cloud unless it names the Studio. */
function agent(id: string, userId: string, createdAt: number, onStudio: boolean): AgentSummary {
  return {
    id,
    planId: TASK_ID,
    model: "anthropic/claude-opus-5.5",
    effort: "high",
    title: null,
    createdAt,
    status: AGENT_STATUS.COMPLETED,
    turnId: null,
    startedBy: { userId, name: userId },
    ...(onStudio
      ? { machine: AGENT_MACHINE.DEVICE, mac: { name: "Studio", deviceId: STUDIO } }
      : undefined),
  };
}

/** The member's older agent in the cloud, their newest on the Studio, and a teammate's newer one in the cloud. */
const AGENTS = [
  agent("1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d21", ME, 1, false),
  agent("1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d22", ME, 2, true),
  agent("1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d23", TEAMMATE, 3, false),
];

const roots: Root[] = [];

beforeAll(() => Effect.runPromise(editorBundleLanded));

beforeEach(() => {
  installScrollIntoView();
  installEditorLayout();
  handState(experimentsOn(EXPERIMENT.BRING_YOUR_OWN_HOST));
  handBeats({ [STUDIO]: 0 });
  fakeActPort({});
});

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  window.localStorage.clear();
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 12; tick += 1) await Promise.resolve();
  });
}

/** The draft's tab over the task's agents, its chips held as its owner holds them, each start's place written down. */
async function mount(draft: AgentDraft, agents: readonly AgentSummary[] = AGENTS) {
  const starts: (AgentRunsOnRequest | undefined)[] = [];
  const forks: (AgentRunsOnRequest | undefined)[] = [];
  function Tab() {
    const [held, setHeld] = useState(draft);
    const control = agentsControl({
      me: ME,
      agents,
      agentIds: agents.map((each) => each.id),
      macs: DEVICES,
      draft: held,
      onDraftChange: (change) => setHeld((was) => ({ ...was, ...change })),
      startPrompt: (_id, _prompt, _choice, _attachments, _servers, runsOn) => {
        starts.push(runsOn);
        return Promise.resolve(undefined);
      },
      startFork: (_id, _fork, _words, _choice, _attachments, _servers, runsOn) => {
        forks.push(runsOn);
        return Promise.resolve(undefined);
      },
    });
    return createElement(DraftAgentTab, { draft: held, control });
  }
  await writeHandedAppState();
  const container = document.body.appendChild(document.createElement("div"));
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(withQueryClient(createElement(Tab))));
  await settle();
  const chip = () => container.querySelector<HTMLButtonElement>('button[aria-label^="Runs on"]');
  return {
    container,
    starts,
    forks,
    chip,
    pick: async (name: string) => {
      act(() =>
        container.querySelector<HTMLButtonElement>('button[aria-label^="Runs on"]')?.click(),
      );
      await settle();
      const option =
        [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((each) =>
          each.textContent?.includes(name),
        ) ?? assert.fail(`Runs on lists ${name}`);
      act(() => option.click());
      await settle();
    },
    send: async () => {
      pressInComposer(container, "Enter");
      await settle();
    },
  };
}

test("a draft's Runs on starts where the member's newest agent on the task runs, a teammate's newer one aside, and a send left on it names no place", async () => {
  const tab = await mount(DRAFT);
  await vi.waitFor(() => assert.equal(tab.chip()?.getAttribute("aria-label"), "Runs on: Studio"));

  await tab.send();
  assert.deepEqual(tab.starts, [undefined]);
});

test("a place picked on a draft is sent with its start", async () => {
  const tab = await mount(DRAFT);
  await tab.pick("Cloud");
  assert.equal(tab.chip()?.getAttribute("aria-label"), "Runs on: Cloud");

  await tab.send();
  assert.deepEqual(tab.starts, [{ machine: AGENT_MACHINE.VERCEL }]);
});

test("a continue's draft starts on its source's place, and a place picked is sent with the continue", async () => {
  const [inCloud] = AGENTS;
  assert.ok(inCloud !== undefined);
  const tab = await mount({ ...DRAFT, prompt: "", fork: continueFork(inCloud.id) });
  assert.equal(tab.chip()?.getAttribute("aria-label"), "Runs on: Cloud");

  await tab.pick("Studio");
  await tab.send();
  assert.deepEqual(tab.forks, [{ machine: AGENT_MACHINE.DEVICE, deviceId: STUDIO }]);
});

test("a continue of a teammate's agent on their own device names that device, which the member's list does not, rather than Cloud", async () => {
  const theirs: AgentSummary = {
    ...agent("1e3c5a7b-9d2f-4b6e-8a1c-3e5f7a9b1d24", TEAMMATE, 4, false),
    machine: AGENT_MACHINE.DEVICE,
    mac: { name: "Dana's Mac mini", deviceId: "9a7d3c1e-4b2f-4e6a-8c5d-1f3b5d7e9a20" },
  };
  const tab = await mount({ ...DRAFT, prompt: "", fork: continueFork(theirs.id) }, [
    ...AGENTS,
    theirs,
  ]);

  assert.equal(tab.chip()?.getAttribute("aria-label"), "Runs on: Dana's Mac mini");
});

test("with Bring your own host off no Runs on stands, and a send names no place, one picked before among them", async () => {
  handState(experimentsOn());
  const tab = await mount({
    ...DRAFT,
    runsOn: { machine: AGENT_MACHINE.DEVICE, deviceId: STUDIO },
  });
  assert.equal(tab.chip(), null);

  await tab.send();
  assert.deepEqual(tab.starts, [undefined]);
});
