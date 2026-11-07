import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@repo/database/core/query";
import { claimAgentRunnerLease } from "@repo/database/models/agent-runner-lease";
import { writeAgentRunnerRecord } from "@repo/database/models/agent-runner-record";
import { type Agent, createAgent } from "@repo/database/models/agent-store";
import { user } from "@repo/database/schemas/auth";
import { conversations, turns } from "@repo/database/schemas/storage";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@repo/database/storage-vocabulary";
import { getTestDB, startTask } from "@repo/database/testing";
import { TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@repo/wire";
import { noNetwork } from "@repo/wire/testing";
import { eq } from "drizzle-orm";
import { Duration, Effect, ErrorReporter, Layer, Option } from "effect";
import { afterEach, vi } from "vitest";
import { CODER } from "../agents/coder-host/bounds.js";
import { commandRead, type ReadCommand } from "../testing/runner-sandbox-fake.js";
import {
  commandLogsStreamed,
  fixtureToken,
  sandboxesListed,
  sandboxFetchOver,
  sandboxFound,
  sandboxListRefusal,
} from "../testing/vercel-sandbox-fake.js";
import { NATIVE_SANDBOX_SWEEP, sweepNativeSandboxes } from "./native-sandbox-sweep.js";

/**
 * The scheduled sweep's settle of a native agent's turn whose runner died
 * mid-turn, over a real store and a fake of Vercel Sandbox's REST API that
 * keeps the project's sandboxes and what it was asked: the turn is settled
 * failed and reported, a runner still up keeps its turn, and each sweep
 * reads no more than its bounds, leaving the rest to the next minute.
 *
 * Synthetic accounts, agents, sandboxes, and tokens throughout.
 */

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";
const NOW = new Date(Date.UTC(2026, 9, 14, 12));
const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
/** The page the fake answers a list in: the API's widest, as the sweep asks for. */
const PAGE = 50;

interface FakeSandbox {
  readonly name: string;
  status: string;
  readonly currentSessionId: string;
  tags: Record<string, string>;
}

/** A sandbox of the fake's as Vercel names it, created at the epoch. */
const listedOf = (sandbox: FakeSandbox) => ({ ...sandbox, createdAt: 0 });

/** Vercel's refusal of a call, as one `@vercel/sandbox` never tries again, which it would a 5xx on a real timer. */
const refusal = () => Response.json({ error: { code: "bad_request" } }, { status: 400 });

/** Vercel Sandbox's REST API over the project's sandboxes, oldest first, keeping what it was asked. */
function vercel(
  options: { readonly refuseList?: boolean; readonly refuseLaterPages?: boolean } = {},
) {
  const sandboxes: FakeSandbox[] = [];
  /** The detached commands, by id, with their exit code, or null while they run, and what they printed on stderr. */
  const commands = new Map<string, ReadCommand & { readonly stderr?: string }>();
  const pagesListed: { status: string | null; sortBy: string | null; order: string | null }[] = [];
  const respond = async (url: string, init: RequestInit): Promise<Response> => {
    const parsed = new URL(url);
    const method = init.method ?? "GET";
    assert.equal(parsed.searchParams.get("teamId"), TEAM);
    if (method === "GET" && parsed.pathname === "/api/v2/sandboxes") {
      const refused = sandboxListRefusal(parsed);
      if (refused !== undefined) return refused;
      const tag = parsed.searchParams.get("tags");
      if (tag !== null) {
        const [key = "", value] = tag.split(":");
        return Response.json(
          sandboxesListed(sandboxes.filter((each) => each.tags[key] === value).map(listedOf)),
        );
      }
      if (options.refuseList === true) return refusal();
      assert.equal(parsed.searchParams.get("project"), PROJECT);
      const status = parsed.searchParams.get("status");
      const order = parsed.searchParams.get("sortOrder");
      pagesListed.push({ status, sortBy: parsed.searchParams.get("sortBy"), order });
      if (options.refuseLaterPages === true && parsed.searchParams.has("cursor")) return refusal();
      const from = Number(parsed.searchParams.get("cursor") ?? "0");
      const matching = sandboxes.filter((each) => status === null || each.status === status);
      if (order === "desc") matching.reverse();
      const page = matching.slice(from, from + PAGE);
      const next = from + PAGE < matching.length ? String(from + PAGE) : null;
      return Response.json(sandboxesListed(page.map(listedOf), next));
    }
    const named = /^\/api\/v2\/sandboxes\/([^/]+)$/u.exec(parsed.pathname);
    if (named !== null) {
      const sandbox = sandboxes.find((each) => each.name === decodeURIComponent(named[1] ?? ""));
      if (sandbox === undefined) {
        return Response.json({ error: { code: "not_found" } }, { status: 404 });
      }
      return Response.json(sandboxFound(listedOf(sandbox)));
    }
    const session = /^\/api\/v2\/sandboxes\/sessions\/([^/]+)\/(.+)$/u.exec(parsed.pathname);
    assert.ok(session !== null, `an unexpected call: ${method} ${parsed.pathname}`);
    const [, , rest = ""] = session;
    const command = /^cmd\/([^/]+)(\/logs)?$/u.exec(rest);
    assert.ok(command !== null, `an unexpected call: ${method} ${parsed.pathname}`);
    const found = commands.get(command[1] ?? "");
    if (found === undefined) {
      return Response.json({ error: { code: "not_found" } }, { status: 404 });
    }
    if (command[2] === undefined) return commandRead(found, parsed, init, false);
    return commandLogsStreamed(found.stderr ?? "");
  };
  return {
    // The sweep's settle of a lost runner reaches GitHub's client, which no test here sends on.
    layer: Layer.merge(sandboxFetchOver(respond), noNetwork),
    sandboxes,
    commands,
    pagesListed,
  };
}

/** An agent on the runtime given, its newest turn in the status given where one is, settled at the instant given. */
const openAgent = (runtime: ConversationRuntime, turn?: { status: TurnStatus; at: Date }) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@app.test` });
    const task = yield* startTask(userId, { name: "Teammate invitations" });
    const started = yield* createAgent(userId, {
      taskId: task.id,
      idempotencyKey: "start-1",
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      descriptionSnapshot: "# Teammate invitations\n",
      prompt: null,
      repository: null,
      runtime,
    });
    const agent = Option.getOrThrow(started).agent;
    if (turn !== undefined) {
      const ended = turn.status !== TURN_STATUS.RUNNING && turn.status !== TURN_STATUS.QUEUED;
      yield* db.insert(turns).values({
        userId,
        conversationId: agent.conversationId,
        origin: TURN_ORIGIN.TYPED,
        status: turn.status,
        queuedAt: turn.at,
        settledAt: ended ? turn.at : null,
      });
    }
    return agent;
  });

/** How a native sandbox was named and tagged: as one is opened now, or as one made before the rename was. */
const NAMING = {
  TODAY: { name: "agent-sandbox-", agent: "agentId" },
  BEFORE_RENAME: { name: "luke-agent-", agent: "lukeAgent" },
} as const;

/** A running sandbox as we name a native agent's, tagged with its session and its agent. */
function nativeSandbox(
  agentId: string,
  naming: (typeof NAMING)[keyof typeof NAMING] = NAMING.TODAY,
): FakeSandbox {
  const id = randomUUID();
  return {
    name: `${naming.name}${id}`,
    status: "running",
    currentSessionId: `sbs_${id}`,
    tags: { sessionId: `claude-code-${id}`, [naming.agent]: agentId },
  };
}

/** The session a sandbox's tag names. */
function sessionOf(sandbox: FakeSandbox): string {
  const { sessionId } = sandbox.tags;
  assert.ok(sessionId !== undefined);
  return sessionId;
}

/** A running native sandbox of the agent's whose session records the command given as its runner, as a launch at event 7 records it. */
const sandboxRunning = (agent: Agent, commandId: string) =>
  Effect.gen(function* () {
    const sandbox = nativeSandbox(agent.id);
    yield* writeAgentRunnerRecord(agent.userId, sessionOf(sandbox), {
      agentId: agent.id,
      sandboxName: sandbox.name,
      firstSequence: 7,
      fingerprint: null,
      sandboxSessionId: sandbox.currentSessionId,
      commandId,
    });
    return sandbox;
  });

/** A running sandbox as eve names one, tagged with its session alone. */
function eveSandbox(): FakeSandbox {
  const id = randomUUID();
  return {
    name: `eve-${id}`,
    status: "running",
    currentSessionId: `sbs_eve_${id}`,
    tags: { sessionId: `wrun_${id}` },
  };
}

/** A running sandbox whose runner exited while its agent's turn still runs. */
const lostSandbox = (api: ReturnType<typeof vercel>) =>
  Effect.gen(function* () {
    const agent = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
      status: TURN_STATUS.RUNNING,
      at: minutesBefore(10),
    });
    const commandId = `cmd_${randomUUID()}`;
    api.commands.set(commandId, { id: commandId, exitCode: 1 });
    return yield* sandboxRunning(agent, commandId);
  });

afterEach(() => {
  vi.unstubAllEnvs();
});

it.layer(getTestDB())("the native sandbox sweep", (it) => {
  it.effect(
    "a runner that exited mid-turn has its turn settled failed with its exit code and stderr and the projection's turn dropped, reported by its exit code alone; a runner still up keeps its turn",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const db = yield* Database;
        const crashed = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
          status: TURN_STATUS.RUNNING,
          at: minutesBefore(10),
        });
        const working = yield* openAgent(CONVERSATION_RUNTIME.CODEX, {
          status: TURN_STATUS.RUNNING,
          at: minutesBefore(10),
        });
        const [lostTurn] = yield* db
          .select({ id: turns.id })
          .from(turns)
          .where(eq(turns.conversationId, crashed.conversationId));
        assert.ok(lostTurn !== undefined);
        yield* db
          .update(conversations)
          .set({ nativeProjection: { session: "cli-session", turn: { id: lostTurn.id } } })
          .where(eq(conversations.id, crashed.conversationId));
        const api = vercel();
        api.commands.set("cmd_killed", {
          id: "cmd_killed",
          exitCode: 137,
          stderr: "agent-runner: JavaScript heap out of memory\n",
        });
        api.commands.set("cmd_running", { id: "cmd_running", exitCode: null });
        const dead = yield* sandboxRunning(crashed, "cmd_killed");
        const alive = yield* sandboxRunning(working, "cmd_running");
        api.sandboxes.push(dead, alive);

        const reported: Record<string, unknown>[] = [];
        const reporter = ErrorReporter.layer([
          ErrorReporter.make(({ attributes }) => {
            reported.push({ ...attributes });
          }),
        ]);

        const outcome = yield* sweepNativeSandboxes(NOW).pipe(
          Effect.provide(Layer.merge(api.layer, reporter)),
        );

        assert.deepEqual(outcome, { lost: 1 });
        const statusOf = (conversationId: string) =>
          db
            .select({ status: turns.status, failureDetail: turns.failureDetail })
            .from(turns)
            .where(eq(turns.conversationId, conversationId));
        const [settled] = yield* statusOf(crashed.conversationId);
        assert.equal(settled?.status, TURN_STATUS.FAILED);
        assert.equal(
          settled?.failureDetail,
          "the agent's runner stopped before its turn ended: exit 137, stderr: agent-runner: JavaScript heap out of memory",
        );
        // Note that the stderr stays in the turn's row: what is reported reaches Sentry.
        assert.equal(reported.length, 1);
        assert.equal(reported[0]?.exitCode, "137");
        assert.ok(!JSON.stringify(reported).includes("heap out of memory"));
        assert.equal((yield* statusOf(working.conversationId))[0]?.status, TURN_STATUS.RUNNING);
        const [projection] = yield* db
          .select({ projection: conversations.nativeProjection })
          .from(conversations)
          .where(eq(conversations.id, crashed.conversationId));
        assert.deepEqual(projection?.projection, { session: "cli-session" });
        assert.equal(dead.status, "running");
        assert.equal(alive.status, "running");
      }),
  );

  it.effect("a lost runner whose agent's runner lease a message holds keeps its turn", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercel();
      const sandbox = yield* lostSandbox(api);
      api.sandboxes.push(sandbox);
      const agentId = sandbox.tags.agentId ?? "";
      const heldUntil = new Date(NOW.getTime() + Duration.toMillis(CODER.RUNNER_LEASE.HOLD));
      assert.ok(yield* claimAgentRunnerLease(agentId, randomUUID(), NOW, heldUntil));

      const outcome = yield* sweepNativeSandboxes(NOW).pipe(Effect.provide(api.layer));

      assert.deepEqual(outcome, { lost: 0 });
    }),
  );

  it.effect(
    "a sweep reads no more pages than its bound, and a lost runner past them is reached from the other end the next minute",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = vercel();
        for (let each = 0; each < NATIVE_SANDBOX_SWEEP.MAX_PAGES * PAGE; each += 1) {
          api.sandboxes.push(eveSandbox());
        }
        api.sandboxes.push(yield* lostSandbox(api));

        const outcome = yield* sweepNativeSandboxes(NOW).pipe(Effect.provide(api.layer));
        const pagesAsked = api.pagesListed.length;
        const nextMinute = yield* sweepNativeSandboxes(new Date(NOW.getTime() + 60_000)).pipe(
          Effect.provide(api.layer),
        );

        assert.equal(pagesAsked, NATIVE_SANDBOX_SWEEP.MAX_PAGES);
        assert.deepEqual(outcome, { lost: 0 });
        assert.equal(
          api.pagesListed.at(-1)?.order,
          "desc",
          "the next minute lists from the newest",
        );
        assert.deepEqual(nextMinute, { lost: 1 });
      }),
  );

  it.effect(
    "a lost runner listed past the window at both ends, among sandboxes that keep running, is reached as the window moves along",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = vercel();
        // Sandboxes whose run goes on keep running sweep after sweep, as agents at work do.
        const running = NATIVE_SANDBOX_SWEEP.MAX_SANDBOXES * 2 + 10;
        for (let each = 0; each < running; each += 1)
          api.sandboxes.push(nativeSandbox(randomUUID()));
        api.sandboxes.splice(NATIVE_SANDBOX_SWEEP.MAX_SANDBOXES + 5, 0, yield* lostSandbox(api));

        let lost = 0;
        for (let minute = 0; minute < 6 && lost === 0; minute += 1) {
          const outcome = yield* sweepNativeSandboxes(
            new Date(NOW.getTime() + minute * 60_000),
          ).pipe(Effect.provide(api.layer));
          lost = outcome.lost;
        }

        assert.equal(lost, 1);
      }),
  );

  it.effect("a later page Vercel refused leaves the pages before it to be swept", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercel({ refuseLaterPages: true });
      api.sandboxes.push(yield* lostSandbox(api));
      for (let each = 0; each < PAGE; each += 1) api.sandboxes.push(nativeSandbox(randomUUID()));

      const outcome = yield* sweepNativeSandboxes(NOW).pipe(Effect.provide(api.layer));

      assert.equal(api.pagesListed.length, 2, "the second page was asked and refused");
      assert.deepEqual(outcome, { lost: 1 });
    }),
  );

  it.effect("a list Vercel refused sweeps nothing and fails nothing after it", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercel({ refuseList: true });
      api.sandboxes.push(yield* lostSandbox(api));

      const outcome = yield* sweepNativeSandboxes(NOW).pipe(Effect.provide(api.layer));

      assert.deepEqual(outcome, { lost: 0 });
    }),
  );
});
