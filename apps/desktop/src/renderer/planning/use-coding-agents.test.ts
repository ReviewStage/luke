// @vitest-environment jsdom

import assert from "node:assert/strict";
import { CODING_AGENT_CALL_FAILURE } from "@luke/features/coding-agent-view";
import {
  CODING_AGENT_BRIEF,
  CODING_AGENT_STATUS,
  type CodingAgentSummary,
} from "@luke/features/coding-agent-wire";
import type { Failure } from "@luke/features/failure-remedy";
import { INTEGRATION_PROVIDER } from "@luke/features/integration-wire";
import { ACT_KIND, type ActKind, type ActPayload, type ActResultFor } from "@luke/host/acts";
import type { AtomRegistry } from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { ToastHost } from "../toast";
import { type CodingAgentsControl, useCodingAgents } from "./use-coding-agents";

const PLAN = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const STARTED: CodingAgentSummary = {
  id: AGENT,
  planId: PLAN,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 1,
  status: CODING_AGENT_STATUS.STARTING,
  turnId: null,
};

interface Standing {
  planId: string | undefined;
  agentId?: string;
  repository: string | null;
  archived?: boolean;
}

/** One act as the hook asked it. */
interface Asked {
  kind: ActKind;
  payload: unknown;
}

const roots: Root[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount());
  document.body.innerHTML = "";
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/**
 * Mounts the hook over a service the test scripts act by act: each kind
 * answers from its own queue of answers, and every ask is written down. The
 * window's toast stands beside it, its atoms on `registry` where given.
 */
function mount(initial: Standing, registry?: AtomRegistry) {
  const asked: Asked[] = [];
  const started: string[] = [];
  let unarchives = 0;
  const answers = new Map<ActKind, unknown[]>();
  let keys = 0;
  let control: CodingAgentsControl | undefined;
  let restand: ((next: Standing) => void) | undefined;
  function Probe() {
    const [held, setHeld] = useState(initial);
    restand = setHeld;
    control = useCodingAgents({
      acts: {
        act: <Kind extends ActKind>(
          kind: Kind,
          ...[payload]: unknown[]
        ): Promise<ActResultFor<Kind>> => {
          asked.push({ kind, payload });
          const queue = answers.get(kind);
          const next = queue?.shift();
          if (next === undefined) return Promise.reject(new Error("Not answered in this test."));
          // SAFETY: the test scripts each kind's answer in that kind's own shape.
          return Promise.resolve(next as ActResultFor<Kind>);
        },
      },
      planId: held.planId,
      agentId: held.agentId,
      repository: held.repository,
      archived: held.archived === true,
      onOpenIntegrations: () => undefined,
      onOpenApiKeys: () => undefined,
      onUnarchive: () => {
        unarchives += 1;
      },
      onStarted: (agentId) => started.push(agentId),
      mintKey: () => {
        keys += 1;
        return `key-${keys}`;
      },
    });
    return null;
  }
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  return {
    asked,
    started,
    /** How many times the control's Unarchive was pressed. */
    unarchives: () => unarchives,
    /** Queues the answers one kind gives, in order. */
    answer: (kind: ActKind, ...queued: unknown[]) => {
      answers.set(kind, [...(answers.get(kind) ?? []), ...queued]);
    },
    mount: async () => {
      const surface = createElement(Fragment, null, createElement(Probe), createElement(ToastHost));
      act(() => root.render(registry === undefined ? surface : onRegistry(registry, surface)));
      await settle();
    },
    control: () => {
      assert.ok(control);
      return control;
    },
    stand: async (next: Partial<Standing>) => {
      act(() => restand?.({ ...initial, ...next }));
      await settle();
    },
  };
}

/** The Starts the hook asked, each with the payload its kind takes. */
function startPayloads(
  asked: readonly Asked[],
): readonly ActPayload<typeof ACT_KIND.CODING_AGENTS_START>[] {
  const starts = asked.filter((each) => each.kind === ACT_KIND.CODING_AGENTS_START);
  // SAFETY: an ask recorded under the Start kind carries the payload the hook built for that kind.
  return starts.map((each) => each.payload as ActPayload<typeof ACT_KIND.CODING_AGENTS_START>);
}

// Note that the refusal raises the window's toast, whose waits stand on the test's clock.

// Note that the refusal raises the window's toast, whose waits stand on the test's clock.

