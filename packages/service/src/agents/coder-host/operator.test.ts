import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import {
  listWorkspaceCodingAgentLines,
  readCodingAgent,
} from "@luke/database/models/coding-agent-store";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { EXPERIMENT } from "@luke/settings";
import { Effect, Layer, Option, Result, Stream } from "effect";
import { HOSTED_REFUSAL, type HostedRefusal } from "../../http/http-effect.js";
import { modelCatalogOf } from "../../providers/model-catalog.js";
import { githubReaching, openGithubUser } from "../../testing/github-app-fake.js";
import { BRAIN_HOST_TURN } from "../brain-host/bounds.js";
import {
  type AgentSessions,
  EVE_CANCEL_OUTCOME,
  EVE_RESET_OUTCOME,
  EVE_SEND_OUTCOME,
  type EveMessage,
  type EveTypedTurn,
} from "../brain-host/eve-sessions.js";
import { ensureOperator } from "./operator.js";
import { type StartAsk, startCodingAgent } from "./start.js";

/**
 * operator.test.ts -- the member's operator ensured in a workspace, and reset.
 *
 * Two ensures that race make one operator; each member of a workspace has
 * their own, and a member has one in each of their workspaces; a Reset
 * leaves the old one archived beside a fresh one standing, and one that
 * could not stop the old one's turn or whose fresh one the catalog would
 * refuse leaves the old one standing; an account
 * outside the workspace, or one with the experiment off, ensures none. No
 * ensure opens a session. A blank Start with no task that is no operator's
 * is still refused, as is an operator's that is not blank or names a
 * repository or a task. An ensure that made an operator opens its session
 * once, on its opening turn, and one that found it opens none; an eve that
 * would not take the opening leaves no operator behind. eve writes down
 * every session opened, the catalog is fixed, and the store PGlite.
 * Synthetic accounts throughout.
 */

/** eve as a refused Start must never reach it. */
const unreachedEve = Effect.die(new Error("a refused Start reached eve"));

/** eve's coding-agent service, writing down the first message of every session opened, and taking it unless `refusing` says not. */
function recordingEve(refusing = false) {
  const opened: EveMessage<EveTypedTurn>[] = [];
  const sessions: AgentSessions<EveTypedTurn> = {
    open: (message) =>
      Effect.sync(() => {
        opened.push(message);
        return refusing
          ? { outcome: EVE_SEND_OUTCOME.FAILED, status: 503 }
          : { outcome: EVE_SEND_OUTCOME.ACCEPTED, sessionId: `wrun_${randomUUID()}` };
      }),
    send: () => Effect.succeed({ outcome: EVE_SEND_OUTCOME.FAILED, status: 500 }),
    cancel: () => Effect.succeed({ outcome: EVE_CANCEL_OUTCOME.ACCEPTED }),
    reset: () => Effect.succeed({ outcome: EVE_RESET_OUTCOME.RESET }),
    stream: () => Stream.empty,
  };
  /** The sessions opened over the conversation named. */
  const openedOver = (conversationId: string) =>
    opened.filter((message) => message.conversationId === conversationId);
  return { eve: Effect.succeed(sessions), openedOver };
}

/** The eve every ensure here reaches but the one that says otherwise. */
const EVE = recordingEve();

/** What a Start reaches beside the store: GitHub, which an operator never asks, and the catalog. */
const services = Layer.mergeAll(
  githubReaching([]).layer,
  modelCatalogOf([
    {
      id: CODING_AGENT_DEFAULT_CHOICE.model,
      name: "Claude Opus 5.5",
      provider: MODEL_PROVIDER.ANTHROPIC,
      efforts: ["low", "medium", "high", "max"],
    },
  ]),
);

/** An account with the operator experiment on. */
const openMember = Effect.gen(function* () {
  const userId = yield* openGithubUser();
  yield* writeAccountPreferences(userId, { experiments: { [EXPERIMENT.OPERATOR]: true } });
  return userId;
});

/** A standing operator's turn stopped before a Reset archives it: none runs in these tests, so nothing to stop. */
const nothingToStop = () => Effect.void;

/** The member's operator in the workspace, ensured, or reset and ensured, its stop refused where `stop` says. */
const ensure = (
  userId: string,
  workspaceId: string,
  reset = false,
  stopStanding: () => Effect.Effect<void, HostedRefusal> = nothingToStop,
  eve = EVE.eve,
) =>
  ensureOperator(eve, userId, workspaceId, { reset, stopStanding }).pipe(Effect.provide(services));

