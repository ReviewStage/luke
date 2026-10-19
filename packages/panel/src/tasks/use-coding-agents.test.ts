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
import type { ActHandle } from "../act.js";
import { onRegistry } from "../testing/copy-feedback.js";
import { ToastHost } from "../toast.js";
import { type CodingAgentsControl, useCodingAgents } from "./use-coding-agents.js";

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
        // SAFETY: this suite's window asks no kind the act port answers, so its fake answers `app:act` kinds alone.
        act: (<Kind extends ActKind>(
          kind: Kind,
          ...[payload]: unknown[]
        ): Promise<ActResultFor<Kind>> => {
          asked.push({ kind, payload });
          const queue = answers.get(kind);
          const next = queue?.shift();
          if (next === undefined) return Promise.reject(new Error("Not answered in this test."));
          // SAFETY: the test scripts each kind's answer in that kind's own shape.
          return Promise.resolve(next as ActResultFor<Kind>);
        }) as ActHandle["act"],
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

test("a pull request a tab names by its number is read with its number and kept by agent and number apart from the agent's own; an older read landing last keeps the newer, and one naming none lets it go", async () => {
  const tab = mount({ taskId: undefined, agentId: AGENT, repository: null });
  const named = (title: string) => ({
    repository: "acme/relay",
    branch: "luke/base",
    pullRequest: {
      number: 41,
      title,
      url: "https://github.com/acme/relay/pull/41",
      state: "open",
      checks: "passing",
      additions: 9,
      deletions: 2,
      changedFiles: 3,
    },
  });
  let land: (answer: ReturnType<typeof named>) => void = () => undefined;
  const older = new Promise<ReturnType<typeof named>>((resolve) => {
    land = resolve;
  });
  await tab.mount();
  tab.answer(ACT_KIND.CODING_AGENTS_PULL_REQUEST, older, named("Lay the base, retitled"), {
    repository: "acme/relay",
    branch: null,
    pullRequest: null,
  });

  const first = tab.control().readNumberedPullRequest(AGENT, 41);
  assert.equal(await act(() => tab.control().readNumberedPullRequest(AGENT, 41)), true);
  land(named("Lay the base"));
  await act(() => first);
  assert.equal(
    tab.control().numberedPullRequests.get(AGENT)?.get(41)?.title,
    "Lay the base, retitled",
  );
  assert.equal(tab.control().pullRequests.get(AGENT), undefined, "the agent's own stands apart");
  assert.deepEqual(
    tab.asked
      .filter((each) => each.kind === ACT_KIND.CODING_AGENTS_PULL_REQUEST)
      .map((each) => each.payload),
    [
      { agentId: AGENT, number: 41 },
      { agentId: AGENT, number: 41 },
    ],
  );

  assert.equal(await act(() => tab.control().readNumberedPullRequest(AGENT, 41)), false);
  assert.equal(tab.control().numberedPullRequests.get(AGENT), undefined);
});

