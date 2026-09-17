import assert from "node:assert/strict";
import {
  maximumMemorySearchResults,
  NOTEBOOK_MEMORY_TOOL,
  type NotebookMemoryAccess,
} from "@sidecar/memory";
import { Effect, Redacted, Result } from "effect";
import type { ToolContext as EveToolContext } from "eve/tools";
import { afterAll, test } from "vitest";
import {
  ACTION_KIND,
  ACTION_OUTPUT_STATUS,
  ACTION_REFUSAL,
  ACTION_RESULT_STATUS,
  ACTION_TOOL,
  BRAIN_RUN_EVENT,
  BRAIN_TOOL,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  type BrainChildAccess,
  CONVERSATION_EVENT_KIND,
  type ProviderSessionObservation,
  SESSION_STATUS,
  sessionKey,
  type WireRecord,
  WORKSPACE_TASK_SUPPORT,
  type WorkspaceAgentSelection,
} from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { offerBriefing } from "../server/hosted/brain-host/announce";
import {
  type HostedActionCarrier,
  hostedActionCarrier,
} from "../server/hosted/brain-host/performer";
import { hostedRosterFrom } from "../server/hosted/brain-host/roster";
import { hostedToolDeclarations, runHostedTool } from "../server/hosted/brain-host/tools";
import { CATALOG_TOOL_SET } from "../server/hosted/brain-tool-set";
import type { ObservedRoster } from "../server/hosted/observed-roster";
import { type ConversationTarget, storeWriter } from "../server/hosted/store";
import { openHostedStoreTestDatabase } from "./support/hosted-store-database";
import { insertConversation, readEventsByConversation } from "./support/store-rows";

/**
 * The brain's tools as eve runs them, over fakes for everything the host
 * reaches: an action goes through admission to the carrier, a read is refused
 * for a session the roster does not hold, a briefing is offered on the turn's
 * own journal, and nothing runs once the turn is over. Synthetic roster and
 * accounts throughout.
 */

const NOW = 1_800_000_000_000;
const SESSION_UUID = "11111111-1111-4111-8111-111111111111";
const OTHER_UUID = "22222222-2222-4222-8222-222222222222";

const database = await openHostedStoreTestDatabase();
afterAll(() => database.close());

function observation(id: string): ProviderSessionObservation {
  return {
    providerSessionId: id,
    title: `Chat ${id}`,
    status: SESSION_STATUS.WORKING,
    lastActivityAt: NOW,
    workspace: { providerWorkspaceId: "workspace-a", name: "workspace-a-name" },
    detail: { repository: "repo", link: `https://conductor.test/sessions/${id}` },
    advertises: [{ kind: "message" }],
  };
}

const ROSTER: ObservedRoster = {
  version: 1,
  providers: [
    {
      providerId: "conductor",
      keyFingerprint: "f",
      observations: [observation(SESSION_UUID)],
      projects: [],
    },
  ],
};

function eveContext(aborted = false): EveToolContext {
  const controller = new AbortController();
  if (aborted) controller.abort();
  const unreachable = (): never => {
    throw new Error("not reached in these tests");
  };
  return {
    session: {
      id: "wrun_test",
      auth: { current: null, initiator: null },
      turn: { id: "turn_0", sequence: 0 },
    },
    abortSignal: controller.signal,
    callId: "call-1",
    toolName: "test",
    getToken: unreachable,
    requireAuth: unreachable,
    getSandbox: unreachable,
    getSkill: unreachable,
  };
}

/** The two shapes `runHostedTool` takes, named from its own signature: the module keeps them private. */
type HostedToolSeams = Parameters<typeof runHostedTool>[3];
type HostedTurnStanding = Parameters<typeof runHostedTool>[4];

interface Fakes {
  readonly executed: WireRecord[];
  readonly carrier: HostedActionCarrier;
  readonly seams: HostedToolSeams;
}

