import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { writeAccountPreferences } from "@luke/database/models/account-store";
import {
  deleteAutomation,
  listAutomationRuns,
  listAutomations,
} from "@luke/database/models/automation-store";
import {
  listWorkspaceCodingAgentLines,
  readCodingAgent,
} from "@luke/database/models/coding-agent-store";
import { getTestDB, joinWorkspace, openWorkspace } from "@luke/database/testing";
import {
  AUTOMATION_FIRING,
  AUTOMATION_SCOPE,
  AUTOMATION_TARGET,
  AUTOMATION_TRIGGER,
} from "@luke/features/automation-wire";
import { CODING_AGENT_KIND } from "@luke/features/coding-agent-wire";
import { agentTabLabel } from "@luke/features/model-label";
import { CODING_AGENT_DEFAULT_CHOICE, MODEL_PROVIDER } from "@luke/features/models-wire";
import { EXPERIMENT } from "@luke/settings";
import { Effect, Layer, Option, Result, Stream } from "effect";
import { TestClock } from "effect/testing";
import { sweepAutomations } from "../../automations/automation-sweep.js";
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
import { OPERATOR_HEARTBEAT } from "./instructions.js";
import { ensureOperator } from "./operator.js";
import { type StartAsk, startCodingAgent } from "./start.js";
import { codingAgentSummary } from "./status.js";

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
 * would not take the opening still leaves the operator standing. eve writes down
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
  timeZone: string | undefined = undefined,
) =>
  ensureOperator(eve, userId, workspaceId, { reset, stopStanding, timeZone }).pipe(
    Effect.provide(services),
  );

/** The member's automations in the workspace. */
const automationsOf = (userId: string, workspaceId: string) =>
  listAutomations(userId, { organizationId: workspaceId });

/** Friday 23 October 2026, eight in the morning in New York. */
const FRIDAY_MORNING_NY = Date.parse("2026-10-23T12:00:00Z");

