import assert from "node:assert/strict";
import type { ToolContext as EveToolContext } from "eve/tools";
import { afterAll, test } from "vitest";
import {
  ACTION_OUTPUT_STATUS,
  ACTION_RESULT_STATUS,
  ACTION_TOOL,
  BRAIN_RUN_EVENT,
  BRAIN_TOOL,
  BRAIN_TURN_ORIGIN,
  BRAIN_TURN_TRIGGER,
  CONVERSATION_EVENT_KIND,
  type ProviderSessionObservation,
  SESSION_STATUS,
  sessionKey,
  type WireRecord,
} from "../server/core";
import { CONVERSATION_KIND } from "../server/db/storage-vocabulary";
import { offerBriefing } from "../server/hosted/brain-host/announce";
import {
  type HostedActionCarrier,
  type HostedFactsWriter,
  hostedActionCarrier,
} from "../server/hosted/brain-host/performer";
import { hostedRosterFrom } from "../server/hosted/brain-host/roster";
import {
  type HostedToolSeams,
  type HostedTurnStanding,
  hostedToolDeclarations,
  runHostedTool,
} from "../server/hosted/brain-host/tools";
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

function factsWriter(remembered: string[]): HostedFactsWriter {
  return {
    list: async () => remembered.map((words, index) => ({ id: `f-${index}`, words })),
    remember: async (ask) => {
      remembered.push(ask.words);
      return true;
    },
    forget: async () => false,
  };
}

interface Fakes {
  readonly remembered: string[];
  readonly executed: WireRecord[];
  readonly carrier: HostedActionCarrier;
  readonly seams: HostedToolSeams;
}

function fakes(options: { readonly apiKey?: string } = { apiKey: "conductor-key" }): Fakes {
  const remembered: string[] = [];
  const executed: WireRecord[] = [];
  const roster = async () => hostedRosterFrom(ROSTER, NOW);
  const carrier = hostedActionCarrier({
    roster,
    defaults: async () => ({}),
    facts: factsWriter(remembered),
    apiKey: async () => options.apiKey,
    execute: async (input) => {
      executed.push({ kind: input.kind, provider_id: input.providerId, ...input.fields });
      return { result: ACTION_RESULT_STATUS.ACCEPTED };
    },
  });
  const seams: HostedToolSeams = {
    conversation: { userId: "user-a", conversationId: "c-1" },
    roster,
    carrier,
    transcripts: {
      whole: async () => ({ status: ACTION_RESULT_STATUS.ACCEPTED, transcript: "Developer: hi" }),
    },
    workspace: {
      read: async () => ({ ok: false, reason: "not read in these tests" }),
      write: async () => ({ ok: false, reason: "not written in these tests" }),
      loadSkill: async () => ({ ok: false, reason: "no skills" }),
    },
    now: () => NOW,
  };
  return { remembered, executed, carrier, seams };
}

const ASK: HostedTurnStanding = { trigger: BRAIN_TURN_TRIGGER.ASK, turnId: "t-1", runId: "t-1" };
const OBSERVATION: HostedTurnStanding = {
  trigger: BRAIN_TURN_TRIGGER.ROSTER,
  turnId: "t-2",
  runId: "t-2",
};

/** One call of one tool, as eve would carry it: the declared name, the model's arguments, the turn's standing. */
function call(
  seams: HostedToolSeams,
  turn: HostedTurnStanding,
  name: string,
  input: WireRecord,
  context = eveContext(),
) {
  assert.ok(
    hostedToolDeclarations(turn.trigger).some((declared) => declared.name === name),
    `${name} is offered`,
  );
  return runHostedTool(name, input, context, seams, turn);
}

