import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { it } from "@effect/vitest";
import { Database } from "@luke/database/core/query";
import { createCodingAgent } from "@luke/database/models/coding-agent-store";
import { holdSandbox } from "@luke/database/models/sandbox-terminal-lease";
import { user } from "@luke/database/schemas/auth";
import { conversations, turns } from "@luke/database/schemas/storage";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@luke/database/storage-vocabulary";
import { getTestDB, startTask } from "@luke/database/testing";
import { TURN_ORIGIN, TURN_STATUS, type TurnStatus } from "@luke/wire";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { eq } from "drizzle-orm";
import { Duration, Effect, Option } from "effect";
import { afterEach, vi } from "vitest";
import { sandboxListRefusal, sandboxStopRefusal } from "../testing/vercel-sandbox-fake.js";
import { EVE_SANDBOX_SWEEP, sweepEveSandboxes } from "./eve-sandbox-sweep.js";

/**
 * The scheduled sweep's stop of an eve coding agent's orphaned sandbox,
 * over a real store and a fake of Vercel Sandbox's REST API that keeps the
 * project's sandboxes and what it was asked: a sandbox whose agent's turn
 * ended past the grace and which no lease holds is stopped, its credential
 * taken off first; one a lease holds, one whose agent has a turn queued or
 * running, and one whose turn ended within the grace keep running; one no
 * single eve agent runs in is left running and counted; a native agent's
 * sandbox and eve's templates are never asked after; and each sweep stops
 * and reads no more than its bounds, leaving the rest to the next minute.
 *
 * Synthetic accounts, agents, sandboxes, and tokens throughout.
 */

const TEAM = "team_fixture";
const PROJECT = "prj_fixture";
const NOW = new Date(Date.UTC(2026, 9, 21, 12));
const GRACE_MS = Duration.toMillis(EVE_SANDBOX_SWEEP.GRACE);
const minutesBefore = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000);
/** Long enough past the grace that a turn ended then is the sweep's to stop. */
const LONG_AGO = minutesBefore(30);
/** The page the fake answers a list in: the API's widest, as the sweep asks for. */
const PAGE = 50;

/** An unsigned token naming the fixture's project and team, a year from expiring. */
function fixtureToken(): string {
  const exp = Math.floor(Date.UTC(2027, 9, 21) / 1000);
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
  const stopped: string[] = [];
  const policies: string[] = [];
  const pagesListed: { order: string | null }[] = [];
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
      pagesListed.push({ order });
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
    assert.equal(rest, "network-policy", `an unexpected call: ${method} ${parsed.pathname}`);
    if (options.refusePolicy === true) return new Response(null, { status: 502 });
    policies.push(sessionId);
    return Response.json({});
  };
  return { layer: fakeHttpClientLayer(respond), sandboxes, stopped, policies, pagesListed };
}

/**
 * An agent on the runtime given whose conversation runs in a session of its
 * own, its newest turn in the status given where one is, queued and settled
 * at the instant given.
 */
const openAgent = (
  turn?: { status: TurnStatus; at: Date },
  runtime: ConversationRuntime = CONVERSATION_RUNTIME.EVE,
) =>
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
    const sessionId = `wrun_${randomUUID()}`;
    yield* db
      .update(conversations)
      .set({ runtimeSessionId: sessionId })
      .where(eq(conversations.id, agent.conversationId));
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
    return { ...agent, sessionId };
  });