test("a fork joins the task's draft under a key of its own, its words kept and its chips on the source's servers, holds while another task is open, and starts from the source at the message with the box's words and files as a note and its servers named even where none is off; an empty box forks alone", async () => {
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
  assert.notEqual(joined, draft, "a Start the draft sent is never answered for the fork");
  const forkDraft = {
    id: joined,
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
    failed = await tab.control().startFork(joined, fork, ` ${words} `, undefined, [notes], []);
  });
  assert.equal(failed?.text, "The agent could not be started. Try again.");
  assert.equal(tab.control().draft?.fork, fork, "a send that did not start keeps the fork");
  await act(async () => {
    failed = await tab.control().startFork(joined, fork, "", undefined, [], []);
  });
  assert.equal(failed, undefined);
  assert.deepEqual(startPayloads(tab.asked), [
    {
      taskId: TASK,
      idempotencyKey: joined,
      from: { agentId: AGENT, messageId: MESSAGE },
      note: words,
      attachments: [notes],
      disabledServers: [],
    },
    {
      taskId: TASK,
      idempotencyKey: joined,
      from: { agentId: AGENT, messageId: MESSAGE },
      disabledServers: [],
    },
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

test("a fork's draft with words outlasts a relaunch still a fork, under the same key, and its × keeps the words as an ordinary draft's", async () => {
  const MESSAGE = "4f1e2d3c-5b6a-4978-8a1b-2c3d4e5f6a7b";
  const fork = { agentId: AGENT, messageId: MESSAGE, opening: "Done." };
  const before = mount({ taskId: TASK, repository: "acme/relay" });
  before.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [STARTED] });
  await before.mount();
  let draft = "";
  act(() => {
    draft = before.control().onForkDraft(fork);
  });
  act(() => before.control().onDraftChange({ prompt: "Try the queue" }));
  for (const root of roots.splice(0)) act(() => root.unmount());

  const after = mount({ taskId: TASK, repository: "acme/relay" });
  after.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [STARTED] });
  await after.mount();
  assert.deepEqual(after.control().draft, {
    id: draft,
    prompt: "Try the queue",
    attachments: [],
    choice: undefined,
    disabledServers: [],
    fork,
  });
  act(() => after.control().onDropFork());
  act(() => after.control().onDraftChange({ prompt: "Try the queue, then retry" }));
  assert.deepEqual(after.control().draft, {
    id: draft,
    prompt: "Try the queue, then retry",
    attachments: [],
    choice: undefined,
    disabledServers: [],
  });
  for (const root of roots.splice(0)) act(() => root.unmount());

  const again = mount({ taskId: TASK, repository: "acme/relay" });
  again.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [STARTED] });
  await again.mount();
  assert.equal(again.control().draft?.fork, undefined, "a fork let go stays let go");
  assert.equal(again.control().draft?.prompt, "Try the queue, then retry");
});

test("a continue opens the task's draft with the closed box's words and files after any it held, its chips on the source's servers, sends nothing, holds through a tab switch and a relaunch, and an empty send continues under the draft's key, asked again under the same one", async () => {
  const OTHER_TASK = "3c2d1e0f-4a5b-4c6d-8e7f-9a0b1c2d3e4f";
  const CONTINUED = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
  const source: CodingAgentSummary = {
    ...STARTED,
    status: CODING_AGENT_STATUS.FAILED,
    disabledServers: [INTEGRATION_PROVIDER.LINEAR],
  };
  const continued: CodingAgentSummary = {
    ...STARTED,
    id: CONTINUED,
    from: { agentId: AGENT, steps: 3, totalSteps: 3 },
  };
  const notes = { name: "notes.md", mediaType: "text/plain", data: "IyBOb3Rlcw==" } as const;
  const before = mount({ taskId: TASK, repository: "acme/relay" });
  before.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [source] }, { agents: [source] });
  await before.mount();

  // Words already in the task's draft stay, the box's laid in after them.
  act(() => {
    before.control().onNewDraft();
  });
  act(() => before.control().onDraftChange({ prompt: "Check the logs first." }));
  let draft = "";
  act(() => {
    draft = before.control().onContinueDraft(AGENT, " Now add the dark variant. ", [notes]);
  });
  const fork = { agentId: AGENT, opening: "" };
  assert.deepEqual(before.control().draft, {
    id: draft,
    prompt: "Check the logs first.\n\nNow add the dark variant.",
    attachments: [notes],
    choice: undefined,
    disabledServers: [INTEGRATION_PROVIDER.LINEAR],
    fork,
  });
  assert.deepEqual(startPayloads(before.asked), [], "nothing is sent until the draft is");

  await before.stand({ taskId: OTHER_TASK });
  await before.stand({ taskId: TASK });
  assert.equal(before.control().draft?.id, draft, "the draft holds while another task is open");
  assert.deepEqual(before.control().draft?.fork, fork);
  for (const root of roots.splice(0)) act(() => root.unmount());

  const after = mount({ taskId: TASK, repository: "acme/relay" });
  after.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [source] }, { agents: [continued] });
  after.answer(
    ACT_KIND.CODING_AGENTS_START,
    { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
    { agent: continued },
  );
  await after.mount();
  const kept = after.control().draft ?? assert.fail("the draft outlasts a relaunch");
  assert.equal(kept.id, draft, "under the same key");
  assert.deepEqual(kept.fork, fork, "still a continue");
  assert.equal(kept.prompt, "Check the logs first.\n\nNow add the dark variant.");

  // The developer empties the box and sends: the continue goes on nothing more.
  let failed: Failure | undefined;
  await act(async () => {
    failed = await after.control().startFork(draft, fork, "", undefined, [], []);
  });
  assert.equal(failed?.text, "The agent could not be started. Try again.");
  await act(async () => {
    failed = await after.control().startFork(draft, fork, "", undefined, [], []);
  });
  assert.equal(failed, undefined);
  const asked = {
    taskId: TASK,
    idempotencyKey: draft,
    from: { agentId: AGENT },
    disabledServers: [],
  };
  assert.deepEqual(startPayloads(after.asked), [asked, asked]);
  assert.deepEqual(after.started, [CONTINUED]);
  assert.equal(after.control().draft, undefined, "the started continue's draft is let go");
});

