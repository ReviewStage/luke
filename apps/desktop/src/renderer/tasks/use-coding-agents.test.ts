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
import * as AtomRegistry from "effect/reactivity/AtomRegistry";
import { act, createElement, Fragment, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, test } from "vitest";
import { onRegistry } from "#testing/copy-feedback";
import { ToastHost } from "../toast";
import { type CodingAgentsControl, useCodingAgents } from "./use-coding-agents";

const TASK = "7b0f5f3e-2c1d-4c7a-9a55-5e3b6f1d2a10";
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";

const STARTED: CodingAgentSummary = {
  id: AGENT,
  planId: TASK,
  model: "anthropic/claude-opus-5.5",
  effort: "high",
  title: null,
  createdAt: 1,
  status: CODING_AGENT_STATUS.STARTING,
  turnId: null,
};

interface Standing {
  taskId: string | undefined;
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
  window.localStorage.clear();
});

async function settle(): Promise<void> {
  await act(async () => {
    for (let tick = 0; tick < 8; tick += 1) await Promise.resolve();
  });
}

/**
 * Mounts the hook over a service the test scripts act by act: each kind
 * answers from its own queue of answers, and every ask is written down. The
 * window's toast stands beside it, its atoms on `registry`, one of its own,
 * as a window's, where none is given.
 */
function mount(
  initial: Standing,
  registry: AtomRegistry.AtomRegistry = AtomRegistry.make(),
  keyPrefix = "key",
) {
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
      taskId: held.taskId,
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
        return `${keyPrefix}-${keys}`;
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
      act(() => root.render(onRegistry(registry, surface)));
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

test("a draft asks nothing of the service, one per plan, until its first message starts the agent on those words as its prompt under the draft's key, with the MCP servers it switched off, opening its tab", async () => {
  const OTHER_TASK = "3c2d1e0f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const tab = mount({ taskId: TASK, repository: "acme/relay" });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] }, { agents: [] }, { agents: [STARTED] });
  tab.answer(
    ACT_KIND.CODING_AGENTS_START,
    { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
    { agent: { ...STARTED, brief: CODING_AGENT_BRIEF.PROMPT } },
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

  // The words, the choice, and the servers off are the draft's, held while another task opens a draft of its own.
  const prompt = "Rename the invite email's subject.";
  const choice = { model: "openai/gpt-6.1-sol", effort: "xhigh" };
  const disabledServers = [INTEGRATION_PROVIDER.LINEAR];
  act(() => tab.control().onDraftChange({ prompt }));
  act(() => tab.control().onDraftChange({ choice }));
  act(() => tab.control().onDraftChange({ disabledServers }));
  await tab.stand({ taskId: OTHER_TASK });
  assert.equal(tab.control().draft, undefined);
  let other = "";
  act(() => {
    other = tab.control().onNewDraft();
  });
  assert.notEqual(other, draft);
  await tab.stand({ taskId: TASK });
  assert.deepEqual(tab.control().draft, {
    id: draft,
    prompt,
    attachments: [],
    choice,
    disabledServers,
  });

  let failed: Failure | undefined;
  await act(async () => {
    failed = await tab.control().startPrompt(draft, prompt, choice, []);
  });
  assert.equal(failed?.text, "The agent could not be started. Try again.");
  assert.equal(tab.control().draft?.id, draft, "a send that did not start keeps the draft");
  assert.deepEqual(tab.started, []);

  // The files attached to the words are the draft's too, and go with the prompt.
  const notes = { name: "notes.md", mediaType: "text/plain", data: "IyBOb3Rlcw==" } as const;
  act(() => tab.control().onDraftAttachments((held) => [...held, notes]));
  assert.deepEqual(tab.control().draft?.attachments, [notes]);
  await act(async () => {
    failed = await tab.control().startPrompt(draft, prompt, undefined, [notes], disabledServers);
  });
  assert.equal(failed, undefined);
  assert.deepEqual(startPayloads(tab.asked), [
    { taskId: TASK, idempotencyKey: draft, prompt, ...choice },
    { taskId: TASK, idempotencyKey: draft, prompt, attachments: [notes], disabledServers },
  ]);
  assert.deepEqual(tab.started, [AGENT]);
  assert.equal(tab.control().draft, undefined, "the started draft is let go");
  await tab.stand({ taskId: OTHER_TASK });
  assert.equal(tab.control().draft?.id, other, "another plan's draft stands");
  assert.equal(tab.control().start.note, undefined, "the toolbar's Start says nothing of it");
});

test("a draft's words outlast a relaunch, the plan opening on its draft again under the same key, its files and chips left behind, and a draft let go stays gone", async () => {
  const before = mount({ taskId: TASK, repository: "acme/relay" });
  before.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] });
  await before.mount();
  let draft = "";
  act(() => {
    draft = before.control().onNewDraft();
  });
  const prompt = "Rename the invite email's subject.";
  const notes = { name: "notes.md", mediaType: "text/plain", data: "IyBOb3Rlcw==" } as const;
  act(() => before.control().onDraftChange({ prompt }));
  act(() =>
    before.control().onDraftChange({ choice: { model: "openai/gpt-6.1-sol", effort: "xhigh" } }),
  );
  act(() => before.control().onDraftAttachments((held) => [...held, notes]));
  for (const root of roots.splice(0)) act(() => root.unmount());

  const after = mount({ taskId: TASK, repository: "acme/relay" });
  after.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] });
  await after.mount();
  assert.deepEqual(after.control().draft, {
    id: draft,
    prompt,
    attachments: [],
    choice: undefined,
    disabledServers: [],
  });
  act(() => after.control().onDiscardDraft(draft));
  assert.equal(after.control().draft, undefined);
  for (const root of roots.splice(0)) act(() => root.unmount());

  const again = mount({ taskId: TASK, repository: "acme/relay" });
  again.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] });
  await again.mount();
  assert.equal(again.control().draft, undefined);
});