function fakes(options: { readonly apiKey?: string } = { apiKey: "conductor-key" }): Fakes {
  const executed: WireRecord[] = [];
  const roster = () => Effect.succeed(hostedRosterFrom(ROSTER, NOW));
  const carrier = hostedActionCarrier({
    roster,
    defaults: () => Effect.succeed({}),
    apiKey: () =>
      Effect.succeed(options.apiKey === undefined ? undefined : Redacted.make(options.apiKey)),
    execute: (input) =>
      Effect.sync(() => {
        executed.push({ kind: input.kind, provider_id: input.providerId, ...input.fields });
        return { result: ACTION_RESULT_STATUS.ACCEPTED };
      }),
  });
  const seams: HostedToolSeams = {
    conversation: { userId: "user-a", conversationId: "c-1" },
    roster,
    carrier,
    transcripts: {
      whole: () =>
        Effect.succeed({ status: ACTION_RESULT_STATUS.ACCEPTED, transcript: "Developer: hi" }),
    },
    notebook: unsearchedNotebook,
    children: undefined,
    workspace: {
      read: () => Effect.succeed(Result.fail("not read in these tests")),
      write: () => Effect.succeed(Result.fail("not written in these tests")),
      append: () => Effect.succeed(Result.fail("not appended in these tests")),
      listNotes: () => Effect.succeed([]),
      loadSkill: () => Effect.succeed({ ok: false, reason: "no skills" }),
    },
    now: () => NOW,
  };
  return { executed, carrier, seams };
}

/** A notebook these tests never search: reaching it past the provider is the failure, named. */
const unsearchedNotebook: NotebookMemoryAccess = {
  search: () => Effect.succeed({ status: ACTION_RESULT_STATUS.REJECTED, reason: "not searched" }),
  get: () => Effect.succeed({ status: ACTION_RESULT_STATUS.REJECTED, reason: "not read" }),
};

const ASK: HostedTurnStanding = { trigger: BRAIN_TURN_TRIGGER.ASK, turnId: "t-1", runId: "t-1" };
const OBSERVATION: HostedTurnStanding = {
  trigger: BRAIN_TURN_TRIGGER.ROSTER,
  turnId: "t-2",
  runId: "t-2",
};

/** One call of one tool, as eve would carry it: the declared name, the model's arguments, the turn's standing. */
/** No quiet instant stands on the account: the policy's own set. */
const LOUD = { quiet: false } as const;

function call(
  seams: HostedToolSeams,
  turn: HostedTurnStanding,
  name: string,
  input: WireRecord,
  context = eveContext(),
) {
  assert.ok(
    hostedToolDeclarations(turn.trigger, LOUD).some((declared) => declared.name === name),
    `${name} is offered`,
  );
  return Effect.runPromise(runHostedTool(name, input, context, seams, turn));
}

test("an ask is offered the catalog under the hosted policy, an observation the same set plus announce and less the message send", () => {
  const ask = hostedToolDeclarations(ASK.trigger, LOUD).map((declared) => declared.name);
  const observation = hostedToolDeclarations(OBSERVATION.trigger, LOUD).map(
    (declared) => declared.name,
  );
  assert.equal(ask.includes(BRAIN_TOOL.ANNOUNCE), false);
  assert.equal(observation.includes(BRAIN_TOOL.ANNOUNCE), true);
  // The send carries an ask to an agent and nothing else: an observation's lines are the
  // developer's own words to that agent, and a message sent into the chat would come back the
  // next minute as one of them.
  assert.equal(ask.includes(ACTION_TOOL.SEND_SESSION_MESSAGE), true);
  assert.equal(observation.includes(ACTION_TOOL.SEND_SESSION_MESSAGE), false);
  assert.deepEqual(
    observation.filter((name) => name !== BRAIN_TOOL.ANNOUNCE),
    ask.filter((name) => name !== ACTION_TOOL.SEND_SESSION_MESSAGE),
  );
  assert.equal(ask.includes(ACTION_TOOL.OPEN_SESSION), false);
  // A child's task is answered in words like an ask and is offered the ask's set less the
  // session tools, so delegation stands one level deep; a child's completion is a note handed
  // to the requester and is offered the ask's set plus announce, the send included, since what
  // it reads is a child's report and not a chat's own lines.
  const sessionTools: readonly string[] = [
    BRAIN_TOOL.SESSIONS_SPAWN,
    BRAIN_TOOL.SUBAGENTS,
    BRAIN_TOOL.SESSIONS_LIST,
    BRAIN_TOOL.SESSIONS_HISTORY,
  ];
  assert.deepEqual(
    hostedToolDeclarations(BRAIN_TURN_TRIGGER.CHILD_TASK, LOUD).map((declared) => declared.name),
    ask.filter((name) => !sessionTools.includes(name)),
  );
  const childCompletion = hostedToolDeclarations(BRAIN_TURN_TRIGGER.CHILD_COMPLETION, LOUD).map(
    (declared) => declared.name,
  );
  assert.equal(childCompletion.includes(BRAIN_TOOL.ANNOUNCE), true);
  assert.equal(childCompletion.includes(ACTION_TOOL.SEND_SESSION_MESSAGE), true);
  assert.deepEqual(
    childCompletion.filter((name) => name !== BRAIN_TOOL.ANNOUNCE),
    ask,
  );
});