test("a second Continue of the agent the draft already continues keeps its key and its chips where it lays nothing in, and takes a key of its own for new words, which a Start already sent never had", async () => {
  const tab = mount({ taskId: TASK, repository: "acme/relay" });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [STARTED] });
  await tab.mount();
  let first = "";
  act(() => {
    first = tab.control().onContinueDraft(AGENT, "Carry on.", []);
  });
  act(() =>
    tab.control().onDraftChange({ choice: { model: "openai/gpt-6.1-sol", effort: "low" } }),
  );
  let second = "";
  act(() => {
    second = tab.control().onContinueDraft(AGENT, "", []);
  });
  assert.equal(second, first);
  assert.equal(tab.control().draft?.prompt, "Carry on.");
  assert.deepEqual(tab.control().draft?.choice, { model: "openai/gpt-6.1-sol", effort: "low" });

  let third = "";
  act(() => {
    third = tab.control().onContinueDraft(AGENT, "Fix lint too.", []);
  });
  assert.notEqual(third, first);
  assert.equal(tab.control().draft?.id, third);
  assert.equal(tab.control().draft?.prompt, "Carry on.\n\nFix lint too.");
});

test("continuing an agent starts on the task from its whole transcript under the agent's own key, a press asked again after no answer carrying the same key, and the new agent's tab opens as a Start's does", async () => {
  const SOURCE = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
  const continued = { ...STARTED, from: { agentId: SOURCE, steps: 3, totalSteps: 3 } };
  const tab = mount({ taskId: TASK, repository: "acme/relay" });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] }, { agents: [continued] });
  tab.answer(
    ACT_KIND.CODING_AGENTS_START,
    { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
    { agent: continued },
  );
  await tab.mount();
  const continueAgent = tab.control().continueAgent ?? assert.fail("a Start could run");

  let failed: Failure | undefined;
  await act(async () => {
    failed = await continueAgent(SOURCE);
  });
  assert.equal(failed?.text, "The agent could not be started. Try again.");
  assert.deepEqual(tab.started, []);
  await act(async () => {
    failed = await continueAgent(SOURCE);
  });
  await settle();

  assert.equal(failed, undefined);
  assert.deepEqual(startPayloads(tab.asked), [
    { taskId: TASK, idempotencyKey: "key-1", from: { agentId: SOURCE } },
    { taskId: TASK, idempotencyKey: "key-1", from: { agentId: SOURCE } },
  ]);
  assert.deepEqual(tab.started, [AGENT]);
  assert.deepEqual(
    tab.control().agents?.map((agent) => agent.from?.agentId),
    [SOURCE],
    "the new agent joins the list, naming what it continues",
  );
  assert.equal(tab.control().start.note, undefined, "the toolbar's Start says nothing of it");
});