const HOUR_MS = 3_600_000;

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
    "an ensured operator, and a Reset's fresh one, is given no human name and goes by Luke in its summary",
    () =>
      Effect.gen(function* () {
        const member = yield* openMember;
        const workspaceId = yield* openWorkspace(member);
        const named = (agentId: string) =>
          Effect.map(readCodingAgent(member, agentId), (read) => {
            const agent = Option.getOrThrow(read);
            const summary = codingAgentSummary(
              agent,
              { turn: undefined, awaitingLineAt: undefined },
              0,
              new Map(),
            );
            return [agent.personaName, summary.personaName, agentTabLabel(summary)];
          });

        const ensured = yield* ensure(member, workspaceId);
        const reset = yield* ensure(member, workspaceId, true);

        assert.deepEqual(yield* named(ensured.agent.id), [null, undefined, "Luke"]);
        assert.deepEqual(yield* named(reset.agent.id), [null, undefined, "Luke"]);
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
    "an eve that will not take the opening still leaves an operator standing, a Reset's fresh one among them, so a member is never left with none",
    () =>
      Effect.gen(function* () {
        const member = yield* openMember;
        const workspaceId = yield* openWorkspace(member);
        const refusing = recordingEve(true);

        const made = yield* ensure(member, workspaceId, false, nothingToStop, refusing.eve);
        assert.equal(made.created, true);
        assert.equal(refusing.openedOver(made.agent.conversationId).length, 1);
        const reset = yield* ensure(member, workspaceId, true, nothingToStop, refusing.eve);

        const standing = (yield* operatorsOf(member, workspaceId)).filter(
          (operator) => operator.archivedAt === null,
        );
        assert.deepEqual(
          standing.map((operator) => operator.id),
          [reset.agent.id],
        );
        assert.equal(reset.retired?.id, made.agent.id);
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

  it.effect(
    "the ensure that makes the operator makes its one heartbeat, a personal automation of the member's with no repository aimed at it on weekdays at nine and five in their zone, and repeat or racing ensures make no second",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(FRIDAY_MORNING_NY);
        const member = yield* openMember;
        const workspaceId = yield* openWorkspace(member);

        const [first, second] = yield* Effect.all(
          [
            ensure(member, workspaceId, false, nothingToStop, EVE.eve, "America/New_York"),
            ensure(member, workspaceId, false, nothingToStop, EVE.eve, "America/New_York"),
          ],
          { concurrency: "unbounded" },
        );
        yield* ensure(member, workspaceId, false, nothingToStop, EVE.eve, "Europe/Paris");

        assert.equal(first.agent.id, second.agent.id);
        const automations = yield* automationsOf(member, workspaceId);
        assert.equal(automations.length, 1, "one heartbeat, whichever ensure made the operator");
        const [heartbeat] = automations;
        assert.ok(heartbeat);
        assert.deepEqual(
          {
            userId: heartbeat.userId,
            taskId: heartbeat.taskId,
            organizationId: heartbeat.organizationId,
            repositories: heartbeat.repositories,
            scope: heartbeat.scope,
            target: [heartbeat.targetKind, heartbeat.targetAgentId],
            trigger: heartbeat.trigger,
            prompt: heartbeat.action.prompt,
            enabled: heartbeat.enabled,
            nextRunAt: heartbeat.nextRunAt?.toISOString(),
          },
          {
            userId: member,
            taskId: null,
            organizationId: workspaceId,
            repositories: [],
            scope: AUTOMATION_SCOPE.PERSONAL,
            target: [AUTOMATION_TARGET.SAME_AGENT, first.agent.id],
            trigger: {
              kind: AUTOMATION_TRIGGER.SCHEDULE,
              cron: "0 9,17 * * 1-5",
              timezone: "America/New_York",
            },
            prompt: OPERATOR_HEARTBEAT,
            enabled: true,
            nextRunAt: "2026-10-23T13:00:00.000Z",
          },
        );
      }),
  );

  it.effect(
    "a Reset re-aims the heartbeat at the fresh operator rather than making a second, and one the member deleted is not made again by a repeat ensure",
    () =>
      Effect.gen(function* () {
        const member = yield* openMember;
        const workspaceId = yield* openWorkspace(member);
        const before = yield* ensure(member, workspaceId);
        const [made] = yield* automationsOf(member, workspaceId);
        assert.ok(made);

        const reset = yield* ensure(member, workspaceId, true);
        const reaimed = yield* automationsOf(member, workspaceId);

        assert.notEqual(reset.agent.id, before.agent.id);
        assert.deepEqual(
          reaimed.map((each) => [each.id, each.targetAgentId]),
          [[made.id, reset.agent.id]],
        );

        assert.ok(yield* deleteAutomation(member, made.id));
        yield* ensure(member, workspaceId);
        assert.deepEqual(
          yield* automationsOf(member, workspaceId),
          [],
          "a deleted heartbeat stays deleted",
        );
      }),
  );

  it.effect(
    "the heartbeat is read in UTC where the client named no zone, or one that does not read",
    () =>
      Effect.gen(function* () {
        const member = yield* openMember;
        const unnamed = yield* openWorkspace(member);
        const unread = yield* openWorkspace(member);

        yield* ensure(member, unnamed);
        yield* ensure(member, unread, false, nothingToStop, EVE.eve, "Mars/Olympus_Mons");

        for (const workspaceId of [unnamed, unread]) {
          const [heartbeat] = yield* automationsOf(member, workspaceId);
          assert.equal(
            heartbeat?.trigger.kind === AUTOMATION_TRIGGER.SCHEDULE && heartbeat.trigger.timezone,
            "UTC",
          );
        }
      }),
  );

  it.effect(
    "the heartbeat fires on weekdays at nine and five in the member's zone, and not on the weekend",
    () =>
      Effect.gen(function* () {
        yield* TestClock.setTime(FRIDAY_MORNING_NY);
        const member = yield* openMember;
        const workspaceId = yield* openWorkspace(member);
        yield* ensure(member, workspaceId, false, nothingToStop, EVE.eve, "America/New_York");
        const [heartbeat] = yield* automationsOf(member, workspaceId);
        assert.ok(heartbeat);

        // The minute sweep, read once an hour on the hour for a week.
        for (let hour = 1; hour <= 7 * 24; hour += 1) {
          yield* sweepAutomations(() => EVE.eve, FRIDAY_MORNING_NY + hour * HOUR_MS).pipe(
            Effect.provide(services),
          );
        }

        const runs = yield* listAutomationRuns(member, heartbeat.id, 100);
        assert.deepEqual(
          runs
            .map((run) =>
              run.firing.kind === AUTOMATION_FIRING.SCHEDULE
                ? new Date(run.firing.dueAt).toISOString()
                : run.firing.kind,
            )
            .toSorted(),
          [
            "2026-10-23T13:00:00.000Z",
            "2026-10-23T21:00:00.000Z",
            "2026-10-26T13:00:00.000Z",
            "2026-10-26T21:00:00.000Z",
            "2026-10-27T13:00:00.000Z",
            "2026-10-27T21:00:00.000Z",
            "2026-10-28T13:00:00.000Z",
            "2026-10-28T21:00:00.000Z",
            "2026-10-29T13:00:00.000Z",
            "2026-10-29T21:00:00.000Z",
          ],
          "Friday, then Monday to Thursday, at nine and five New York time, and nothing on Saturday or Sunday",
        );
      }),
  );
});