test("an observation turn's call of the message send is refused as no tool of its own, before admission or the carrier", async () => {
  const { seams, executed } = fakes();
  assert.equal(
    hostedToolDeclarations(OBSERVATION.trigger, LOUD).some(
      (declared) => declared.name === ACTION_TOOL.SEND_SESSION_MESSAGE,
    ),
    false,
  );
  const answer = await Effect.runPromise(
    runHostedTool(
      ACTION_TOOL.SEND_SESSION_MESSAGE,
      {
        provider_id: "conductor",
        provider_session_id: SESSION_UUID,
        text: "the developer said so",
      },
      eveContext(),
      seams,
      OBSERVATION,
    ),
  );
  assert.deepEqual(answer, { status: "rejected", reason: ACTION_REFUSAL.NO_TOOL });
  assert.deepEqual(executed, []);
});

test("a quiet account's observation turn is offered the same set less announce; an ask's set does not change", () => {
  const observation = hostedToolDeclarations(OBSERVATION.trigger, LOUD).map(
    (declared) => declared.name,
  );
  const quiet = hostedToolDeclarations(OBSERVATION.trigger, { quiet: true }).map(
    (declared) => declared.name,
  );
  assert.deepEqual(
    quiet,
    observation.filter((name) => name !== BRAIN_TOOL.ANNOUNCE),
  );
  assert.deepEqual(
    hostedToolDeclarations(ASK.trigger, { quiet: true }).map((declared) => declared.name),
    hostedToolDeclarations(ASK.trigger, LOUD).map((declared) => declared.name),
  );
});

