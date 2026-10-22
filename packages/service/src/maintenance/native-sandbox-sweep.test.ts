import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { holdSandbox } from "@luke/database/models/sandbox-terminal-lease";
import { user } from "@luke/database/schemas/auth";
import { turns } from "@luke/database/schemas/storage";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@luke/database/storage-vocabulary";
import { getTestDB, startTask } from "@luke/database/testing";
import { TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@luke/wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Duration, Effect, Option } from "effect";
import { afterEach, vi } from "vitest";
import { commandRead, type ReadCommand } from "../testing/runner-sandbox-fake.js";
import { sandboxListRefusal, sandboxStopRefusal } from "../testing/vercel-sandbox-fake.js";
import { NATIVE_SANDBOX_SWEEP, sweepNativeSandboxes } from "./native-sandbox-sweep.js";

/**
 * The scheduled sweep's stop of a native agent's sandbox whose run ended,
 * over a real store and a fake of Vercel Sandbox's REST API that keeps the
 * project's sandboxes and what it was asked: an ended sandbox no Terminal
 * holds is stopped, its credential taken off first; one a Terminal holds,
 * one whose run goes on or waits, and one whose run ended within the grace
 * keep running; an eve sandbox is never asked after; and each sweep stops
 * and reads no more than its bounds, leaving the rest to the next minute.
 *
 * Synthetic accounts, agents, sandboxes, and tokens throughout.
 */

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";
const NOW = new Date(Date.UTC(2026, 9, 14, 12));
const GRACE_MS = Duration.toMillis(NATIVE_SANDBOX_SWEEP.GRACE);
const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
/** The page the fake answers a list in: the API's widest, as the sweep asks for. */
const PAGE = 50;

/** An unsigned token naming the fixture's project and team, a year from expiring. */
function fixtureToken(): string {
  const exp = Math.floor(Date.UTC(2027, 9, 14) / 1000);
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify({ project_id: PROJECT, owner_id: TEAM, exp }),
  ).toString("base64url");
  return `${header}.${payload}.`;
}

interface FakeSandbox {
  readonly name: string;
  status: string;
  readonly currentSessionId: string;
  readonly tags: Record<string, string>;
}

/** Vercel Sandbox's REST API over the project's sandboxes, oldest first, keeping what it was asked. */
function vercel(options: { readonly refuseList?: boolean; readonly refusePolicy?: boolean } = {}) {
  const sandboxes: FakeSandbox[] = [];
  /** The detached commands, by id, with their exit code, or null while they run. */
  const commands = new Map<string, ReadCommand>();
  const stopped: string[] = [];
  const policies: string[] = [];
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
        return Response.json({ sandboxes: sandboxes.filter((each) => each.tags[key] === value) });
      }
      if (options.refuseList === true) return new Response(null, { status: 503 });
      assert.equal(parsed.searchParams.get("project"), PROJECT);
      const status = parsed.searchParams.get("status");
      const order = parsed.searchParams.get("sortOrder");
      pagesListed.push({ status, sortBy: parsed.searchParams.get("sortBy"), order });
      const from = Number(parsed.searchParams.get("cursor") ?? "0");
      const matching = sandboxes.filter((each) => status === null || each.status === status);
      if (order === "desc") matching.reverse();
      const page = matching.slice(from, from + PAGE);
      const next = from + PAGE < matching.length ? String(from + PAGE) : null;
      return Response.json({ sandboxes: page, pagination: { count: page.length, next } });
    }
    const session = /^\/api\/v2\/sandboxes\/sessions\/([^/]+)\/(.+)$/u.exec(parsed.pathname);
    assert.ok(session !== null, `an unexpected call: ${method} ${parsed.pathname}`);
    const [, sessionId = "", rest = ""] = session;
    if (rest === "stop") {
      const refused = sandboxStopRefusal(init);
      if (refused !== undefined) return refused;
      stopped.push(sessionId);
      for (const sandbox of sandboxes.filter((each) => each.currentSessionId === sessionId)) {
        sandbox.status = "stopped";
      }
      return Response.json({ session: { id: sessionId } });
    }
    const command = /^cmd\/([^/]+)$/u.exec(rest);
    if (command !== null) {
      const found = commands.get(command[1] ?? "");
      if (found === undefined) return new Response(null, { status: 404 });
      return commandRead(found, parsed, init, false);
    }
    assert.equal(rest, "network-policy", `an unexpected call: ${method} ${parsed.pathname}`);
    if (options.refusePolicy === true) return new Response(null, { status: 502 });
    policies.push(sessionId);
    return Response.json({});
  };
  return {
    layer: fakeHttpClientLayer(respond),
    sandboxes,
    commands,
    stopped,
    policies,
    pagesListed,
  };
}

