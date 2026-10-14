import assert from "node:assert/strict";
import { Database, type DatabaseServices } from "@sidecar/database/core/query";
import { sqlClientOverUrl } from "@sidecar/database/core/sql-client";
import {
  createCodingAgent,
  recordCodingAgentPublished,
  updateCodingAgentBranch,
} from "@sidecar/database/models/coding-agent-store";
import { toolSetHashOf } from "@sidecar/database/models/content-addressed";
import { hostTurnId } from "@sidecar/database/models/ids";
import { openPlanConversation, readPlan, savePlanText } from "@sidecar/database/models/plan-store";
import { user } from "@sidecar/database/schemas/auth";
import { conversations } from "@sidecar/database/schemas/storage";
import {
  CHECK_SUMMARY,
  type CodingAgentPullRequest,
  PULL_REQUEST_STATE,
  type PullRequestState,
  ROLLOUT_ROLE,
  type RolloutRole,
} from "@sidecar/hosted/coding-agent-wire";
import { ROLLOUT_BASE, type RolloutItem } from "@sidecar/hosted/plan-wire";
import { REPORT_KIND, type Report, reportText } from "@sidecar/hosted/rollout-wire";
import { EXCESS_KEYS } from "@sidecar/wire";
import { readEither } from "@sidecar/wire/effect";
import { isTextUIPart, isToolUIPart } from "ai";
import { eq } from "drizzle-orm";
import { Effect, ManagedRuntime, Option, Result, Schema } from "effect";
import { defineEval } from "eve/evals";
import {
  MESSAGE_AUTHOR,
  MESSAGE_CHANNEL,
  MESSAGE_ROLE,
  TOOL_PART_STATE,
  TURN_ORIGIN,
  TURN_STATUS,
  unparsedWire,
} from "../../server/core";
import {
  BRAIN_HOST_HEADER,
  BRAIN_HOST_TURN,
  type BrainHostTurn,
} from "../../server/hosted/brain-host/bounds";
import {
  PLANNER_DELEGATE_TOOL,
  planningToolDeclarations,
} from "../../server/hosted/brain-host/planning";
import {
  LIST_CODING_AGENTS_TOOL,
  MESSAGE_CODING_AGENT_TOOL,
  START_CODING_AGENT_TOOL,
} from "../../server/hosted/coding-agent-tools";
import { REPOSITORY_SHELL_REFUSAL } from "../../server/hosted/repository-shell";
import { cutRollout } from "../../tests/support/plan-rollouts";
import { readMessagesByConversationTyped, readTurnById } from "../../tests/support/store-rows";
import { startPlan } from "../../tests/support/workspaces";
import {
  SCRIPTED_DELEGATE,
  SCRIPTED_NOT_READ_REPLY,
  SCRIPTED_PLANNING_REPLY,
  SCRIPTED_READ,
  SCRIPTED_RESTACK,
  SCRIPTED_STACK,
} from "../scripted-model";

/**
 * The whole host under eve, end to end: eve's runtime runs a typed ask in a
 * plan's conversation under the scripted fixture model, which is handed the
 * saved document in its standing context and answers in words, leaving the
 * document as the notetaker saved it, and the relay writes the turn into the
 * store through the writer. A read of the repository on a plan that has none
 * is refused ahead of any sandbox, in words the model repeats, so the eval
 * opens no Vercel Sandbox and needs no GitHub. The eve server runs in this process with the database the
 * environment names, so the eval reads the rows back from the same Postgres.
 * Where no database is named the eval skips rather than pretending: the
 * relay and the writer meet PGlite in the store tests, and this is where
 * they meet eve. A rollout's report, a builder's, the stack keeper's, or
 * GitHub's, opens a report turn on its plan's conversation, and the
 * scripted model, which runs the rollout from the [rollout] lines its
 * standing context carries and the agents it lists, has the keeper stack
 * an opened pull request and starts what it made ready, answers a
 * question, or hands a merge to the keeper and to no builder; the eval
 * holds the calls it made, which reach a plan with no repository and no
 * coding-agent service and so change nothing.
 */

const SHA256_HEX_LENGTH = 64;