test("an ask is offered the catalog under the hosted policy, an observation the same set plus announce", () => {
  const ask = hostedToolDeclarations(ASK.trigger).map((declared) => declared.name);
  const observation = hostedToolDeclarations(OBSERVATION.trigger).map((declared) => declared.name);
  assert.equal(ask.includes(BRAIN_TOOL.ANNOUNCE), false);
  assert.equal(observation.includes(BRAIN_TOOL.ANNOUNCE), true);
  assert.deepEqual(
    observation.filter((name) => name !== BRAIN_TOOL.ANNOUNCE),
    ask,
  );
  assert.equal(ask.includes(ACTION_TOOL.OPEN_SESSION), false);
});

test("remember_fact runs admission inside its module and lands in the facts through the carrier", async () => {
  const { seams, remembered } = fakes();
  const answer = await call(seams, ASK, ACTION_TOOL.REMEMBER_FACT, {
    words: "prefers short replies",
  });
  assert.equal(answer.status, ACTION_OUTPUT_STATUS.ACCEPTED);
  assert.deepEqual(remembered, ["prefers short replies"]);

  const unreadable = await call(seams, ASK, ACTION_TOOL.REMEMBER_FACT, { words: 7 });
  assert.equal(unreadable.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.deepEqual(remembered, ["prefers short replies"]);
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

test("announce answers accepted for words and refuses an empty briefing; it is offered only on an observation turn", async () => {
  const { seams } = fakes();
  const offered = await call(seams, OBSERVATION, BRAIN_TOOL.ANNOUNCE, {
    briefing: "One agent finished.",
  });
  assert.equal(offered.status, ACTION_RESULT_STATUS.ACCEPTED);
  const empty = await call(seams, OBSERVATION, BRAIN_TOOL.ANNOUNCE, { briefing: "" });
  assert.equal(empty.status, ACTION_RESULT_STATUS.REJECTED);
  const withheld = await runHostedTool(
    BRAIN_TOOL.ANNOUNCE,
    { briefing: "x" },
    eveContext(),
    seams,
    ASK,
  );
  assert.equal(withheld.status, ACTION_RESULT_STATUS.REJECTED);
});

test("a call whose turn is over is refused before anything runs", async () => {
  const { seams, remembered } = fakes();
  const answer = await call(
    seams,
    ASK,
    ACTION_TOOL.REMEMBER_FACT,
    { words: "too late" },
    eveContext(true),
  );
  assert.equal(answer.status, ACTION_OUTPUT_STATUS.REFUSED);
  assert.deepEqual(remembered, []);
});

test("a briefing is offered as an event on the turn's own journal row, and refused where no journal stands", async () => {
  const userId = await database.createUser();
  const conversationId = await insertConversation(database.run, {
    userId,
    kind: CONVERSATION_KIND.OBSERVED,
  });
  const target: ConversationTarget = { userId, conversationId };
  const writer = await storeWriter({
    run: database.run,
    tools: CATALOG_TOOL_SET,
    now: () => new Date(NOW),
  });
  const turnId = "6f1d2c3b-4a5e-4f60-8a7b-9c0d1e2f3a4b";

  assert.equal(
    await offerBriefing({ run: database.run, writer, now: () => NOW }, target, turnId),
    false,
  );

  const stamp = { conversationId: sessionKey(conversationId), turnId };
  await writer.consume(target, {
    ...stamp,
    sequence: 1,
    kind: BRAIN_RUN_EVENT.TURN_STARTED,
    origin: BRAIN_TURN_ORIGIN.OBSERVATION,
    trigger: BRAIN_TURN_TRIGGER.ROSTER,
    at: NOW,
  });
  await writer.consume(target, {
    ...stamp,
    sequence: 2,
    kind: BRAIN_RUN_EVENT.TOOL_CALL_STARTED,
    callId: "call-a",
    name: BRAIN_TOOL.ANNOUNCE,
    input: { briefing: "One agent finished." },
  });
  assert.equal(
    await offerBriefing({ run: database.run, writer, now: () => NOW }, target, turnId),
    true,
  );
  const recorded = await readEventsByConversation(database.run, conversationId);
  assert.deepEqual(
    recorded.map((event) => event.kind),
    [CONVERSATION_EVENT_KIND.SPEECH_OFFERED],
  );
});