test("two windows' draft agents on one plan each keep their own words under their own key", async () => {
  const first = mount({ taskId: TASK, repository: "acme/relay" }, AtomRegistry.make(), "first");
  const second = mount({ taskId: TASK, repository: "acme/relay" }, AtomRegistry.make(), "second");
  first.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] });
  second.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] });
  await first.mount();
  await second.mount();
  act(() => {
    first.control().onNewDraft();
  });
  act(() => {
    second.control().onNewDraft();
  });
  act(() => second.control().onDraftChange({ prompt: "Ship now" }));
  act(() => first.control().onDraftChange({ prompt: "Wait for review" }));

  assert.equal(first.control().draft?.prompt, "Wait for review");
  assert.equal(first.control().draft?.id, "first-1");
  act(() => first.control().onDiscardDraft("first-1"));
  for (const root of roots.splice(0)) act(() => root.unmount());

  // The other window's draft, kept apart and outliving the first's, is the one a relaunch opens on.
  const relaunched = mount({ taskId: TASK, repository: "acme/relay" });
  relaunched.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] });
  await relaunched.mount();
  assert.deepEqual(
    [relaunched.control().draft?.id, relaunched.control().draft?.prompt],
    ["second-1", "Ship now"],
  );
});

test("a draft of files alone waits while another plan is open, but no relaunch brings back a draft with no words", async () => {
  const OTHER_TASK = "3c2d1e0f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const notes = { name: "notes.md", mediaType: "text/plain", data: "IyBOb3Rlcw==" } as const;
  const before = mount({ taskId: TASK, repository: "acme/relay" });
  before.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] }, { agents: [] }, { agents: [] });
  await before.mount();
  act(() => {
    before.control().onNewDraft();
  });
  act(() => before.control().onDraftAttachments((held) => [...held, notes]));
  await before.stand({ taskId: OTHER_TASK });
  await before.stand({ taskId: TASK });
  assert.deepEqual(before.control().draft?.attachments, [notes]);
  for (const root of roots.splice(0)) act(() => root.unmount());

  const after = mount({ taskId: TASK, repository: "acme/relay" });
  after.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] });
  await after.mount();
  assert.equal(after.control().draft, undefined);
});