/** The eve development principal, which is the account the fixture's rows belong to. */
const LOCAL_DEV_PRINCIPAL = "local-dev";

const DATABASE_ENVIRONMENT = { URL: "DATABASE_URL" } as const;

/** The plan the planning scenario runs against, and the words its two sessions open with. */
const PLAN = {
  name: "Teammate invitations",
} as const;
const PLAN_TEXT =
  "## Open questions\n\n- Who may invite?\n\n## Assumptions\n\n- Invites reuse `memberships` with a `pending` state.\n";
const PLAN_SAVED = { body: PLAN_TEXT, assumptions: [] } as const;
const PLAN_WORDS = {
  FIRST: "Any member should be able to invite, not only admins.",
} as const;

/** A rollout of three pull requests: the schema on main, and a route and a screen both on the schema. */
const ROLLOUT: readonly RolloutItem[] = [
  { title: "Schema", scope: "The invitation table.", base: ROLLOUT_BASE.MAIN, acceptance: null },
  { title: "Route", scope: "POST /api/invitations.", base: 1, acceptance: null },
  { title: "Screen", scope: "The invite dialog.", base: 1, acceptance: null },
];

/** The options the route's worker offers when it asks, the first of which the scripted model takes. */
const ROUTE_OPTIONS = ["Reuse memberships", "A new invitations table"] as const;

/** What eve answers a session's opening with, read for the one field the eval continues from. */
const ACCEPTED_SESSION = Schema.Struct({ sessionId: Schema.String });

type Run = <A, E>(effect: Effect.Effect<A, E, DatabaseServices>) => Promise<A>;

async function ensureLocalDevUser(run: Run): Promise<void> {
  await run(
    Effect.asVoid(
      Database.use((db) =>
        db
          .insert(user)
          .values({
            id: LOCAL_DEV_PRINCIPAL,
            name: "Local developer",
            email: "local-dev@luke.test",
          })
          .onConflictDoNothing({ target: user.id }),
      ),
    ),
  );
}

function readConversationRuntimeSessionId(
  run: Run,
  conversationId: string,
): Promise<string | null> {
  return run(
    Effect.gen(function* () {
      const db = yield* Database;
      const rows = yield* db
        .select({ runtimeSessionId: conversations.runtimeSessionId })
        .from(conversations)
        .where(eq(conversations.id, conversationId));
      const RowSchema = Schema.Struct({ runtimeSessionId: Schema.NullOr(Schema.String) });
      const [row] = rows;
      return row === undefined ? null : Schema.decodeUnknownSync(RowSchema)(row).runtimeSessionId;
    }),
  );
}

function readMessagesByTurn(run: Run, conversationId: string, turnId: string) {
  return readMessagesByConversationTyped(run, conversationId).then((rows) =>
    rows.filter((row) => row.turnId === turnId),
  );
}

/** The id of the plan's conversation, opened on its first call; the plan must stand. */
async function planConversation(run: Run, planId: string): Promise<string> {
  const opened = await run(openPlanConversation(LOCAL_DEV_PRINCIPAL, planId));
  assert.ok(Option.isSome(opened));
  return opened.value.conversationId;
}

/** The document the plan holds now, failing the eval where it does not read. */
async function planDocument(run: Run, planId: string) {
  const stored = await run(readPlan(LOCAL_DEV_PRINCIPAL, planId));
  assert.ok(Option.isSome(stored));
  return stored.value.plan.document;
}

/** A worker's pull request as GitHub last answered it, in the state named. */
function pullRequestIn(number: number, state: PullRequestState): CodingAgentPullRequest {
  return {
    number,
    title: "Schema",
    url: `https://github.com/acme/relay/pull/${number}`,
    state,
    checks: CHECK_SUMMARY.PENDING,
    base: "main",
    mergedSha: null,
    additions: 1,
    deletions: 0,
    changedFiles: 1,
  };
}

