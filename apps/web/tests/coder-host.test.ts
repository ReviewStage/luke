import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Database } from "@sidecar/database/core/query";
import {
  type CodingAgentBriefText,
  createCodingAgent,
  latestTurnsOf,
  type NewCodingAgent,
  readCodingAgent,
} from "@sidecar/database/models/coding-agent-store";
import { hostTurnId } from "@sidecar/database/models/ids";
import { openPlanConversation, readPlan } from "@sidecar/database/models/plan-store";
import { type ConversationTarget, storeWriter } from "@sidecar/database/models/writer";
import { asks, turns } from "@sidecar/database/schemas/storage";
import { getTestDB } from "@sidecar/database/testing";
import { CODING_AGENT_STATUS, ROLLOUT_ROLE } from "@sidecar/hosted/coding-agent-wire";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { planSections } from "@sidecar/hosted/plan-document";
import { FAST_ACCESS } from "@sidecar/hosted/provider-key-wire";
import type { WireBoundaryInput } from "@sidecar/wire";
import { isReasoningUIPart, isTextUIPart, isToolUIPart, type LanguageModel } from "ai";
import { eq } from "drizzle-orm";
import { Clock, Effect, Layer, Option, Redacted, Result, Schema } from "effect";
import { TestClock } from "effect/testing";
import type { MessageStreamEvent } from "eve/client";
import type { SessionAuth, SessionAuthContext } from "eve/context";
import {
  ACTION_RESULT_STATUS,
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
} from "../server/core";
import { BRAIN_HOST_ATTRIBUTE, BRAIN_HOST_TURN } from "../server/hosted/brain-host/bounds";
import type { AdmittedConversation } from "../server/hosted/brain-host/conversation";
import { memoryRelayState } from "../server/hosted/brain-host/relay";
import { CODER_REFUSAL } from "../server/hosted/coder-host/bounds";
import { type CoderHost, coderHost } from "../server/hosted/coder-host/host";
import type { ProviderKeys } from "../server/hosted/coder-host/model";
import { PLAN_READ_REFUSAL } from "../server/hosted/coder-host/plan-read";
import type { CoderHostSeams } from "../server/hosted/coder-host/production";
import { REPORT_REFUSAL } from "../server/hosted/coder-host/report";
import { codingAgentStatusOf, standingReportOf } from "../server/hosted/coder-host/status";
import { CODER_TOOL, CODER_TOOL_SET } from "../server/hosted/coder-host/tool-set";
import { CURSOR_START, transcriptPast } from "../server/hosted/coder-host/transcript";
import { modelCatalogOf, type OfferedModel } from "../server/hosted/model-catalog";
import { stampedEveEvent } from "./support/eve-events";
import { type FakeEve, fakeEve } from "./support/fake-eve";
import { githubReaching, openGithubUser } from "./support/github-app-fake";
import { noNetwork } from "./support/no-network";
import { sandboxDouble } from "./support/repository-sandbox";
import { startPlan } from "./support/workspaces";

/**
 * The coding-agent host through the same functions the coder project's
 * authored files call, over the real migrations on PGlite: the model a step
 * is told from the agent's row and the catalog, the shared relay writing a
 * coding turn's words, reasoning, and tool calls into the store with no ask
 * record beside it, the status the turn row then reads as, and the
 * transcript read held open while the turn runs and let go when it is
 * idle or the hold is out; and a delegation, recorded under the child
 * conversation its call names on the pair the agent chose, which is what
 * the worker's steps are told and what its turn, relayed into that
 * conversation, records. Synthetic accounts, plans, keys, and words
 * throughout.
 */

const NOW = 1_800_000_000_000;

/** The turn a report is made in, where the test reads nothing of which turn it was. */
const REPORTING_TURN = "turn-reporting";

const PLAN_TEXT = "# Teammate invitations\n\n## Goal\n\nInvite a teammate by email.\n";

const OPUS: OfferedModel = {
  id: "anthropic/claude-opus-5.5",
  name: "Claude Opus 5.5",
  provider: MODEL_PROVIDER.ANTHROPIC,
  efforts: ["low", "medium", "high", "max"],
  contextWindow: 1_000_000,
};

const CATALOG: readonly OfferedModel[] = [
  OPUS,
  {
    id: "openai/gpt-6.1-sol",
    name: "GPT-6.1 Sol",
    provider: MODEL_PROVIDER.OPENAI,
    efforts: ["low", "high"],
  },
];

const KEYS: ProviderKeys = {
  anthropic: { key: Redacted.make("sk-ant-fixture") },
  openAi: { key: Redacted.make("sk-openai-fixture") },
};

/** The host over the test's own store, with the writer composed on the test's client, and the title model handed in where a test has one. */
const hostOverStore = (titleModel?: LanguageModel, eve?: FakeEve) =>
  Effect.gen(function* () {
    const writer = yield* storeWriter({ tools: CODER_TOOL_SET });
    const seams: CoderHostSeams = {
      writer: () => Effect.succeed(writer),
      userInfo: () => Effect.succeed(undefined),
      ownership: {
        reachesSession: () => Promise.resolve(false),
        reachesConversation: () => Promise.resolve(false),
      },
      deploymentSecret: () => undefined,
      planEve: (userId) => Effect.succeed(eve?.eve(userId)),
      keys: () => Effect.succeed(KEYS),
      fastRefused: async () => undefined,
      titleModel: () => titleModel,
      research: () => ({ openAi: undefined, spend: Effect.void }),
      scriptedModel: () => false,
      now: () => NOW,
    };
    return coderHost(seams);
  });