test("a continue carries the developer's words and files as its note, other words or a refusal minting a key of their own, and each agent continued keeps its own key", async () => {
  const SOURCE = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
  const OTHER = "ae3c8c6b-5f4a-4fad-8d88-8b6e9c4a5d43";
  const notes = { name: "notes.md", mediaType: "text/plain", data: "IyBOb3Rlcw==" } as const;
  const tab = mount({ taskId: TASK, repository: "acme/relay" });
  tab.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] });
  tab.answer(
    ACT_KIND.CODING_AGENTS_START,
    { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
    { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
    { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
    { failure: CODING_AGENT_CALL_FAILURE.AGENT_NOT_READY },
    { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED },
  );
  await tab.mount();
  const continueAgent = tab.control().continueAgent ?? assert.fail("a Start could run");

  await act(async () => {
    await continueAgent(SOURCE, "Add the dark variant.", [notes]);
    await continueAgent(SOURCE, "Add the light variant.", [notes]);
    await continueAgent(OTHER);
    await continueAgent(SOURCE, "Add the light variant.", [notes]);
    await continueAgent(SOURCE, "Add the light variant.", [notes]);
  });

  assert.deepEqual(
    startPayloads(tab.asked).map(({ idempotencyKey, from, note, attachments }) => ({
      idempotencyKey,
      from,
      note,
      attachments,
    })),
    [
      {
        idempotencyKey: "key-1",
        from: { agentId: SOURCE },
        note: "Add the dark variant.",
        attachments: [notes],
      },
      {
        idempotencyKey: "key-2",
        from: { agentId: SOURCE },
        note: "Add the light variant.",
        attachments: [notes],
      },
      {
        idempotencyKey: "key-3",
        from: { agentId: OTHER },
        note: undefined,
        attachments: undefined,
      },
      {
        idempotencyKey: "key-2",
        from: { agentId: SOURCE },
        note: "Add the light variant.",
        attachments: [notes],
      },
      {
        idempotencyKey: "key-4",
        from: { agentId: SOURCE },
        note: "Add the light variant.",
        attachments: [notes],
      },
    ],
  );
});

test("a second continue of an agent once the first landed mints a key of its own and lands a second agent, from a press or from the task's draft, never answered with the first", async () => {
  const SOURCE = "9d2b7b5a-4e3f-4e9c-9c77-7a5d8b3f4c32";
  const from = { agentId: SOURCE, steps: 3, totalSteps: 3 };
  const first = { ...STARTED, from };
  const second = { ...STARTED, id: "ae3c8c6b-5f4a-4fad-8d88-8b6e9c4a5d43", from };
  const third = { ...STARTED, id: "bf4d9d7c-6a5b-40be-9e99-9c7fad5b6e54", from };
  const tab = mount({ taskId: TASK, repository: "acme/relay" });
  tab.answer(
    ACT_KIND.CODING_AGENTS_LIST,
    { agents: [] },
    { agents: [first] },
    { agents: [first, second] },
    { agents: [first, second, third] },
  );
  tab.answer(ACT_KIND.CODING_AGENTS_START, { agent: first }, { agent: second }, { agent: third });
  await tab.mount();
  const continueAgent = tab.control().continueAgent ?? assert.fail("a Start could run");

  await act(async () => {
    await continueAgent(SOURCE);
  });
  await settle();
  await act(async () => {
    await continueAgent(SOURCE);
  });
  await settle();
  // A third from the task's draft, opened as the end line's press opens it.
  let draft = "";
  act(() => {
    draft = tab.control().onContinueDraft(SOURCE, "", []);
  });
  const fork = tab.control().draft?.fork ?? assert.fail("the draft continues the agent");
  await act(async () => {
    await tab.control().startFork(draft, fork, "", undefined, [], []);
  });
  await settle();

  assert.deepEqual(
    startPayloads(tab.asked).map((each) => each.idempotencyKey),
    ["key-1", "key-2", draft],
  );
  assert.equal(new Set(["key-1", "key-2", draft]).size, 3, "each continue under a key of its own");
  assert.deepEqual(tab.started, [first.id, second.id, third.id]);
});

test("no continue is offered while no Start could run: an archived task, a task naming no repository, or an agent read with no task", async () => {
  const archived = mount({ taskId: TASK, repository: "acme/relay", archived: true });
  archived.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] });
  await archived.mount();
  assert.equal(archived.control().continueAgent, undefined);

  const bare = mount({ taskId: TASK, repository: null });
  bare.answer(ACT_KIND.CODING_AGENTS_LIST, { agents: [] });
  await bare.mount();
  assert.equal(bare.control().continueAgent, undefined);

  const page = mount({ taskId: undefined, agentId: AGENT, repository: null });
  page.answer(ACT_KIND.CODING_AGENTS_PAGE, { failure: CODING_AGENT_CALL_FAILURE.UNANSWERED });
  await page.mount();
  assert.equal(page.control().continueAgent, undefined);
});