/** An agent of the plan's rollout, with no turn yet, so it holds its place: a builder at its position, or the keeper at none. */
async function startRolloutAgent(
  run: Run,
  planId: string,
  place: { readonly role: RolloutRole; readonly position?: number },
): Promise<string> {
  const started = await run(
    createCodingAgent(LOCAL_DEV_PRINCIPAL, {
      planId,
      idempotencyKey: `${planId}-${place.role}-${place.position ?? 0}`,
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      repository: "acme/relay",
      planSnapshot: null,
      task: place.position === undefined ? "Keep the stack." : `Pull request ${place.position}`,
      ...place,
    }),
  );
  assert.ok(Option.isSome(started));
  return started.value.agent.id;
}

function startBuilder(run: Run, planId: string, position: number): Promise<string> {
  return startRolloutAgent(run, planId, { role: ROLLOUT_ROLE.BUILDER, position });
}

/** A plan holding the three-PR rollout and its keeper, with the schema's builder's pull request #415 in the state named. */
async function rolloutPlan(run: Run, schema: PullRequestState) {
  const plan = await run(startPlan(LOCAL_DEV_PRINCIPAL, PLAN));
  await run(savePlanText(LOCAL_DEV_PRINCIPAL, plan.id, PLAN_TEXT));
  await run(cutRollout(plan.id, ROLLOUT));
  const keeper = await startRolloutAgent(run, plan.id, { role: ROLLOUT_ROLE.KEEPER });
  const schemaWorker = await startBuilder(run, plan.id, 1);
  await run(updateCodingAgentBranch(LOCAL_DEV_PRINCIPAL, schemaWorker, "luke/invites/1-schema"));
  await run(
    recordCodingAgentPublished(LOCAL_DEV_PRINCIPAL, schemaWorker, pullRequestIn(415, schema)),
  );
  return { plan, keeper };
}