function principal(
  id: string,
  attributes: Readonly<Record<string, string>> = {},
): SessionAuthContext {
  return { principalId: id, principalType: "user", authenticator: "test", attributes };
}

/** The developer's own seat in the agent's conversation: the same principal opened the session and speaks now, on a typed turn. */
function ownSeat(userId: string, conversationId: string): SessionAuth {
  const seat = principal(userId, {
    [BRAIN_HOST_ATTRIBUTE.CONVERSATION]: conversationId,
    [BRAIN_HOST_ATTRIBUTE.TURN]: BRAIN_HOST_TURN.TYPED,
  });
  return { current: seat, initiator: seat };
}

let minted = 0;
function mintSession(): string {
  minted += 1;
  return `wrun_01M${String(minted).padStart(22, "0")}`;
}

/** An account with one agent started on a plan, on the model given, whose session nothing has claimed yet. */
const unclaimedAgent = (
  model = "anthropic/claude-opus-5.5",
  effort = "high",
  brief: CodingAgentBriefText = { planSnapshot: PLAN_TEXT, task: null },
  rollout: Pick<NewCodingAgent, "position" | "baseBranch" | "role"> = {},
) =>
  Effect.gen(function* () {
    const userId = yield* openGithubUser();
    const plan = yield* startPlan(userId, {
      name: "Teammate invitations",
      repository: "acme/relay",
    });
    const started = yield* createCodingAgent(userId, {
      planId: plan.id,
      idempotencyKey: `start-${minted}`,
      model,
      effort,
      ...brief,
      ...rollout,
      repository: "acme/relay",
    });
    assert.ok(Option.isSome(started));
    const { agent } = started.value;
    const target: ConversationTarget = { userId, conversationId: agent.conversationId };
    return { userId, agent, target, auth: ownSeat(userId, agent.conversationId) };
  });

/** An account with one agent started on a plan, on the model given, its session claimed as the hook claims it. */
const openAgent = (
  host: CoderHost,
  model = "anthropic/claude-opus-5.5",
  effort = "high",
  brief: CodingAgentBriefText = { planSnapshot: PLAN_TEXT, task: null },
  rollout: Pick<NewCodingAgent, "position" | "baseBranch" | "role"> = {},
) =>
  Effect.gen(function* () {
    const { userId, agent, target, auth } = yield* unclaimedAgent(model, effort, brief, rollout);
    const sessionId = mintSession();
    const starting = yield* host.admitStarting(auth, sessionId);
    assert.ok(Result.isSuccess(starting));
    assert.equal(yield* host.sessionStarted(starting.success, sessionId), true);
    const admitted = yield* host.admit(auth, sessionId);
    assert.ok(Result.isSuccess(admitted));
    return {
      userId,
      agent,
      target,
      auth,
      sessionId,
      starting: starting.success,
      admitted: admitted.success,
    };
  });

/** A GitHub where the developer reaches the agent's repository through one installation, granting the App what the test says; the fixture's own grant when unsaid. */
const reachingRelay = (permissions?: Readonly<Record<string, string>>) =>
  githubReaching([
    {
      id: 7,
      login: "acme",
      repositories: [{ owner: "acme", name: "relay" }],
      ...(permissions === undefined ? undefined : { permissions }),
    },
  ]).layer;

/** The prompt the session composes at its start, on an installation granting the App no CI read. */
const composedPrompt = (host: CoderHost, ...composed: Parameters<CoderHost["prompt"]>) =>
  host.prompt(...composed).pipe(Effect.provide(reachingRelay()));

const stamped = <Event extends Omit<MessageStreamEvent, "meta">>(event: Event) =>
  stampedEveEvent(event, NOW);

/** One coding turn as eve emits it: the plan received, a shell call answered, a thought, words, and the end given. */
function codingTurn(
  turnId: string,
  end: "turn.completed" | "turn.failed" | "turn.cancelled",
): MessageStreamEvent[] {
  const sequence = 0;
  const ended: MessageStreamEvent =
    end === "turn.failed"
      ? stamped({
          type: "turn.failed",
          data: { turnId, sequence, code: "MODEL_CALL_FAILED", message: "the provider refused" },
        })
      : stamped({ type: end, data: { turnId, sequence } });
  return [
    stamped({ type: "turn.started", data: { turnId, sequence } }),
    stamped({ type: "message.received", data: { turnId, sequence, message: PLAN_TEXT } }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 0, modelId: "m" } }),
    stamped({
      type: "actions.requested",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        actions: [
          {
            kind: "tool-call",
            callId: "call-1",
            toolName: CODER_TOOL.BASH,
            input: { command: "cat AGENTS.md" },
          },
        ],
      },
    }),
    stamped({
      type: "action.result",
      data: {
        turnId,
        sequence,
        stepIndex: 0,
        status: "completed",
        result: {
          kind: "tool-result",
          callId: "call-1",
          toolName: CODER_TOOL.BASH,
          output: { status: "completed", exitCode: 0, stdout: "# Agent guide\n", stderr: "" },
        },
      },
    }),
    stamped({
      type: "reasoning.completed",
      data: { turnId, sequence, stepIndex: 0, reasoning: "Read the guide first." },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 0, finishReason: "tool-calls" },
    }),
    stamped({ type: "step.started", data: { turnId, sequence, stepIndex: 1, modelId: "m" } }),
    stamped({
      type: "message.completed",
      data: {
        turnId,
        sequence,
        stepIndex: 1,
        finishReason: "stop",
        message: "The guide is read; the plan fits the code.",
      },
    }),
    stamped({
      type: "step.completed",
      data: { turnId, sequence, stepIndex: 1, finishReason: "stop" },
    }),
    ended,
  ];
}