/** The member's operators in the workspace, archived ones included, newest first. */
const operatorsOf = (userId: string, workspaceId: string) =>
  Effect.map(
    listWorkspaceCodingAgentLines(userId, workspaceId, { includeArchived: true, limit: 50 }),
    (lines) =>
      lines.filter((line) => line.kind === CODING_AGENT_KIND.OPERATOR && line.userId === userId),
  );

it.layer(getTestDB())("the member's operator", (it) => {
  it.effect(
    "two ensures that race make one operator, blank with no task and no repository, on the member's default choice",
    () =>
      Effect.gen(function* () {
        const member = yield* openMember;
        const workspaceId = yield* openWorkspace(member);

        const [first, second] = yield* Effect.all(
          [ensure(member, workspaceId), ensure(member, workspaceId)],
          { concurrency: "unbounded" },
        );

        assert.equal(first.agent.id, second.agent.id);
        assert.deepEqual(
          [first.created, second.created].sort(),
          [false, true],
          "one ensure made it and the other found it",
        );
        const operators = yield* operatorsOf(member, workspaceId);
        assert.deepEqual(
          operators.map((operator) => operator.id),
          [first.agent.id],
        );
        const agent = Option.getOrThrow(yield* readCodingAgent(member, first.agent.id));
        assert.deepEqual(
          [agent.taskId, agent.repository, agent.prompt, agent.planSnapshot, agent.archivedAt],
          [null, null, null, null, null],
        );
        assert.deepEqual(
          [agent.model, agent.effort],
          [CODING_AGENT_DEFAULT_CHOICE.model, CODING_AGENT_DEFAULT_CHOICE.effort],
        );
      }),
  );

  it.effect(
    "each member of a workspace has their own operator, and a member has one in each of their workspaces",
    () =>
      Effect.gen(function* () {
        const owner = yield* openMember;
        const teammate = yield* openMember;
        const workspaceId = yield* openWorkspace(owner);
        yield* joinWorkspace(workspaceId, teammate);
        const elsewhere = yield* openWorkspace(owner);

        const owners = yield* ensure(owner, workspaceId);
        const teammates = yield* ensure(teammate, workspaceId);
        const ownersElsewhere = yield* ensure(owner, elsewhere);

        assert.equal(new Set([owners, teammates, ownersElsewhere].map((s) => s.agent.id)).size, 3);
        assert.deepEqual(
          [owners.agent.userId, teammates.agent.userId, ownersElsewhere.agent.userId],
          [owner, teammate, owner],
        );
        assert.deepEqual(
          [owners.agent.organizationId, ownersElsewhere.agent.organizationId],
          [workspaceId, elsewhere],
        );
        assert.equal((yield* ensure(teammate, workspaceId)).agent.id, teammates.agent.id);
      }),
  );

  it.effect(
    "a Reset leaves the old operator archived, its conversation kept, beside a fresh one standing, which the next ensure answers",
    () =>
      Effect.gen(function* () {
        const member = yield* openMember;
        const workspaceId = yield* openWorkspace(member);
        const before = yield* ensure(member, workspaceId);

        const reset = yield* ensure(member, workspaceId, true);
        const after = yield* ensure(member, workspaceId);

        assert.equal(reset.retired?.id, before.agent.id);
        assert.notEqual(reset.agent.id, before.agent.id);
        assert.equal(reset.created, true);
        assert.equal(after.agent.id, reset.agent.id);
        const operators = yield* operatorsOf(member, workspaceId);
        const standing = operators.filter((operator) => operator.archivedAt === null);
        const archivedOnes = operators.filter((operator) => operator.archivedAt !== null);
        assert.deepEqual(
          [standing.map((operator) => operator.id), archivedOnes.map((operator) => operator.id)],
          [[reset.agent.id], [before.agent.id]],
        );
        const archived = Option.getOrThrow(yield* readCodingAgent(member, before.agent.id));
        assert.equal(archived.conversationId, before.agent.conversationId);
      }),
  );

  it.effect(
    "a Reset whose fresh operator the catalog would refuse, or whose standing operator's turn cannot be stopped, keeps the standing one",
    () =>
      Effect.gen(function* () {
        const member = yield* openMember;
        const workspaceId = yield* openWorkspace(member);
        const standing = yield* ensure(member, workspaceId);

        const unstoppable = yield* Effect.result(
          ensure(member, workspaceId, true, () => Effect.fail(HOSTED_REFUSAL.AGENT_NOT_READY)),
        );
        yield* writeAccountPreferences(member, {
          codingAgent: { model: "retired/model", effort: "high" },
        });
        const refusedChoice = yield* Effect.result(ensure(member, workspaceId, true));

        assert.deepEqual(unstoppable, Result.fail(HOSTED_REFUSAL.AGENT_NOT_READY));
        assert.deepEqual(refusedChoice, Result.fail(HOSTED_REFUSAL.INVALID_REQUEST));
        assert.deepEqual(
          (yield* operatorsOf(member, workspaceId)).map((operator) => [
            operator.id,
            operator.archivedAt,
          ]),
          [[standing.agent.id, null]],
        );
      }),
  );

  it.effect(
    "an account outside the workspace ensures no operator there and resets none, and one with the experiment off ensures none",
    () =>
      Effect.gen(function* () {
        const member = yield* openMember;
        const outsider = yield* openMember;
        const workspaceId = yield* openWorkspace(member);
        yield* openWorkspace(outsider);
        const standing = yield* ensure(member, workspaceId);
        const unenrolled = yield* openGithubUser();
        yield* joinWorkspace(workspaceId, unenrolled);

        const outside = yield* Effect.result(ensure(outsider, workspaceId, true));
        const off = yield* Effect.result(ensure(unenrolled, workspaceId));

        assert.deepEqual(outside, Result.fail(HOSTED_REFUSAL.NOT_FOUND));
        assert.deepEqual(off, Result.fail(HOSTED_REFUSAL.NOT_FOUND));
        assert.deepEqual(
          (yield* operatorsOf(member, workspaceId)).map((operator) => operator.archivedAt),
          [null],
          "the outsider's Reset archived nothing",
        );
        assert.equal((yield* ensure(member, workspaceId)).agent.id, standing.agent.id);
      }),
  );

  it.effect(
    "an ensure that made the operator opens its session once, on a typed opening turn, a repeat ensure opens none, and a Reset's fresh operator opens its own",
    () =>
      Effect.gen(function* () {
        const member = yield* openMember;
        const workspaceId = yield* openWorkspace(member);

        const first = yield* ensure(member, workspaceId);
        const again = yield* ensure(member, workspaceId);
        const reset = yield* ensure(member, workspaceId, true);

        assert.equal(again.agent.id, first.agent.id);
        const firstOpenings = EVE.openedOver(first.agent.conversationId);
        assert.equal(firstOpenings.length, 1, "one opening, and none for the repeat ensure");
        assert.equal(firstOpenings[0]?.turn, BRAIN_HOST_TURN.TYPED);
        assert.equal(EVE.openedOver(reset.agent.conversationId).length, 1);
        assert.equal(EVE.openedOver(first.agent.conversationId).length, 1);
      }),
  );

  it.effect(
    "an eve that will not take the opening leaves no operator, so the next ensure makes one and opens it",
    () =>
      Effect.gen(function* () {
        const member = yield* openMember;
        const workspaceId = yield* openWorkspace(member);
        const refusing = recordingEve(true);

        const refused = yield* Effect.result(
          ensure(member, workspaceId, false, nothingToStop, refusing.eve),
        );
        assert.ok(Result.isFailure(refused));
        assert.deepEqual(yield* operatorsOf(member, workspaceId), []);

        const made = yield* ensure(member, workspaceId);
        assert.equal(made.created, true);
        assert.equal(EVE.openedOver(made.agent.conversationId).length, 1);
      }),
  );

  it.effect(
    "a blank Start with no task and no repository that is no operator's is refused, as is an operator's that names a repository, a prompt, or a task",
    () =>
      Effect.gen(function* () {
        const member = yield* openMember;
        const workspaceId = yield* openWorkspace(member);
        const blank: StartAsk = {
          taskId: null,
          organizationId: workspaceId,
          repository: null,
          blank: true,
          prompt: undefined,
          idempotencyKey: randomUUID(),
          choice: undefined,
        };
        const start = (ask: StartAsk) =>
          Effect.result(startCodingAgent(unreachedEve, member, ask).pipe(Effect.provide(services)));
        const operator = { ...blank, kind: CODING_AGENT_KIND.OPERATOR };

        const refused = [
          yield* start(blank),
          yield* start({ ...blank, kind: CODING_AGENT_KIND.CODER }),
          yield* start({ ...blank, blank: false, prompt: "Watch my agents." }),
          yield* start({ ...operator, repository: "acme/relay" }),
          yield* start({ ...operator, prompt: "Watch my agents." }),
          yield* start({ ...operator, blank: false }),
          yield* start({ ...operator, taskId: randomUUID() }),
        ];

        for (const each of refused) {
          assert.ok(Result.isFailure(each));
          assert.equal(each.failure, HOSTED_REFUSAL.INVALID_REQUEST);
        }
        assert.deepEqual(yield* operatorsOf(member, workspaceId), []);
      }),
  );
});