test("a draft asks nothing of the service, one per plan, until its first message starts the agent on those words as its task under the draft's key, with the MCP servers it switched off, opening its tab", async () => {
  const OTHER_PLAN = "3c2d1e0f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const tab = mount({ planId: PLAN, repository: "acme/relay" });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] }, { agents: [] }, { agents: [STARTED] });
  tab.answer(
    ACT_KIND.CODING_AGENTS_START,
    { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
    { agent: { ...STARTED, brief: CODING_AGENT_BRIEF.TASK } },
  );
  await tab.mount();

  let draft = "";
  act(() => {
    draft = tab.control().onNewDraft();
  });
  assert.equal(tab.control().draft?.id, draft);
  let again = "";
  act(() => {
    again = tab.control().onNewDraft();
  });
  assert.equal(again, draft, "the plan's one draft is answered again");
  assert.deepEqual(startPayloads(tab.asked), [], "a draft starts nothing");

  // The words, the choice, and the servers off are the draft's, held while another plan opens a draft of its own.
  const task = "Rename the invite email's subject.";
  const choice = { model: "openai/gpt-6.1-sol", effort: "xhigh" };
  const disabledServers = [INTEGRATION_PROVIDER.LINEAR];
  act(() => tab.control().onDraftChange({ task }));
  act(() => tab.control().onDraftChange({ choice }));
  act(() => tab.control().onDraftChange({ disabledServers }));
  await tab.stand({ planId: OTHER_PLAN });
  assert.equal(tab.control().draft, undefined);
  let other = "";
  act(() => {
    other = tab.control().onNewDraft();
  });
  assert.notEqual(other, draft);
  await tab.stand({ planId: PLAN });
  assert.deepEqual(tab.control().draft, {
    id: draft,
    task,
    attachments: [],
    choice,
    disabledServers,
  });

  let failed: Failure | undefined;
  await act(async () => {
    failed = await tab.control().startTask(draft, task, choice, []);
  });
  assert.equal(failed?.text, "The agent could not be started. Try again.");
  assert.equal(tab.control().draft?.id, draft, "a send that did not start keeps the draft");
  assert.deepEqual(tab.started, []);

  // The files attached to the words are the draft's too, and go with the task.
  const notes = { name: "notes.md", mediaType: "text/plain", data: "IyBOb3Rlcw==" } as const;
  act(() => tab.control().onDraftAttachments((held) => [...held, notes]));
  assert.deepEqual(tab.control().draft?.attachments, [notes]);
  await act(async () => {
    failed = await tab.control().startTask(draft, task, undefined, [notes], disabledServers);
  });
  assert.equal(failed, undefined);
  assert.deepEqual(startPayloads(tab.asked), [
    { planId: PLAN, idempotencyKey: draft, task, ...choice },
    { planId: PLAN, idempotencyKey: draft, task, attachments: [notes], disabledServers },
  ]);
  assert.deepEqual(tab.started, [AGENT]);
  assert.equal(tab.control().draft, undefined, "the started draft is let go");
  await tab.stand({ planId: OTHER_PLAN });
  assert.equal(tab.control().draft?.id, other, "another plan's draft stands");
  assert.equal(tab.control().start.note, undefined, "the toolbar's Start says nothing of it");
});

test("with no plan open, the agent named is read as its page and held as a list of one, so its title from a transcript page moves it", async () => {
  const planless = { ...STARTED, planId: null, status: CODING_AGENT_STATUS.RUNNING };
  const tab = mount({ planId: undefined, agentId: AGENT, repository: null });
  tab.answer(ACT_KIND.CODING_AGENTS_PAGE, {
    agent: {
      ...planless,
      automationId: null,
      workspaceId: "workspace-1",
      repository: "acme/relay",
    },
  });
  await tab.mount();

  assert.deepEqual(
    tab.asked.filter((each) => each.kind !== ACT_KIND.CODING_AGENTS_PULL_REQUEST),
    [{ kind: ACT_KIND.CODING_AGENTS_PAGE, payload: { agentId: AGENT } }],
    "no plan's list is read, only the agent named",
  );
  assert.deepEqual(
    tab.control().agents?.map((agent) => [agent.id, agent.planId, agent.status]),
    [[AGENT, null, CODING_AGENT_STATUS.RUNNING]],
  );
  act(() => tab.control().onTitle(AGENT, "Sweep the flaky tests"));
  assert.equal(tab.control().agents?.[0]?.title, "Sweep the flaky tests");
});

test("another agent named with no plan open holds nothing of the last, even where its read does not land", async () => {
  const OTHER = "3c2d1e0f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const page = (id: string) => ({
    agent: {
      ...STARTED,
      id,
      planId: null,
      automationId: null,
      workspaceId: "workspace-1",
      repository: "acme/relay",
    },
  });
  const tab = mount({ planId: undefined, agentId: AGENT, repository: null });
  tab.answer(ACT_KIND.CODING_AGENTS_PAGE, page(AGENT), {
    failure: CODING_AGENT_CALL_FAILURE.UNANSWERED,
  });
  await tab.mount();
  assert.deepEqual(
    tab.control().agents?.map((agent) => agent.id),
    [AGENT],
  );

  await tab.stand({ agentId: OTHER });

  assert.equal(tab.control().agents, undefined, "the last agent is not drawn for the next");
  assert.equal(tab.control().listFailed, true);
});