const STEP_START = "step-start";

const TurnRowSchema = Schema.Struct({
  origin: Schema.String,
  status: Schema.String,
  model: Schema.NullOr(Schema.String),
  reasoningEffort: Schema.NullOr(Schema.String),
  promptHash: Schema.NullOr(Schema.String),
});

/** The turn row as the relay wrote it, read on the test's own client. */
const turnRow = (id: string) =>
  Effect.map(
    Database.use((db) =>
      db
        .select({
          origin: turns.origin,
          status: turns.status,
          model: turns.model,
          reasoningEffort: turns.reasoningEffort,
          promptHash: turns.promptHash,
        })
        .from(turns)
        .where(eq(turns.id, id)),
    ),
    (rows) =>
      rows[0] === undefined ? undefined : Schema.decodeUnknownSync(TurnRowSchema)(rows[0]),
  );

it.layer(Layer.mergeAll(getTestDB(), noNetwork))("the coding-agent host", (it) => {
  it.effect(
    "a conversation that is no agent's is refused a model, an agent, and a prompt alike",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { admitted } = yield* openAgent(host);
        // The same account's other conversation: a plan's, which no agent row names.
        const userId = admitted.target.userId;
        const plan = yield* startPlan(userId, { name: "Billing export" });
        const conversationId = Option.getOrThrow(
          yield* openPlanConversation(userId, plan.id),
        ).conversationId;
        const sessionId = mintSession();
        const auth = ownSeat(userId, conversationId);
        const starting = yield* host.admitStarting(auth, sessionId);
        assert.ok(Result.isSuccess(starting));
        yield* host.sessionStarted(starting.success, sessionId);
        const other = yield* host.admit(auth, sessionId);
        assert.ok(Result.isSuccess(other));

        assert.deepEqual(yield* host.agent(other.success), Result.fail(CODER_REFUSAL.NO_AGENT));
        assert.deepEqual(
          yield* host
            .model(other.success, undefined, "turn-fixture")
            .pipe(Effect.provide(modelCatalogOf(CATALOG))),
          Result.fail(CODER_REFUSAL.NO_AGENT),
        );
      }),
  );

  it.effect(
    "a worker asked for on a fast version is refused as no model Luke offers where Anthropic never granted the key's organization fast mode, and recorded on it where Anthropic did",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { admitted } = yield* openAgent(host);
        const fast: OfferedModel = { ...OPUS, id: "anthropic/claude-opus-5.5-fast" };
        const catalog = [...CATALOG, fast];
        const asked = { model: fast.id };

        const refused = yield* host
          .delegate(admitted, "call-fast-refused", asked)
          .pipe(Effect.provide(modelCatalogOf(catalog, FAST_ACCESS.NOT_ENABLED)));
        const accepted = yield* host
          .delegate(admitted, "call-fast-accepted", asked)
          .pipe(Effect.provide(modelCatalogOf(catalog, FAST_ACCESS.ENABLED)));

        assert.ok(Result.isFailure(refused));
        assert.match(refused.failure, /is no model Luke offers/u);
        assert.deepEqual(accepted, Result.succeed({ model: fast.id, effort: "high" }));
      }),
  );

  it.effect(
    "a rollout's worker is told its base as the branch it is checked out at and opens onto, and a plain agent the default branch",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, admitted } = yield* openAgent(host);
        const base = "luke/invitations/1-schema";

        const stacked = yield* composedPrompt(host, admitted, {
          ...agent,
          position: 2,
          baseBranch: base,
          role: ROLLOUT_ROLE.BUILDER,
        });
        const plain = yield* composedPrompt(host, admitted, agent);

        assert.ok(stacked.text.includes(`at the branch \`${base}\``));
        assert.ok(stacked.text.includes(`\`gh pr create --base ${base}\``));
        assert.ok(plain.text.includes("at its current default branch"));
        assert.ok(!plain.text.includes(base));
        assert.notEqual(stacked.hash, plain.hash);
      }),
  );

  it.effect(
    "a rollout's worker handed no task runs under the pull request's brief, told to build that one pull request and leave the rest out, and still records in the plan",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, admitted } = yield* openAgent(host);
        const worker = {
          ...agent,
          task: null,
          position: 2,
          baseBranch: "luke/invitations/1-schema",
        };

        const briefed = yield* composedPrompt(host, admitted, worker);
        const tasked = yield* composedPrompt(host, admitted, { ...worker, task: "Fix the typo." });
        const planned = yield* composedPrompt(host, admitted, { ...agent, task: null });

        assert.ok(briefed.text.includes("build the one pull request of the plan's rollout"));
        assert.ok(briefed.text.includes("Build nothing the brief lists as out of scope"));
        assert.ok(briefed.text.includes("`edit_plan`"));
        assert.ok(tasked.text.includes("carry out the task the developer gave"));
        assert.ok(planned.text.includes("implement the plan given as the first message"));
        assert.ok(!planned.text.includes("pull request of the plan's rollout"));
      }),
  );

  it.effect(
    "the rollout's keeper runs under the keeper's instructions, which cut no branch and publish nothing of its own, whatever its row holds, and an agent with no role handed no task runs under the plan's",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, admitted } = yield* openAgent(host);
        const keeper = { ...agent, task: null, position: null, role: ROLLOUT_ROLE.KEEPER };

        const kept = yield* composedPrompt(host, admitted, keeper);
        const tasked = yield* composedPrompt(host, admitted, { ...keeper, task: "Fix the typo." });
        const planned = yield* composedPrompt(host, admitted, { ...keeper, role: null });

        assert.ok(kept.text.includes("keep the stacks of the plan's rollout"));
        assert.ok(kept.text.includes("Cut no branch of your own"));
        assert.ok(!kept.text.includes("worth publishing"));
        assert.equal(tasked.text, kept.text);
        assert.ok(planned.text.includes("implement the plan given as the first message"));
        assert.notEqual(kept.hash, planned.hash);
      }),
  );

  it.effect(
    "a coding turn lands through the shared relay with no ask record: the plan as the developer's line, the answer with its reasoning, its shell call, and its words, and the turn row naming the agent's model and effort",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { agent, target, auth, sessionId, admitted } = yield* openAgent(host);
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        for (const event of codingTurn("turn_0", "turn.completed")) {
          // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
          yield* host.relay(event, admitted, session as never, state, { hash: prompt.hash });
        }

        const turn = yield* turnRow(hostTurnId(sessionId, "turn_0"));
        assert.ok(turn);
        assert.equal(turn.origin, TURN_ORIGIN.TYPED);
        assert.equal(turn.status, TURN_STATUS.SETTLED);
        assert.equal(turn.model, agent.model);
        assert.equal(turn.reasoningEffort, agent.effort);
        assert.equal(turn.promptHash, prompt.hash);

        const page = yield* transcriptPast(target, CODER_TOOL_SET, CURSOR_START, agent).pipe(
          Effect.provide(modelCatalogOf(CATALOG)),
        );
        assert.deepEqual(
          page.messages.map((message) => message.role),
          [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT],
        );
        const [words, answer] = page.messages;
        assert.ok(words && answer);
        assert.equal(words.role, MESSAGE_ROLE.USER);
        if (words.role !== MESSAGE_ROLE.USER) return;
        assert.deepEqual(words.metadata, {
          author: MESSAGE_AUTHOR.DEVELOPER,
          channel: MESSAGE_CHANNEL.TYPED,
        });
        assert.ok(words.parts.some((part) => isTextUIPart(part) && part.text === PLAN_TEXT));
        assert.deepEqual(
          answer.parts.map((part) => part.type),
          [STEP_START, "reasoning", `tool-${CODER_TOOL.BASH}`, STEP_START, "text"],
        );
        const reasoning = answer.parts.find((part) => isReasoningUIPart(part));
        assert.equal(reasoning?.text, "Read the guide first.");
        const call = answer.parts.find((part) => isToolUIPart(part));
        assert.ok(call);
        assert.equal(call.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
        assert.deepEqual(call.input, { command: "cat AGENTS.md" });
        assert.deepEqual(state.get(), { turns: {} });

        const turns = yield* latestTurnsOf(target.userId, [target.conversationId]);
        assert.equal(
          codingAgentStatusOf(turns.get(target.conversationId), {
            createdAt: agent.createdAt,
            now: yield* Clock.currentTimeMillis,
          }),
          CODING_AGENT_STATUS.COMPLETED,
        );
      }),
  );
  it.effect(
    "an agent's notes are taken into its plan as the notetaker's are, the ones the plan cannot take reported, and read back in the plan",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, admitted } = yield* openAgent(host);
        const input = unparsedWire({
          notes: [
            {
              kind: "add",
              section: "Open questions",
              text: "- Who may withdraw an invite? Going on as: the member who sent it.",
            },
            { kind: "add", section: "Approach", text: "- Invites expire after 7 days." },
            { kind: "replace", find: "a phrase the plan never held", text: "an owner" },
          ],
        });

        const answer = yield* host.editPlan(admitted, input, 0);

        assert.deepEqual(answer, {
          status: ACTION_RESULT_STATUS.ACCEPTED,
          taken: 2,
          missed: ["replace a phrase the plan never held"],
        });
        const stored = Option.getOrThrow(yield* readPlan(userId, agent.planId));
        const sectionText = (heading: string) =>
          planSections(stored.text).find((section) => section.heading === heading)?.text ?? "";
        assert.ok(
          sectionText("Open questions").endsWith(
            "\n\n- Who may withdraw an invite? Going on as: the member who sent it.",
          ),
        );
        assert.ok(sectionText("Approach").endsWith("\n\n- Invites expire after 7 days."));
        assert.equal(stored.plan.document.body, stored.text);
        // The save is journaled as the agent's, with the notes that were taken and the agent named by its row.
        const at = yield* Clock.currentTimeMillis;
        assert.deepEqual(stored.plan.agentEdits, [{ agentId: agent.id, label: agent.model, at }]);
        assert.deepEqual(
          stored.agentEdits.map((edit) => edit.notes.map((note) => note.kind)),
          [["add", "add"]],
        );
      }),
  );
  it.effect(
    "an agent reads its plan whole as it stands now, notes taken since it started among it, and one handed a task is refused",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore();
        const { userId, agent, admitted } = yield* openAgent(host);
        // A note taken on the plan after the agent was handed it, as another agent on it would take one.
        const noted = yield* host.editPlan(
          admitted,
          unparsedWire({
            notes: [{ kind: "add", section: "Approach", text: "- Invites expire after 7 days." }],
          }),
          0,
        );
        assert.equal(noted.status, ACTION_RESULT_STATUS.ACCEPTED);

        const answer = yield* host.readPlan(admitted);

        assert.ok(answer.status === ACTION_RESULT_STATUS.ACCEPTED);
        assert.ok(answer.plan.startsWith("# Teammate invitations\n"));
        assert.ok(answer.plan.includes("- Invites expire after 7 days."));
        // What is read is the plan the store holds, not the snapshot the agent was handed.
        assert.ok(!answer.plan.includes(PLAN_TEXT));
        // The read changes nothing: the plan stands as it was saved.
        const stored = Option.getOrThrow(yield* readPlan(userId, agent.planId));
        assert.ok(stored.text.includes("- Invites expire after 7 days."));

        // An agent handed a task never saw the plan, so it is refused by name.
        const onTask = yield* openAgent(host, "anthropic/claude-opus-5.5", "high", {
          planSnapshot: null,
          task: "Rename the invite button.",
        });
        assert.deepEqual(yield* host.readPlan(onTask.admitted), {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: PLAN_READ_REFUSAL.NO_PLAN,
        });
      }),
  );

  it.effect(
    "each milestone and ask a worker reports lands on the plan's conversation as a report turn, named by the position its row holds, keyed by the call, and a question or a block tells it to end its turn",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const host = yield* hostOverStore(undefined, eve);
        const { userId, agent, admitted } = yield* openAgent(
          host,
          undefined,
          undefined,
          undefined,
          {
            position: 2,
            baseBranch: "luke/invites/1-table",
            role: ROLLOUT_ROLE.BUILDER,
          },
        );
        const calls = [
          ["call_opened", { kind: "pr_opened", pullRequest: 415, text: "The route is in." }],
          ["call_green", { kind: "ci_green", pullRequest: 415, text: "Every check passes." }],
          [
            "call_question",
            {
              kind: "question",
              text: "Should an expired invite be resent or refused?",
              options: ["Resend", "Refuse"],
            },
          ],
          [
            "call_blocked",
            { kind: "blocked", text: "The mail provider's sandbox key is missing." },
          ],
        ] as const;

        const answers = [];
        for (const [callId, input] of calls) {
          answers.push(
            yield* host.report(admitted, {
              callId,
              turnId: REPORTING_TURN,
              input: unparsedWire(input),
              sandbox: undefined,
            }),
          );
        }

        const carryOn = "Carry on.";
        const wait =
          "End your turn now, saying in one line that you are waiting on Luke. His answer arrives as your next message.";
        assert.deepEqual(answers, [
          {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            reported: "[worker 2] opened #415",
            next: carryOn,
          },
          {
            status: ACTION_RESULT_STATUS.ACCEPTED,
            reported: "[worker 2] checks green on #415",
            next: carryOn,
          },
          { status: ACTION_RESULT_STATUS.ACCEPTED, reported: "[worker 2] asks", next: wait },
          { status: ACTION_RESULT_STATUS.ACCEPTED, reported: "[worker 2] blocked", next: wait },
        ]);
        // The first report opens the plan's conversation and a session in it as the deployment
        // acting for the account; every later one follows that session up.
        const plan = Option.getOrThrow(yield* readPlan(userId, agent.planId));
        const conversationId = plan.conversationId;
        assert.ok(conversationId !== undefined);
        const handed = [...eve.opened, ...eve.sent].map((each) => [
          each.authorization,
          each.message.conversationId,
          each.message.turn,
        ]);
        assert.deepEqual(
          handed,
          calls.map(() => [userId, conversationId, BRAIN_HOST_TURN.REPORT]),
        );
        assert.deepEqual(
          [...eve.opened, ...eve.sent].map((each) => each.message.message),
          [
            "[worker 2] opened #415\n\nThe route is in.",
            "[worker 2] checks green on #415\n\nEvery check passes.",
            "[worker 2] asks\n\nShould an expired invite be resent or refused?\n\n- Resend\n- Refuse",
            "[worker 2] blocked\n\nThe mail provider's sandbox key is missing.",
          ],
        );
        const recorded = yield* Database.use((db) =>
          db
            .select({ clientId: asks.clientId, origin: asks.origin })
            .from(asks)
            .where(eq(asks.conversationId, conversationId)),
        );
        assert.deepEqual(
          recorded.map((row) => [row.clientId, row.origin]).sort(),
          calls.map(([callId]) => [callId, TURN_ORIGIN.REPORT]).sort(),
        );
      }),
  );

  it.effect(
    "the rollout's stack keeper, at no position, reports its restacks, conflicts, merges, and asks, which land on the plan's conversation as the keeper's",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const host = yield* hostOverStore(undefined, eve);
        const { admitted } = yield* openAgent(host, undefined, undefined, undefined, {
          role: ROLLOUT_ROLE.KEEPER,
        });
        const calls = [
          ["call_restacked", { kind: "restacked", text: "Moved #416 and #417 onto main." }],
          [
            "call_conflict",
            { kind: "conflict", pullRequest: 417, text: "Both rename the column." },
          ],
          ["call_merged", { kind: "merged", pullRequest: 415, text: "Squashed into main." }],
          ["call_asked", { kind: "question", text: "Merge #416 now or wait for #417?" }],
        ] as const;

        const answers = [];
        for (const [callId, input] of calls) {
          answers.push(
            yield* host.report(admitted, {
              callId,
              turnId: REPORTING_TURN,
              input: unparsedWire(input),
              sandbox: undefined,
            }),
          );
        }

        assert.deepEqual(
          answers.map((answer) =>
            answer.status === ACTION_RESULT_STATUS.ACCEPTED ? answer.reported : answer.reason,
          ),
          [
            "[keeper] restacked",
            "[keeper] conflict on #417",
            "[keeper] merged #415",
            "[keeper] asks",
          ],
        );
        assert.deepEqual(
          [...eve.opened, ...eve.sent].map((each) => [each.message.turn, each.message.message]),
          [
            [BRAIN_HOST_TURN.REPORT, "[keeper] restacked\n\nMoved #416 and #417 onto main."],
            [BRAIN_HOST_TURN.REPORT, "[keeper] conflict on #417\n\nBoth rename the column."],
            [BRAIN_HOST_TURN.REPORT, "[keeper] merged #415\n\nSquashed into main."],
            [BRAIN_HOST_TURN.REPORT, "[keeper] asks\n\nMerge #416 now or wait for #417?"],
          ],
        );
      }),
  );

  it.effect(
    "a call eve replays under the same id is the report already taken, and Luke is handed it once",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const host = yield* hostOverStore(undefined, eve);
        const { admitted } = yield* openAgent(host, undefined, undefined, undefined, {
          position: 1,
        });
        const call = {
          callId: "call_opened",
          turnId: REPORTING_TURN,
          input: unparsedWire({ kind: "pr_opened", pullRequest: 7, text: "Open." }),
          sandbox: undefined,
        };

        const first = yield* host.report(admitted, call);
        const again = yield* host.report(admitted, call);

        assert.deepEqual(again, first);
        assert.equal(eve.opened.length + eve.sent.length, 1);
      }),
  );

  it.effect(
    "a worker's question stands with the pull request it names and the answers it offered until its next turn starts, and no replay of a call, in the same millisecond or a later turn, or of a turn's start moves it",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore(undefined, fakeEve());
        const { userId, agent, auth, sessionId, admitted } = yield* openAgent(
          host,
          undefined,
          undefined,
          undefined,
          { position: 2 },
        );
        // What the agent's summary and the rollout's line read: the report, while it stands.
        const standing = Effect.gen(function* () {
          const row = Option.getOrThrow(yield* readCodingAgent(userId, agent.id));
          const newest = yield* latestTurnsOf(userId, [row.conversationId]);
          return standingReportOf(row.lastReport, newest.get(row.conversationId));
        });
        // Each call is made in the session's first turn, and eve replays it under that turn.
        const report = (callId: string, input: WireBoundaryInput) =>
          host.report(admitted, {
            callId,
            turnId: hostTurnId(sessionId, "turn_0"),
            input: unparsedWire(input),
            sandbox: undefined,
          });
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
        const relay = (events: readonly MessageStreamEvent[], turnId: string) =>
          Effect.forEach(events, (event) =>
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            host.relay(
              event,
              admitted,
              { id: sessionId, auth, turn: { id: turnId } } as never,
              state,
              { hash: prompt.hash },
            ),
          );
        const question = {
          kind: "question",
          pullRequest: 415,
          text: "Should an expired invite be resent or refused?",
          options: ["Resend", "Refuse"],
        };
        const green = { kind: "ci_green", pullRequest: 415, text: "Green." };

        // The question and then the green checks, all in one millisecond, inside a turn that starts before them.
        const first = codingTurn("turn_0", "turn.completed");
        yield* relay(first.slice(0, 1), "turn_0");
        const at = yield* Clock.currentTimeMillis;
        yield* report("call_question", question);
        assert.deepEqual(yield* standing, { ...question, at });
        yield* report("call_green", green);
        yield* report("call_unreadable", { kind: "question", text: "  " });
        const latest = { ...green, at };
        assert.deepEqual(yield* standing, latest);

        // eve replays the older call in the same millisecond: it is the report Luke already has.
        yield* report("call_question", question);
        assert.deepEqual(yield* standing, latest);

        // The rest of the turn, the end the host reports for it, and a replay of its start leave it.
        yield* relay(first.slice(1), "turn_0");
        const end = first.at(-1);
        assert.ok(end?.type === "turn.completed");
        yield* host.reportEnd(admitted, sessionId, end);
        yield* relay(first.slice(0, 1), "turn_0");
        assert.deepEqual(yield* standing, latest);

        // The next turn takes it away; neither a replay of the first turn's call nor one of its
        // calls Luke first hears only now brings a report of that turn back.
        yield* TestClock.adjust("1 second");
        yield* relay(codingTurn("turn_1", "turn.completed").slice(0, 1), "turn_1");
        assert.equal(yield* standing, null);
        yield* report("call_question", question);
        yield* report("call_late", question);
        assert.equal(yield* standing, null);
      }),
  );

  it.effect(
    "a pull request reported opened writes the branch checked out in the sandbox on the row, where the session opened one, and reads no branch where it opened none",
    () =>
      Effect.gen(function* () {
        const host = yield* hostOverStore(undefined, fakeEve());
        const { userId, agent, admitted } = yield* openAgent(
          host,
          undefined,
          undefined,
          undefined,
          { position: 1 },
        );
        const sandbox = sandboxDouble((command) =>
          command === "git branch --show-current"
            ? { exitCode: 0, stdout: "luke/invites/1-table\n", stderr: "" }
            : undefined,
        );
        sandbox.checkedOut = agent.repository;
        const branchOnRow = Effect.map(readCodingAgent(userId, agent.id), (row) =>
          Option.isSome(row) ? row.value.branch : assert.fail("the agent is gone"),
        );
        const opened = (callId: string, opensSandbox: boolean) =>
          host.report(admitted, {
            callId,
            turnId: REPORTING_TURN,
            input: unparsedWire({ kind: "pr_opened", pullRequest: 9, text: "Open." }),
            sandbox: opensSandbox ? () => Promise.resolve(sandbox) : undefined,
          });

        yield* opened("call_unopened", false);
        assert.equal(yield* branchOnRow, null);
        assert.equal(sandbox.runs.length, 0);

        const answer = yield* opened("call_opened", true);
        assert.equal(answer.status, ACTION_RESULT_STATUS.ACCEPTED);
        assert.equal(yield* branchOnRow, "luke/invites/1-table");
      }),
  );

  it.effect(
    "an agent started outside a rollout, a report that does not read or claims the host's own kind, a kind that is the other role's, and a deployment with no eve to reach are each refused, and Luke is handed nothing",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const host = yield* hostOverStore(undefined, eve);
        const plain = yield* openAgent(host);
        const worker = yield* openAgent(host, undefined, undefined, undefined, {
          position: 3,
          role: ROLLOUT_ROLE.BUILDER,
        });
        const asked = unparsedWire({ kind: "question", text: "Which table?" });
        const report = (admitted: AdmittedConversation, input: typeof asked) =>
          host.report(admitted, {
            callId: `call_${minted}`,
            turnId: REPORTING_TURN,
            input,
            sandbox: undefined,
          });

        assert.deepEqual(yield* report(plain.admitted, asked), {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: REPORT_REFUSAL.NO_ROLLOUT,
        });
        for (const unreadable of [
          { kind: "finished", text: "Done." },
          // No agent reports a rebase: a restack is the keeper's, and it reports it as one.
          { kind: "rebased", text: "Rebased onto main." },
          { kind: "question", text: "  " },
          { kind: "pr_opened", pullRequest: 0, text: "Open." },
        ]) {
          assert.deepEqual(yield* report(worker.admitted, unparsedWire(unreadable)), {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: REPORT_REFUSAL.UNREADABLE,
          });
        }
        // A builder never restacks or merges, and the keeper never opens or checks a pull request.
        for (const kind of ["merged", "restacked", "conflict"]) {
          const input = unparsedWire({ kind, pullRequest: 415, text: "Done by the builder." });
          assert.deepEqual(yield* report(worker.admitted, input), {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: REPORT_REFUSAL.NOT_A_BUILDERS,
          });
        }
        const keeper = yield* openAgent(host, undefined, undefined, undefined, {
          role: ROLLOUT_ROLE.KEEPER,
        });
        for (const kind of ["pr_opened", "ci_green"]) {
          const input = unparsedWire({ kind, pullRequest: 415, text: "Done by the keeper." });
          assert.deepEqual(yield* report(keeper.admitted, input), {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: REPORT_REFUSAL.NOT_THE_KEEPERS,
          });
        }
        // A report about one pull request names its number, so Luke knows which.
        for (const [admitted, kind] of [
          [worker.admitted, "pr_opened"],
          [worker.admitted, "ci_green"],
          [keeper.admitted, "merged"],
          [keeper.admitted, "conflict"],
        ] as const) {
          assert.deepEqual(yield* report(admitted, unparsedWire({ kind, text: "No number." })), {
            status: ACTION_RESULT_STATUS.REJECTED,
            reason: REPORT_REFUSAL.NO_NUMBER,
          });
        }
        assert.equal(eve.opened.length + eve.sent.length, 0);

        const unreachable = yield* hostOverStore();
        const elsewhere = yield* openAgent(unreachable, undefined, undefined, undefined, {
          position: 1,
        });
        const unanswered = yield* unreachable.report(elsewhere.admitted, {
          callId: "call_unreachable",
          turnId: REPORTING_TURN,
          input: asked,
          sandbox: undefined,
        });
        assert.deepEqual(unanswered, {
          status: ACTION_RESULT_STATUS.REJECTED,
          reason: REPORT_REFUSAL.UNAVAILABLE,
        });
      }),
  );

  it.effect(
    "a builder's or the keeper's turn that finishes, fails, or is stopped is reported to Luke once relayed, the builder by its position and the keeper by its role, the failure by its word and each keyed by the turn, and a plain agent's end reports nothing",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const host = yield* hostOverStore(undefined, eve);
        const builder = (position: number) => ({ position, role: ROLLOUT_ROLE.BUILDER });
        const keeper = { role: ROLLOUT_ROLE.KEEPER };
        const ends = [
          [builder(1), "turn.completed"],
          [builder(2), "turn.failed"],
          [builder(3), "turn.cancelled"],
          [keeper, "turn.completed"],
          [keeper, "turn.failed"],
          [keeper, "turn.cancelled"],
          [{}, "turn.completed"],
        ] as const;

        for (const [rollout, end] of ends) {
          const opened = yield* openAgent(host, undefined, undefined, undefined, rollout);
          const { agent, auth, sessionId, admitted } = opened;
          const state = memoryRelayState();
          const prompt = yield* composedPrompt(host, admitted, agent);
          const session = { id: sessionId, auth, turn: { id: "turn_0" } };
          const events = codingTurn("turn_0", end);
          for (const event of events) {
            // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
            yield* host.relay(event, admitted, session as never, state, { hash: prompt.hash });
          }
          const ended = events.at(-1);
          assert.ok(
            ended?.type === "turn.completed" ||
              ended?.type === "turn.failed" ||
              ended?.type === "turn.cancelled",
          );
          // An end eve hands the hook again is the report already taken.
          yield* host.reportEnd(admitted, sessionId, ended);
          yield* host.reportEnd(admitted, sessionId, ended);
        }

        assert.deepEqual(eve.sent, []);
        assert.deepEqual(
          eve.opened.map((each) => [each.message.turn, each.message.message]),
          [
            [
              BRAIN_HOST_TURN.REPORT,
              "[worker 1] finished\n\nIts turn ended. read_coding_agent shows what it did.",
            ],
            [BRAIN_HOST_TURN.REPORT, "[worker 2] failed\n\nIts turn failed: model."],
            [BRAIN_HOST_TURN.REPORT, "[worker 3] stopped\n\nIts turn was stopped before it ended."],
            [
              BRAIN_HOST_TURN.REPORT,
              "[keeper] finished\n\nIts turn ended. read_coding_agent shows what it did.",
            ],
            [BRAIN_HOST_TURN.REPORT, "[keeper] failed\n\nIts turn failed: model."],
            [BRAIN_HOST_TURN.REPORT, "[keeper] stopped\n\nIts turn was stopped before it ended."],
          ],
        );
      }),
  );

  it.effect(
    "a turn's end is reported as the store settled it: nothing while the relay has not settled it, a failure the store recorded under an end eve called completed, and the failure's word after a later turn has begun",
    () =>
      Effect.gen(function* () {
        const eve = fakeEve();
        const host = yield* hostOverStore(undefined, eve);
        const { agent, auth, sessionId, admitted } = yield* openAgent(
          host,
          undefined,
          undefined,
          undefined,
          { position: 1, role: ROLLOUT_ROLE.BUILDER },
        );
        const state = memoryRelayState();
        const prompt = yield* composedPrompt(host, admitted, agent);
        const session = { id: sessionId, auth, turn: { id: "turn_0" } };
        const relay = (event: MessageStreamEvent) =>
          // SAFETY: the relay reads the session's id and auth; eve's turn metadata is not read here.
          host.relay(event, admitted, session as never, state, { hash: prompt.hash });
        const events = codingTurn("turn_0", "turn.failed");
        const completed = stamped({
          type: "turn.completed",
          data: { turnId: "turn_0", sequence: 0 },
        });
        assert.ok(completed.type === "turn.completed");

        for (const event of events.slice(0, -1)) yield* relay(event);
        yield* host.reportEnd(admitted, sessionId, completed);
        assert.equal(eve.opened.length + eve.sent.length, 0);

        const failed = events.at(-1);
        assert.ok(failed !== undefined);
        yield* relay(failed);
        yield* relay(stamped({ type: "turn.started", data: { turnId: "turn_1", sequence: 1 } }));
        yield* host.reportEnd(admitted, sessionId, completed);

        assert.deepEqual(
          [...eve.opened, ...eve.sent].map((each) => each.message.message),
          ["[worker 1] failed\n\nIts turn failed: model."],
        );
      }),
  );
});