test("a session message is admitted against the stored roster and carried with the account's key; no key, no carry", async () => {
  const withKey = fakes();
  const carried = await call(withKey.seams, ASK, ACTION_TOOL.SEND_SESSION_MESSAGE, {
    provider_id: "conductor",
    provider_session_id: SESSION_UUID,
    text: "please continue",
  });
  assert.equal(carried.status, ACTION_OUTPUT_STATUS.ACCEPTED);
  assert.deepEqual(withKey.executed, [
    {
      kind: "message",
      provider_id: "conductor",
      provider_session_id: SESSION_UUID,
      text: "please continue",
    },
  ]);

  const unobserved = await call(withKey.seams, ASK, ACTION_TOOL.SEND_SESSION_MESSAGE, {
    provider_id: "conductor",
    provider_session_id: OTHER_UUID,
    text: "hello",
  });
  assert.equal(unobserved.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.equal(withKey.executed.length, 1);

  const noKey = fakes({});
  const refused = await call(noKey.seams, ASK, ACTION_TOOL.SEND_SESSION_MESSAGE, {
    provider_id: "conductor",
    provider_session_id: SESSION_UUID,
    text: "please continue",
  });
  assert.equal(refused.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.deepEqual(noKey.executed, []);
});

test("a created workspace keeps the created session identity in its action envelope", async () => {
  const roster = () =>
    Effect.succeed(
      hostedRosterFrom(
        {
          version: 1,
          providers: [
            {
              providerId: "conductor",
              keyFingerprint: "f",
              observations: [observation(SESSION_UUID)],
              projects: [
                {
                  providerProjectId: "project-1",
                  repository: "repo",
                  taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
                },
              ],
            },
          ],
        },
        NOW,
      ),
    );
  const carrier = hostedActionCarrier({
    roster,
    defaults: () => Effect.succeed({}),
    apiKey: () => Effect.succeed(Redacted.make("conductor-key")),
    execute: () =>
      Effect.succeed({
        result: ACTION_RESULT_STATUS.ACCEPTED,
        providerSessionId: "workspace-created",
      }),
  });
  const seams: HostedToolSeams = {
    conversation: { userId: "user-a", conversationId: "c-1" },
    roster,
    carrier,
    transcripts: {
      whole: () =>
        Effect.succeed({ status: ACTION_RESULT_STATUS.ACCEPTED, transcript: "Developer: hi" }),
    },
    notebook: unsearchedNotebook,
    children: undefined,
    workspace: {
      read: () => Effect.succeed(Result.fail("not read in these tests")),
      write: () => Effect.succeed(Result.fail("not written in these tests")),
      append: () => Effect.succeed(Result.fail("not appended in these tests")),
      listNotes: () => Effect.succeed([]),
      loadSkill: () => Effect.succeed({ ok: false, reason: "no skills" }),
    },
    now: () => NOW,
  };

  const created = await call(seams, ASK, ACTION_TOOL.CREATE_WORKSPACE, {
    provider_id: "conductor",
    project_id: "project-1",
    name: "Checkout",
  });

  assert.deepEqual(created, {
    status: ACTION_OUTPUT_STATUS.ACCEPTED,
    target: { providerId: "conductor" },
    createdSession: { providerId: "conductor", providerSessionId: "workspace-created" },
  });
});

test("the carrier hands the stored agent pairing to a creation and a spawn, and to nothing else", async () => {
  const executed: {
    kind: string;
    fields: WireRecord;
    agentSelection?: WorkspaceAgentSelection;
  }[] = [];
  const roster = () =>
    Effect.succeed(
      hostedRosterFrom(
        {
          version: 1,
          providers: [
            {
              providerId: "conductor",
              keyFingerprint: "f",
              observations: [observation(SESSION_UUID)],
              projects: [
                {
                  providerProjectId: "project-1",
                  repository: "repo",
                  taskSupport: WORKSPACE_TASK_SUPPORT.OPTIONAL,
                },
              ],
            },
          ],
        },
        NOW,
      ),
    );
  const stored: WorkspaceAgentSelection = { agent: "claude", model: "fable-5-1", effort: "high" };
  const carrier = hostedActionCarrier({
    roster,
    defaults: () => Effect.succeed({ agentDefaults: { conductor: stored } }),
    apiKey: () => Effect.succeed(Redacted.make("conductor-key")),
    execute: (input) =>
      Effect.sync(() => {
        executed.push({
          kind: input.kind,
          fields: input.fields,
          ...(input.agentSelection === undefined
            ? undefined
            : { agentSelection: input.agentSelection }),
        });
        return { result: ACTION_RESULT_STATUS.ACCEPTED, providerSessionId: "workspace-created" };
      }),
  });
  const seams: HostedToolSeams = {
    conversation: { userId: "user-a", conversationId: "c-1" },
    roster,
    carrier,
    transcripts: {
      whole: () =>
        Effect.succeed({ status: ACTION_RESULT_STATUS.ACCEPTED, transcript: "Developer: hi" }),
    },
    notebook: unsearchedNotebook,
    children: undefined,
    workspace: {
      read: () => Effect.succeed(Result.fail("not read in these tests")),
      write: () => Effect.succeed(Result.fail("not written in these tests")),
      append: () => Effect.succeed(Result.fail("not appended in these tests")),
      listNotes: () => Effect.succeed([]),
      loadSkill: () => Effect.succeed({ ok: false, reason: "no skills" }),
    },
    now: () => NOW,
  };

  // The call names a model, an effort, and an agent of its own, as the
  // production record showed the brain doing on every creation. None is a
  // field the tool declares, so none reaches admission or the execution.
  const created = await call(seams, ASK, ACTION_TOOL.CREATE_WORKSPACE, {
    provider_id: "conductor",
    project_id: "project-1",
    name: "Checkout",
    agent: "codex",
    model: "gpt-5.6-terra",
    effort: "high",
  });
  assert.equal(created.status, ACTION_OUTPUT_STATUS.ACCEPTED);
  const messaged = await call(seams, ASK, ACTION_TOOL.SEND_SESSION_MESSAGE, {
    provider_id: "conductor",
    provider_session_id: SESSION_UUID,
    text: "hello",
  });
  assert.equal(messaged.status, ACTION_OUTPUT_STATUS.ACCEPTED);

  // The pairing is read for the creation alone and rides it, since the fields
  // the execution admits again carry no model to outrank it.
  assert.deepEqual(executed, [
    {
      kind: ACTION_KIND.CREATE_WORKSPACE,
      fields: { provider_id: "conductor", project_id: "project-1", name: "Checkout" },
      agentSelection: stored,
    },
    {
      kind: ACTION_KIND.MESSAGE,
      fields: { provider_id: "conductor", provider_session_id: SESSION_UUID, text: "hello" },
    },
  ]);
});

test("read_transcript answers for a session the roster holds and refuses one it does not", async () => {
  const { seams } = fakes();
  const held = await call(seams, ASK, BRAIN_TOOL.READ_TRANSCRIPT, {
    provider_id: "conductor",
    provider_session_id: SESSION_UUID,
  });
  assert.equal(held.status, ACTION_RESULT_STATUS.ACCEPTED);
  const unheld = await call(seams, ASK, BRAIN_TOOL.READ_TRANSCRIPT, {
    provider_id: "conductor",
    provider_session_id: OTHER_UUID,
  });
  assert.equal(unheld.status, ACTION_RESULT_STATUS.REJECTED);
});

test("memory_search and memory_get dispatch through the memory provider to the notebook access, the arguments trimmed and bounded on the way", async () => {
  const asks: WireRecord[] = [];
  const notebook: NotebookMemoryAccess = {
    search: (ask) =>
      Effect.sync(() => {
        asks.push({ query: ask.query, max_results: ask.maxResults ?? null });
        return { status: ACTION_RESULT_STATUS.ACCEPTED, mode: "keyword", results: [] };
      }),
    get: (ask) =>
      Effect.sync(() => {
        asks.push({ path: ask.path, from: ask.from ?? null, lines: ask.lines ?? null });
        return { status: ACTION_RESULT_STATUS.ACCEPTED, path: ask.path, text: "" };
      }),
  };
  const seams: HostedToolSeams = { ...fakes().seams, notebook };
  const searched = await call(seams, ASK, NOTEBOOK_MEMORY_TOOL.SEARCH, {
    query: "  notch   decision ",
    max_results: 500,
  });
  assert.equal(searched.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.equal(searched.mode, "keyword");
  const read = await call(seams, OBSERVATION, NOTEBOOK_MEMORY_TOOL.GET, {
    path: "MEMORY.md",
    from: 3,
    lines: 2,
  });
  assert.equal(read.status, ACTION_RESULT_STATUS.ACCEPTED);
  assert.deepEqual(asks, [
    { query: "notch decision", max_results: maximumMemorySearchResults },
    { path: "MEMORY.md", from: 3, lines: 2 },
  ]);

  const empty = await call(seams, ASK, NOTEBOOK_MEMORY_TOOL.SEARCH, { query: "   " });
  assert.equal(empty.status, ACTION_RESULT_STATUS.REJECTED);
  assert.equal(asks.length, 2, "an empty query never reaches the notebook");
});

test("announce answers accepted for words and refuses an empty briefing; it is offered only on an observation turn", async () => {
  const { seams } = fakes();
  const offered = await call(seams, OBSERVATION, BRAIN_TOOL.ANNOUNCE, {
    briefing: "One agent finished.",
  });
  assert.equal(offered.status, ACTION_RESULT_STATUS.ACCEPTED);
  const empty = await call(seams, OBSERVATION, BRAIN_TOOL.ANNOUNCE, { briefing: "" });
  assert.equal(empty.status, ACTION_RESULT_STATUS.REJECTED);
  const withheld = await Effect.runPromise(
    runHostedTool(BRAIN_TOOL.ANNOUNCE, { briefing: "x" }, eveContext(), seams, ASK),
  );
  assert.equal(withheld.status, ACTION_RESULT_STATUS.REJECTED);
});

test("a call whose turn is over is refused before anything runs", async () => {
  const { seams, executed } = fakes();
  const answer = await call(
    seams,
    ASK,
    ACTION_TOOL.SEND_SESSION_MESSAGE,
    { provider_id: "conductor", provider_session_id: SESSION_UUID, text: "too late" },
    eveContext(true),
  );
  assert.equal(answer.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.deepEqual(executed, []);
});

test("a briefing is offered as an event on the turn's own journal row, and refused where no journal stands", async () => {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.OBSERVED,
  });
  const target: ConversationTarget = { userId, conversationId };
  const writer = await database.run(
    storeWriter({
      tools: CATALOG_TOOL_SET,
    }),
  );
  const turnId = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

  assert.equal(
    await database.run(offerBriefing({ writer, now: () => NOW }, target, turnId)),
    false,
  );

  const stamp = { conversationId: sessionKey(conversationId), turnId };
  await database.run(
    writer.consume(target, {
      ...stamp,
      sequence: 1,
      kind: BRAIN_RUN_EVENT.TURN_STARTED,
      origin: BRAIN_TURN_ORIGIN.OBSERVATION,
      trigger: BRAIN_TURN_TRIGGER.ROSTER,
      at: NOW,
    }),
  );
  await database.run(
    writer.consume(target, {
      ...stamp,
      sequence: 2,
      kind: BRAIN_RUN_EVENT.TOOL_CALL_STARTED,
      callId: "call-a",
      name: BRAIN_TOOL.ANNOUNCE,
      input: { briefing: "One agent finished." },
    }),
  );
  assert.equal(await database.run(offerBriefing({ writer, now: () => NOW }, target, turnId)), true);
  const recorded = await readEventsByConversation(database.run, conversationId);
  assert.deepEqual(
    recorded.map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED],
  );
});

test("a spawn is offered to an ask and an observation and reaches the children access; a child's task is refused at the policy", async () => {
  const spawns: Parameters<BrainChildAccess["spawn"]>[0][] = [];
  const children: BrainChildAccess = {
    sessionKey: sessionKey("c-1"),
    spawn: (ask) =>
      Effect.sync(() => {
        spawns.push(ask);
        return {
          accepted: true,
          receipt: { childId: "child-1", childSessionKey: sessionKey("child-1") },
        };
      }),
    list: () => Effect.succeed([]),
    cancel: () => Effect.succeed(undefined),
    conversations: () => Effect.succeed([]),
    lines: () => Effect.succeed(undefined),
  };
  for (const turn of [ASK, OBSERVATION]) {
    const seams: HostedToolSeams = { ...fakes().seams, children };
    const answered = await call(seams, turn, BRAIN_TOOL.SESSIONS_SPAWN, { task: "fixture task" });
    assert.equal(answered.status, ACTION_RESULT_STATUS.ACCEPTED);
    assert.equal(answered.child_id, "child-1");
  }
  assert.deepEqual(
    spawns.map((ask) => ask.task),
    ["fixture task", "fixture task"],
  );
  const childTask: HostedTurnStanding = {
    trigger: BRAIN_TURN_TRIGGER.CHILD_TASK,
    turnId: "t-3",
    runId: "t-3",
  };
  const refused = await Effect.runPromise(
    runHostedTool(
      BRAIN_TOOL.SESSIONS_SPAWN,
      { task: "fixture task" },
      eveContext(),
      fakes().seams,
      childTask,
    ),
  );
  assert.deepEqual(refused, { status: "rejected", reason: ACTION_REFUSAL.NO_TOOL });
});