test("with no plan open, the agent named is read as its page and held as a list of one, so its title from a transcript page moves it", async () => {
  const taskless = { ...STARTED, planId: null, status: CODING_AGENT_STATUS.RUNNING };
  const tab = mount({ taskId: undefined, agentId: AGENT, repository: null });
  tab.answer(ACT_KIND.CODING_AGENTS_PAGE, {
    agent: {
      ...taskless,
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

test("with no plan open, a / reads the agent's own repository's skills through the workspace its page names, there being no plan to read them by", async () => {
  const tab = mount({ taskId: undefined, agentId: AGENT, repository: null });
  tab.answer(ACT_KIND.CODING_AGENTS_PAGE, {
    agent: {
      ...STARTED,
      planId: null,
      automationId: null,
      workspaceId: "workspace-1",
      repository: "acme/relay",
    },
  });
  const skills = { skills: { repository: "acme/relay", branch: "main", skills: [] } };
  tab.answer(ACT_KIND.TASKS_SKILLS, skills);
  await tab.mount();

  const read = tab.control().readSkills;
  assert.ok(read, "the agent's box offers its repository's skills");
  const answered = await read();

  assert.deepEqual(answered, { skills: [] });
  assert.deepEqual(
    tab.asked.filter((each) => each.kind === ACT_KIND.TASKS_SKILLS),
    [
      {
        kind: ACT_KIND.TASKS_SKILLS,
        payload: { workspaceId: "workspace-1", repository: "acme/relay" },
      },
    ],
  );
});

test("another agent named with no plan open holds nothing of the last, even where its read does not land", async () => {
  const OTHER = "3c2d1e0f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const page = (id: string) => ({
    agent: {
      ...STARTED,
      id,
      taskId: null,
      automationId: null,
      workspaceId: "workspace-1",
      repository: "acme/relay",
    },
  });
  const tab = mount({ taskId: undefined, agentId: AGENT, repository: null });
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

test("a read of an agent's changes keeps who its pull request names, by agent and with the pull request read, so its Changes card says them wherever it hangs; only the agent's newest read is kept, and a read naming no pull request drops them", async () => {
  const tab = mount({ taskId: undefined, agentId: AGENT, repository: null });
  const url = "https://github.com/acme/relay/pull/42";
  const answerWith = (state: "requested" | "approved") => ({
    pullRequest: {
      url,
      files: [],
      truncated: false,
      author: { login: "luke-agent[bot]", bot: true },
      reviewers: [{ by: { login: "octocat", bot: false }, state }],
    },
  });
  let land: (answer: ReturnType<typeof answerWith>) => void = () => undefined;
  const older = new Promise<ReturnType<typeof answerWith>>((resolve) => {
    land = resolve;
  });
  tab.answer(ACT_KIND.CODING_AGENTS_CHANGES, older, answerWith("approved"), {
    pullRequest: null,
  });
  await tab.mount();
  assert.equal(tab.control().changesPeople.get(AGENT), undefined);

  // The first read lands after the second, which was asked later, and is not kept over it.
  const first = tab.control().readChanges(AGENT);
  await act(() => tab.control().readChanges(AGENT));
  land(answerWith("requested"));
  await act(() => first);
  assert.deepEqual(tab.control().changesPeople.get(AGENT), {
    url,
    people: {
      author: { login: "luke-agent[bot]", bot: true },
      reviewers: [{ by: { login: "octocat", bot: false }, state: "approved" }],
    },
  });

  await act(() => tab.control().readChanges(AGENT));
  assert.equal(tab.control().changesPeople.get(AGENT), undefined, "no pull request names nobody");
});

test("a fork joins the task's draft, its words kept and its chips on the source's servers, holds while another task is open, and starts from the source at the message with the box's words and files as a note; an empty box forks alone", async () => {
  const OTHER_TASK = "3c2d1e0f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const MESSAGE = "4f1e2d3c-5b6a-4978-8a1b-2c3d4e5f6a7b";
  const FORKED = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
  const source: CodingAgentSummary = {
    ...STARTED,
    status: CODING_AGENT_STATUS.COMPLETED,
    disabledServers: [INTEGRATION_PROVIDER.LINEAR],
  };
  const forked: CodingAgentSummary = {
    ...STARTED,
    id: FORKED,
    from: { agentId: AGENT, messageId: MESSAGE, steps: 3, totalSteps: 5 },
  };
  const tab = mount({ taskId: TASK, repository: "acme/relay" });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [source] }, { agents: [source] });
  tab.answer(
    ACT_KIND.CODING_AGENTS_START,
    { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
    { agent: forked },
  );
  await tab.mount();

  // A draft already written in takes the fork, and keeps its words.
  let draft = "";
  act(() => {
    draft = tab.control().onNewDraft();
  });
  const words = "Try the queue instead.";
  act(() => tab.control().onDraftChange({ prompt: words }));
  act(() =>
    tab.control().onDraftChange({ choice: { model: "openai/gpt-6.1-sol", effort: "low" } }),
  );
  const fork = { agentId: AGENT, messageId: MESSAGE, opening: "Use a cron job…" };
  let joined = "";
  act(() => {
    joined = tab.control().onForkDraft(fork);
  });
  assert.equal(joined, draft, "the fork joins the draft the task holds");
  const forkDraft = {
    id: draft,
    prompt: words,
    attachments: [],
    choice: undefined,
    disabledServers: [INTEGRATION_PROVIDER.LINEAR],
    fork,
  };
  assert.deepEqual(tab.control().draft, forkDraft, "its chips start on the source's");

  // The fork stays with the draft while another task is open, and through a change of its chips.
  await tab.stand({ taskId: OTHER_TASK });
  assert.equal(tab.control().draft, undefined);
  await tab.stand({ taskId: TASK });
  act(() => tab.control().onDraftChange({ disabledServers: [] }));
  assert.deepEqual(tab.control().draft, { ...forkDraft, disabledServers: [] });

  const notes = { name: "notes.md", mediaType: "text/plain", data: "IyBOb3Rlcw==" } as const;
  let failed: Failure | undefined;
  await act(async () => {
    failed = await tab.control().startFork(draft, fork, ` ${words} `, undefined, [notes]);
  });
  assert.equal(failed?.text, "The agent could not be started. Try again.");
  assert.equal(tab.control().draft?.fork, fork, "a send that did not start keeps the fork");
  await act(async () => {
    failed = await tab.control().startFork(draft, fork, "", undefined, []);
  });
  assert.equal(failed, undefined);
  assert.deepEqual(startPayloads(tab.asked), [
    {
      taskId: TASK,
      idempotencyKey: draft,
      from: { agentId: AGENT, messageId: MESSAGE },
      note: words,
      attachments: [notes],
    },
    { taskId: TASK, idempotencyKey: draft, from: { agentId: AGENT, messageId: MESSAGE } },
  ]);
  assert.deepEqual(tab.started, [FORKED]);
  assert.equal(tab.control().draft, undefined, "the started fork's draft is let go");
});

test("a fork's × lets the fork go and leaves an ordinary draft with its words and chips; a fork with no draft opens one", async () => {
  const MESSAGE = "4f1e2d3c-5b6a-4978-8a1b-2c3d4e5f6a7b";
  const tab = mount({ taskId: TASK, repository: "acme/relay" });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [STARTED] });
  await tab.mount();
  const fork = { agentId: AGENT, messageId: MESSAGE, opening: "Done." };
  let draft = "";
  act(() => {
    draft = tab.control().onForkDraft(fork);
  });
  assert.equal(tab.control().draft?.id, draft);
  act(() => tab.control().onDraftChange({ prompt: "Keep going" }));
  act(() => tab.control().onDropFork());
  assert.deepEqual(tab.control().draft, {
    id: draft,
    prompt: "Keep going",
    attachments: [],
    choice: undefined,
    disabledServers: [],
  });
});