/** An agent on the runtime given, its newest turn in the status given where one is, settled at the instant given. */
const openAgent = (runtime: ConversationRuntime, turn?: { status: TurnStatus; at: Date }) =>
  Effect.gen(function* () {
    const db = yield* Database;
    const userId = `user-${randomUUID()}`;
    yield* db.insert(user).values({ id: userId, name: "Test User", email: `${userId}@luke.test` });
    const task = yield* startTask(userId, { name: "Teammate invitations" });
    const started = yield* createCodingAgent(userId, {
      taskId: task.id,
      idempotencyKey: "start-1",
      model: "anthropic/claude-opus-5.5",
      effort: "high",
      planSnapshot: "# Teammate invitations\n",
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

/** A running sandbox as Luke names a native agent's, tagged with its agent, and with the runner named where one was launched. */
function nativeSandbox(agentId: string, commandId?: string): FakeSandbox {
  const id = randomUUID();
  const running = `sbs_${id}`;
  const runner =
    commandId === undefined
      ? {}
      : { lukeRunnerSession: running, lukeRunnerCommand: commandId, lukeRunnerLaunch: "7" };
  return {
    name: `luke-agent-${id}`,
    status: "running",
    currentSessionId: running,
    tags: { sessionId: `luke-claude-code-${id}`, lukeAgent: agentId, ...runner },
  };
}

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

afterEach(() => {
  vi.unstubAllEnvs();
});

it.layer(getTestDB())("the native sandbox sweep", (it) => {
  it.effect(
    "an ended sandbox no Terminal holds is stopped, credential first; a held, running, waiting, or just-ended one keeps running, and eve's is never asked after",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const longAgo = minutesBefore(10);
        const ended = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
          status: TURN_STATUS.SETTLED,
          at: longAgo,
        });
        const codexEnded = yield* openAgent(CONVERSATION_RUNTIME.CODEX, {
          status: TURN_STATUS.FAILED,
          at: longAgo,
        });
        const held = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
          status: TURN_STATUS.SETTLED,
          at: longAgo,
        });
        const queued = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
          status: TURN_STATUS.QUEUED,
          at: longAgo,
        });
        // A runner waiting on a wakeup posts no END, so its turn stays running.
        const waiting = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
          status: TURN_STATUS.RUNNING,
          at: longAgo,
        });
        const justEnded = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
          status: TURN_STATUS.SETTLED,
          at: new Date(NOW.getTime() - GRACE_MS + 1),
        });
        const onEve = yield* openAgent(CONVERSATION_RUNTIME.EVE, {
          status: TURN_STATUS.SETTLED,
          at: longAgo,
        });
        yield* holdSandbox(held.conversationId, new Date(NOW.getTime() + 60_000));
        const api = vercel();
        const sandboxOf = new Map(
          [ended, codexEnded, held, queued, waiting, justEnded].map((agent) => {
            const sandbox = nativeSandbox(agent.id);
            api.sandboxes.push(sandbox);
            return [agent.id, sandbox] as const;
          }),
        );
        // eve's sandbox, even tagged as an ended native agent's would be, is not Luke's to stop.
        const eve = { ...eveSandbox(), tags: { sessionId: "wrun_eve", lukeAgent: ended.id } };
        const eveOwn = eveSandbox();
        // A sandbox named as Luke's whose agent runs on eve is left to eve's own lifecycle.
        const misnamed = nativeSandbox(onEve.id);
        api.sandboxes.unshift(eve, eveOwn);
        api.sandboxes.push(misnamed);

        const outcome = yield* sweepNativeSandboxes(NOW).pipe(Effect.provide(api.layer));

        const sessionOf = (agentId: string) => sandboxOf.get(agentId)?.currentSessionId;
        const stoppable = [sessionOf(ended.id), sessionOf(codexEnded.id)].sort();
        assert.deepEqual(outcome, { stopped: 2, held: 1, failed: 0, deferred: 0 });
        assert.deepEqual([...api.stopped].sort(), stoppable);
        assert.deepEqual([...api.policies].sort(), stoppable, "the credential goes first");
        for (const agent of [held, queued, waiting, justEnded]) {
          assert.equal(sandboxOf.get(agent.id)?.status, "running");
        }
        assert.deepEqual(
          [eve, eveOwn, misnamed].map((sandbox) => sandbox.status),
          ["running", "running", "running"],
        );
        assert.deepEqual(api.pagesListed, [
          { status: "running", sortBy: "createdAt", order: "asc" },
        ]);
      }),
  );

  it.effect(
    "a sweep stops no more than its bound and leaves the rest to the next, which stops them",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = vercel();
        const count = NATIVE_SANDBOX_SWEEP.MAX_STOPS + 2;
        for (let each = 0; each < count; each += 1) {
          const agent = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
            status: TURN_STATUS.SETTLED,
            at: minutesBefore(10),
          });
          api.sandboxes.push(nativeSandbox(agent.id));
        }

        const first = yield* sweepNativeSandboxes(NOW).pipe(Effect.provide(api.layer));
        const stoppedFirst = api.stopped.length;
        const second = yield* sweepNativeSandboxes(NOW).pipe(Effect.provide(api.layer));

        assert.deepEqual(first, {
          stopped: NATIVE_SANDBOX_SWEEP.MAX_STOPS,
          held: 0,
          failed: 0,
          deferred: 2,
        });
        assert.equal(stoppedFirst, NATIVE_SANDBOX_SWEEP.MAX_STOPS);
        assert.deepEqual(second, { stopped: 2, held: 0, failed: 0, deferred: 0 });
        assert.ok(api.sandboxes.every((sandbox) => sandbox.status === "stopped"));
      }),
  );

  it.effect(
    "a sweep reads no more pages than its bound, and a native sandbox past them is reached from the other end the next minute",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = vercel();
        for (let each = 0; each < NATIVE_SANDBOX_SWEEP.MAX_PAGES * PAGE; each += 1) {
          api.sandboxes.push(eveSandbox());
        }
        const agent = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
          status: TURN_STATUS.SETTLED,
          at: minutesBefore(10),
        });
        const beyond = nativeSandbox(agent.id);
        api.sandboxes.push(beyond);

        const outcome = yield* sweepNativeSandboxes(NOW).pipe(Effect.provide(api.layer));

        const pagesAsked = api.pagesListed.length;
        const runningAfterFirst = beyond.status;
        const nextMinute = yield* sweepNativeSandboxes(new Date(NOW.getTime() + 60_000)).pipe(
          Effect.provide(api.layer),
        );

        assert.equal(pagesAsked, NATIVE_SANDBOX_SWEEP.MAX_PAGES);
        assert.deepEqual(outcome, { stopped: 0, held: 0, failed: 0, deferred: 0 });
        assert.equal(runningAfterFirst, "running");
        assert.equal(
          api.pagesListed.at(-1)?.order,
          "desc",
          "the next minute lists from the newest",
        );
        assert.deepEqual(nextMinute, { stopped: 1, held: 0, failed: 0, deferred: 0 });
        assert.equal(beyond.status, "stopped");
      }),
  );

  it.effect("a list Vercel refused sweeps nothing and fails nothing after it", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercel({ refuseList: true });
      const agent = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
        status: TURN_STATUS.SETTLED,
        at: minutesBefore(10),
      });
      api.sandboxes.push(nativeSandbox(agent.id));

      const outcome = yield* sweepNativeSandboxes(NOW).pipe(Effect.provide(api.layer));

      assert.deepEqual(outcome, { stopped: 0, held: 0, failed: 0, deferred: 0 });
      assert.deepEqual(api.stopped, []);
    }),
  );
  it.effect(
    "a sandbox whose ended run was followed by a newer runner keeps running, and one whose old runner exited or is gone is stopped",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = vercel();
        const relaunched = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
          status: TURN_STATUS.SETTLED,
          at: minutesBefore(10),
        });
        const exited = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
          status: TURN_STATUS.SETTLED,
          at: minutesBefore(10),
        });
        const vanished = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
          status: TURN_STATUS.SETTLED,
          at: minutesBefore(10),
        });
        api.commands.set("cmd_live", { id: "cmd_live", exitCode: null });
        // Vercel has not recorded this exit yet, as no read waited for it: a plain read names none.
        api.commands.set("cmd_exited", { id: "cmd_exited", exitCode: 0 });
        const live = nativeSandbox(relaunched.id, "cmd_live");
        const done = nativeSandbox(exited.id, "cmd_exited");
        const gone = nativeSandbox(vanished.id, "cmd_unknown");
        api.sandboxes.push(live, done, gone);

        const outcome = yield* sweepNativeSandboxes(NOW).pipe(Effect.provide(api.layer));

        assert.deepEqual(outcome, { stopped: 2, held: 0, failed: 0, deferred: 0 });
        assert.equal(live.status, "running");
        assert.equal(done.status, "stopped");
        assert.equal(gone.status, "stopped");
      }),
  );

  it.effect(
    "a sandbox whose credential would not come off the firewall is left running for the next sweep",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = vercel({ refusePolicy: true });
        const agent = yield* openAgent(CONVERSATION_RUNTIME.CLAUDE_CODE, {
          status: TURN_STATUS.SETTLED,
          at: minutesBefore(10),
        });
        const sandbox = nativeSandbox(agent.id);
        api.sandboxes.push(sandbox);

        const outcome = yield* sweepNativeSandboxes(NOW).pipe(Effect.provide(api.layer));

        assert.deepEqual(outcome, { stopped: 0, held: 0, failed: 1, deferred: 0 });
        assert.deepEqual(api.stopped, []);
        assert.equal(sandbox.status, "running");
      }),
  );
});