/** A running sandbox as eve names a session's own, tagged with the session. */
function eveSandbox(sessionId: string = `wrun_${randomUUID()}`): FakeSandbox {
  const id = randomUUID().replaceAll("-", "");
  return {
    name: `eve-sbx-vercel-${id}`,
    status: "running",
    currentSessionId: `sbs_${id}`,
    tags: { sessionId },
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

it.layer(getTestDB())("the eve sandbox sweep", (it) => {
  it.effect(
    "an orphaned sandbox no lease holds is stopped, credential first; a held, queued, running, or just-ended one keeps running, an unmapped one is counted and left, and others' are never asked after",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const ended = yield* openAgent({ status: TURN_STATUS.SETTLED, at: LONG_AGO });
        const failed = yield* openAgent({ status: TURN_STATUS.FAILED, at: LONG_AGO });
        const held = yield* openAgent({ status: TURN_STATUS.SETTLED, at: LONG_AGO });
        const queued = yield* openAgent({ status: TURN_STATUS.QUEUED, at: LONG_AGO });
        const running = yield* openAgent({ status: TURN_STATUS.RUNNING, at: LONG_AGO });
        const justEnded = yield* openAgent({
          status: TURN_STATUS.SETTLED,
          at: new Date(NOW.getTime() - GRACE_MS + 1),
        });
        const native = yield* openAgent(
          { status: TURN_STATUS.SETTLED, at: LONG_AGO },
          CONVERSATION_RUNTIME.CLAUDE_CODE,
        );
        yield* holdSandbox(held.conversationId, new Date(NOW.getTime() + 60_000));
        const api = vercel();
        const sandboxOf = new Map(
          [ended, failed, held, queued, running, justEnded].map((agent) => {
            const sandbox = eveSandbox(agent.sessionId);
            api.sandboxes.push(sandbox);
            return [agent.id, sandbox] as const;
          }),
        );
        // A session no agent's conversation runs in, and an eve-named sandbox of a native agent's session, name no eve agent.
        const unknown = eveSandbox();
        const ofNative = eveSandbox(native.sessionId);
        // eve's template and a native agent's own sandbox are not this sweep's.
        const template = {
          ...eveSandbox(ended.sessionId),
          name: `eve-sbx-tpl-vercel-${randomUUID()}`,
        };
        const nativeOwn = { ...eveSandbox(ended.sessionId), name: `luke-agent-${randomUUID()}` };
        api.sandboxes.push(unknown, ofNative, template, nativeOwn);

        const outcome = yield* sweepEveSandboxes(NOW).pipe(Effect.provide(api.layer));

        const sessionOf = (agentId: string) => sandboxOf.get(agentId)?.currentSessionId;
        const stoppable = [sessionOf(ended.id), sessionOf(failed.id)].sort();
        assert.deepEqual(outcome, { stopped: 2, held: 1, failed: 0, deferred: 0, unmapped: 2 });
        assert.deepEqual([...api.stopped].sort(), stoppable);
        assert.deepEqual([...api.policies].sort(), stoppable, "the credential goes first");
        for (const agent of [held, queued, running, justEnded]) {
          assert.equal(sandboxOf.get(agent.id)?.status, "running");
        }
        assert.deepEqual(
          [unknown, ofNative, template, nativeOwn].map((sandbox) => sandbox.status),
          ["running", "running", "running", "running"],
        );
      }),
  );

  it.effect(
    "a sweep stops no more than its bound and leaves the rest to the next, which stops them",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = vercel();
        const count = EVE_SANDBOX_SWEEP.MAX_STOPS + 2;
        for (let each = 0; each < count; each += 1) {
          const agent = yield* openAgent({ status: TURN_STATUS.SETTLED, at: LONG_AGO });
          api.sandboxes.push(eveSandbox(agent.sessionId));
        }

        const first = yield* sweepEveSandboxes(NOW).pipe(Effect.provide(api.layer));
        const stoppedFirst = api.stopped.length;
        const second = yield* sweepEveSandboxes(NOW).pipe(Effect.provide(api.layer));

        assert.deepEqual(first, {
          stopped: EVE_SANDBOX_SWEEP.MAX_STOPS,
          held: 0,
          failed: 0,
          deferred: 2,
          unmapped: 0,
        });
        assert.equal(stoppedFirst, EVE_SANDBOX_SWEEP.MAX_STOPS);
        assert.deepEqual(second, { stopped: 2, held: 0, failed: 0, deferred: 0, unmapped: 0 });
        assert.ok(api.sandboxes.every((sandbox) => sandbox.status === "stopped"));
      }),
  );

  it.effect(
    "a sweep reads no more pages than its bound, and an orphan past them is reached from the other end the next minute",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = vercel();
        for (let each = 0; each < EVE_SANDBOX_SWEEP.MAX_PAGES * PAGE; each += 1) {
          api.sandboxes.push({ ...eveSandbox(), name: `luke-agent-${randomUUID()}` });
        }
        const agent = yield* openAgent({ status: TURN_STATUS.SETTLED, at: LONG_AGO });
        const beyond = eveSandbox(agent.sessionId);
        api.sandboxes.push(beyond);

        const outcome = yield* sweepEveSandboxes(NOW).pipe(Effect.provide(api.layer));

        const pagesAsked = api.pagesListed.length;
        const runningAfterFirst = beyond.status;
        const nextMinute = yield* sweepEveSandboxes(new Date(NOW.getTime() + 60_000)).pipe(
          Effect.provide(api.layer),
        );

        assert.equal(pagesAsked, EVE_SANDBOX_SWEEP.MAX_PAGES);
        assert.deepEqual(outcome, { stopped: 0, held: 0, failed: 0, deferred: 0, unmapped: 0 });
        assert.equal(runningAfterFirst, "running");
        assert.equal(
          api.pagesListed.at(-1)?.order,
          "desc",
          "the next minute lists from the newest",
        );
        assert.deepEqual(nextMinute, { stopped: 1, held: 0, failed: 0, deferred: 0, unmapped: 0 });
        assert.equal(beyond.status, "stopped");
      }),
  );

  it.effect(
    "an orphan listed past the window at both ends, among sandboxes that keep running, is reached as the window moves along",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = vercel();
        // Sandboxes no agent runs in keep running sweep after sweep, as agents at work do.
        const running = EVE_SANDBOX_SWEEP.MAX_SANDBOXES * 2 + 10;
        for (let each = 0; each < running; each += 1) api.sandboxes.push(eveSandbox());
        const agent = yield* openAgent({ status: TURN_STATUS.SETTLED, at: LONG_AGO });
        const middle = eveSandbox(agent.sessionId);
        api.sandboxes.splice(EVE_SANDBOX_SWEEP.MAX_SANDBOXES + 5, 0, middle);

        const sweeps = 6;
        for (let minute = 0; minute < sweeps && middle.status === "running"; minute += 1) {
          yield* sweepEveSandboxes(new Date(NOW.getTime() + minute * 60_000)).pipe(
            Effect.provide(api.layer),
          );
        }

        assert.equal(middle.status, "stopped");
        assert.deepEqual(api.stopped, [middle.currentSessionId]);
      }),
  );

  it.effect("a list Vercel refused sweeps nothing and fails nothing after it", () =>
    Effect.gen(function* () {
      vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
      const api = vercel({ refuseList: true });
      const agent = yield* openAgent({ status: TURN_STATUS.SETTLED, at: LONG_AGO });
      api.sandboxes.push(eveSandbox(agent.sessionId));

      const outcome = yield* sweepEveSandboxes(NOW).pipe(Effect.provide(api.layer));

      assert.deepEqual(outcome, { stopped: 0, held: 0, failed: 0, deferred: 0, unmapped: 0 });
      assert.deepEqual(api.stopped, []);
    }),
  );

  it.effect(
    "a sandbox whose credential would not come off the firewall is left running for the next sweep",
    () =>
      Effect.gen(function* () {
        vi.stubEnv("VERCEL_OIDC_TOKEN", fixtureToken());
        const api = vercel({ refusePolicy: true });
        const agent = yield* openAgent({ status: TURN_STATUS.SETTLED, at: LONG_AGO });
        const sandbox = eveSandbox(agent.sessionId);
        api.sandboxes.push(sandbox);

        const outcome = yield* sweepEveSandboxes(NOW).pipe(Effect.provide(api.layer));

        assert.deepEqual(outcome, { stopped: 0, held: 0, failed: 1, deferred: 0, unmapped: 0 });
        assert.deepEqual(api.stopped, []);
        assert.equal(sandbox.status, "running");
      }),
  );
});