export default defineEval({
  description:
    "A typed ask in a plan's conversation runs through eve, the relay, and the writer into the store.",
  async test(t) {
    const connectionString = process.env[DATABASE_ENVIRONMENT.URL];
    if (!connectionString) {
      return t.skip("no database is named; the fixture writes nowhere");
    }
    const runtime = ManagedRuntime.make(sqlClientOverUrl(connectionString));
    const run: Run = (effect) => runtime.runPromise(effect);
    try {
      await ensureLocalDevUser(run);

      /** A typed ask opening a new session over the conversation, answered once the session is its record. */
      const openSession = async (
        conversationId: string,
        message: string,
        turn: BrainHostTurn = BRAIN_HOST_TURN.TYPED,
      ) => {
        const opened = await t.target.fetch("/eve/v1/session", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            [BRAIN_HOST_HEADER.CONVERSATION]: conversationId,
            [BRAIN_HOST_HEADER.TURN]: turn,
          },
          body: JSON.stringify({ message }),
        });
        assert.equal(opened.status, 202);
        // eve names more of an accepted session than the one field read here,
        // so the read drops what it does not name.
        const accepted = Result.getOrUndefined(
          readEither(ACCEPTED_SESSION, { excess: EXCESS_KEYS.DROP })(
            unparsedWire(await opened.json()),
          ),
        );
        assert.ok(accepted);
        // The door admits a session once its first event has recorded it on the conversation row.
        for (let waited = 0; waited < 40; waited += 1) {
          const runtimeSessionId = await readConversationRuntimeSessionId(run, conversationId);
          if (runtimeSessionId === accepted.sessionId) break;
          await t.sleep(250);
        }
        return accepted;
      };

      // The planning model is handed the saved document and answers in words;
      // the notetaker beside the call writes the plan, so the turn leaves the
      // document as it stood.
      const plan = await run(startPlan(LOCAL_DEV_PRINCIPAL, PLAN));
      await run(savePlanText(LOCAL_DEV_PRINCIPAL, plan.id, PLAN_TEXT));
      const planConversationId = await planConversation(run, plan.id);
      const planning = await openSession(planConversationId, PLAN_WORDS.FIRST);
      const planningSession = await t.target.attachSession(planning.sessionId);
      planningSession.succeeded();
      assert.deepEqual(await planDocument(run, plan.id), PLAN_SAVED);

      const turnId = hostTurnId(planning.sessionId, "turn_0");
      const turn = await readTurnById(run, turnId);
      assert.ok(turn);
      assert.equal(turn.conversationId, planConversationId);
      assert.equal(turn.origin, TURN_ORIGIN.TYPED);
      assert.equal(turn.status, TURN_STATUS.SETTLED);
      // What the turn ran under, carried from the session's start through eve's
      // durable state to the turn row: the prompt's fingerprint and the tool
      // set's, neither naming a row, since nothing of either is kept.
      assert.equal(turn.promptHash?.length, SHA256_HEX_LENGTH);
      assert.equal(turn.toolSetHash, toolSetHashOf(planningToolDeclarations()));

      const planningRows = await readMessagesByTurn(run, planConversationId, turnId);
      assert.deepEqual(
        planningRows.map((row) => row.role),
        [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT],
      );
      assert.deepEqual(planningRows[0]?.metadata, {
        author: MESSAGE_AUTHOR.DEVELOPER,
        channel: MESSAGE_CHANNEL.TYPED,
      });
      const planningAnswer = planningRows[1];
      assert.ok(planningAnswer);
      assert.ok(
        planningAnswer.parts.some(
          (part) => isTextUIPart(part) && part.text === SCRIPTED_PLANNING_REPLY,
        ),
      );
      const runtimeSessionId = await readConversationRuntimeSessionId(run, planConversationId);
      assert.equal(runtimeSessionId, planning.sessionId);

      // Research handed to the worker subagent returns a receipt at once, and
      // the planning turn stays open until the worker's result reaches the
      // model inside it: one turn on record, settled, holding the call, the
      // words before the wait, and the words after it.
      const researchPlan = await run(startPlan(LOCAL_DEV_PRINCIPAL, PLAN));
      const researchConversationId = await planConversation(run, researchPlan.id);
      const research = await openSession(
        researchConversationId,
        `${SCRIPTED_DELEGATE}invite links`,
      );
      const researchSession = await t.target.attachSession(research.sessionId);
      researchSession.succeeded();
      const researchTurnId = hostTurnId(research.sessionId, "turn_0");
      let held: Awaited<ReturnType<typeof readTurnById>> | undefined;
      for (let waited = 0; waited < 120 && held?.status !== TURN_STATUS.SETTLED; waited += 1) {
        held = await readTurnById(run, researchTurnId);
        await t.sleep(500);
      }
      assert.ok(held);
      assert.equal(held.origin, TURN_ORIGIN.TYPED);
      assert.equal(held.status, TURN_STATUS.SETTLED);
      assert.equal(await readTurnById(run, hostTurnId(research.sessionId, "turn_1")), undefined);
      // The worker ran to its end on its own model and tools, rather than failing for want of them.
      const settled = researchSession.events.find((event) => event.type === "task.settled");
      assert.ok(settled && settled.type === "task.settled");
      assert.equal(settled.data.name, PLANNER_DELEGATE_TOOL.name);
      assert.equal(settled.data.status, "completed");
      const researchRows = await readMessagesByTurn(run, researchConversationId, held.id);
      assert.deepEqual(
        researchRows.map((row) => row.role),
        [MESSAGE_ROLE.USER, MESSAGE_ROLE.ASSISTANT],
      );
      const researchAnswer = researchRows[1];
      assert.ok(researchAnswer);
      const delegation = researchAnswer.parts.find((part) => isToolUIPart(part));
      assert.ok(delegation);
      assert.equal(delegation.type, `tool-${PLANNER_DELEGATE_TOOL.name}`);
      assert.equal(delegation.state, TOOL_PART_STATE.OUTPUT_AVAILABLE);
      // The words before the wait and the words after it, in one answer.
      assert.ok(researchAnswer.parts.filter((part) => isTextUIPart(part)).length >= 2);

      // A repository read on a plan with no repository yet runs nothing and
      // says so: the refusal reaches the model as the tool's result, ahead of
      // any sandbox, and the model repeats why.
      const readingPlan = await run(startPlan(LOCAL_DEV_PRINCIPAL, PLAN));
      const readingConversationId = await planConversation(run, readingPlan.id);
      const reading = await openSession(readingConversationId, `${SCRIPTED_READ}ls`);
      const readingSession = await t.target.attachSession(reading.sessionId);
      readingSession.succeeded();
      const readingRows = await readMessagesByTurn(
        run,
        readingConversationId,
        hostTurnId(reading.sessionId, "turn_0"),
      );
      const readingAnswer = readingRows[1];
      assert.ok(readingAnswer);
      assert.ok(
        readingAnswer.parts.some(
          (part) =>
            isTextUIPart(part) &&
            part.text === `${SCRIPTED_NOT_READ_REPLY} ${REPOSITORY_SHELL_REFUSAL.NO_REPOSITORY}`,
        ),
      );

      /** A report as a report turn on its plan's conversation, answered with the tool calls the model made in it. */
      const reportTurn = async (planId: string, report: Report) => {
        const conversationId = await planConversation(run, planId);
        const opened = await openSession(
          conversationId,
          reportText(report),
          BRAIN_HOST_TURN.REPORT,
        );
        const session = await t.target.attachSession(opened.sessionId);
        session.succeeded();
        const turn = await readTurnById(run, hostTurnId(opened.sessionId, "turn_0"));
        assert.ok(turn);
        assert.equal(turn.origin, TURN_ORIGIN.REPORT);
        assert.equal(turn.status, TURN_STATUS.SETTLED);
        const rows = await readMessagesByTurn(run, conversationId, turn.id);
        return rows
          .flatMap((row) => row.parts)
          .filter((part) => isToolUIPart(part))
          .map((part) => ({ type: part.type, input: part.input }));
      };

      /** The calls a report turn made, with the listing it read the agents through left out. */
      const actedOn = async (planId: string, report: Report) =>
        (await reportTurn(planId, report)).filter(
          (call) => call.type !== `tool-${LIST_CODING_AGENTS_TOOL.name}`,
        );
      const messageTo = (agentId: string, text: string) => ({
        type: `tool-${MESSAGE_CODING_AGENT_TOOL.name}`,
        input: { agentId, text },
      });

      // The schema's pull request opens, so the keeper is told to stack it,
      // and the route and the screen, both on it, are ready to start: the
      // model starts those two and nothing else.
      const opened = await rolloutPlan(run, PULL_REQUEST_STATE.OPEN);
      assert.deepEqual(
        await actedOn(opened.plan.id, {
          kind: REPORT_KIND.PR_OPENED,
          position: 1,
          pullRequest: 415,
          text: "The invitation table is up for review.",
        }),
        [
          messageTo(opened.keeper, SCRIPTED_STACK),
          ...[2, 3].map((position) => ({
            type: `tool-${START_CODING_AGENT_TOOL.name}`,
            input: { position },
          })),
        ],
      );

      // The route's builder asks, offering two answers, and the model answers
      // that builder with one of them.
      const asking = await rolloutPlan(run, PULL_REQUEST_STATE.OPEN);
      const route = await startBuilder(run, asking.plan.id, 2);
      assert.deepEqual(
        await actedOn(asking.plan.id, {
          kind: REPORT_KIND.QUESTION,
          position: 2,
          text: "Where do pending invitations live?",
          options: [...ROUTE_OPTIONS],
        }),
        [messageTo(route, `Go with ${ROUTE_OPTIONS[0]}.`)],
      );

      // The schema merges, by the keeper on the developer's word or by hand
      // on GitHub, while the route and the screen, both on it, are being
      // built: the keeper alone is told to retarget and restack, no builder
      // is told anything, and nothing is started.
      for (const reporter of [{ keeper: true }, { github: "acme/relay" }] as const) {
        const merging = await rolloutPlan(run, PULL_REQUEST_STATE.MERGED);
        await startBuilder(run, merging.plan.id, 2);
        await startBuilder(run, merging.plan.id, 3);
        assert.deepEqual(
          await actedOn(merging.plan.id, {
            ...reporter,
            kind: REPORT_KIND.MERGED,
            pullRequest: 415,
            text: "Squashed onto main.",
          }),
          [messageTo(merging.keeper, SCRIPTED_RESTACK)],
        );
      }
    } finally {
      await runtime.dispose();
    }
  },
});
