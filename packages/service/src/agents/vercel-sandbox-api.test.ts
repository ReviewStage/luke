/**
 * vercel-sandbox-api.test.ts -- what a failed call of Vercel Sandbox's REST API says of itself, against a scripted fake of it: the call, its status, and Vercel's error or the cause's; and a detached command's start and stdin tried again on a passing refusal alone.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { fixtureToken } from "../testing/runner-sandbox-fake.js";
import {
  SANDBOX_CALL,
  type SandboxCall,
  SandboxUnavailable,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "./vercel-sandbox-api.js";

const SESSION = "sbs_fixture";
const COMMAND = "cmd_fixture";
const NAME = "luke-native-fixture";
const REFUSAL = { code: "bad_request", message: "Invalid request: the fixture's refusal" } as const;
const SECRET_ENV = "fixture-secret-env-value";

/** Each call the native launch and the template make, as a caller asks it. */
const CALLS: readonly {
  readonly call: SandboxCall;
  readonly ask: (api: VercelSandboxApi) => Effect.Effect<unknown, SandboxUnavailable>;
}[] = [
  {
    call: SANDBOX_CALL.CREATE,
    ask: (api) =>
      api.create({
        name: NAME,
        snapshotId: "snap_fixture",
        tags: {},
        timeoutMs: 60_000,
        vcpus: 2,
        keepLastSnapshots: { count: 1, expiration: 0, deleteEvicted: true },
        env: { SECRET: SECRET_ENV },
      }),
  },
  {
    call: SANDBOX_CALL.FS_WRITE,
    ask: (api) =>
      api.writeFiles(SESSION, [
        { path: "/tmp/runner.mjs", contents: new Uint8Array([1]), mode: 0o644 },
      ]),
  },
  {
    call: SANDBOX_CALL.CMD,
    ask: (api) =>
      api.start(SESSION, {
        command: "bash",
        args: ["-c", "true"],
        env: { SECRET: SECRET_ENV },
        sudo: true,
      }),
  },
  { call: SANDBOX_CALL.STDIN, ask: (api) => api.writeStdin(SESSION, COMMAND, "line\n") },
  { call: SANDBOX_CALL.TAGS, ask: (api) => api.updateTags(NAME, { sessionId: "s" }) },
  { call: SANDBOX_CALL.GET, ask: (api) => api.getNamed(NAME) },
  { call: SANDBOX_CALL.LIST, ask: (api) => api.listNamed("luke-native-") },
  { call: SANDBOX_CALL.LIST, ask: (api) => api.listTagged("session_fixture") },
  { call: SANDBOX_CALL.DELETE, ask: (api) => api.deleteSandbox(NAME) },
];

/** The API under the fixture's token, over the responder given. */
function apiOver(
  respond: Parameters<typeof fakeHttpClientLayer>[0],
  readToken: () => Promise<string> = () => Promise.resolve(fixtureToken()),
) {
  return vercelSandboxApi(readToken).pipe(Effect.provide(fakeHttpClientLayer(respond)));
}

/** A responder that answers each call with the next of the answers given, the last again once they run out. */
function answering(...answers: readonly (() => Response)[]) {
  let next = 0;
  return () => {
    const answer = answers[Math.min(next, answers.length - 1)];
    next += 1;
    assert.ok(answer !== undefined);
    return answer();
  };
}

const refusedWith = (status: number) => () => Response.json({ error: REFUSAL }, { status });
const started = () => Response.json({ command: { id: COMMAND, exitCode: null } });

it.effect("each call Vercel refused names the call, its status, and Vercel's error", () =>
  Effect.gen(function* () {
    const api = yield* apiOver(refusedWith(400));
    for (const { call, ask } of CALLS) {
      const failure = yield* Effect.flip(ask(api));
      assert.equal(failure.call, call);
      assert.equal(failure.status, 400);
      assert.equal(failure.detail, `${REFUSAL.code}: ${REFUSAL.message}`);
      assert.equal(
        failure.message,
        `Vercel Sandbox ${call} answered 400: ${REFUSAL.code}: ${REFUSAL.message}`,
      );
      assert.equal(failure.message.includes(SECRET_ENV), false);
      assert.equal(failure.message.includes(fixtureToken()), false);
    }
  }),
);

it.effect("a refusal's detail is one line of at most 300 characters", () =>
  Effect.gen(function* () {
    const api = yield* apiOver(() =>
      Response.json({ error: { code: "x", message: `a\n${"b".repeat(1000)}` } }, { status: 500 }),
    );
    const failure = yield* Effect.flip(api.updateTags(NAME, {}));
    assert.ok(failure.detail !== undefined);
    assert.equal(failure.detail.length, 300);
    assert.equal(failure.detail.includes("\n"), false);
  }),
);

it.effect("a call Vercel never answered names the call and the cause", () =>
  Effect.gen(function* () {
    const api = yield* apiOver(() => {
      throw new Error("socket hang up");
    });
    for (const { call, ask } of CALLS) {
      const failure = yield* Effect.flip(ask(api));
      assert.equal(failure.call, call);
      assert.equal(failure.status, undefined);
      assert.match(failure.detail ?? "", /Error: socket hang up/u);
    }
  }),
);

it.effect("a token that could not be read names the call and why", () =>
  Effect.gen(function* () {
    const unread = yield* apiOver(refusedWith(400), () =>
      Promise.reject(new Error("the token endpoint was down")),
    );
    const failure = yield* Effect.flip(unread.writeFiles(SESSION, []));
    assert.equal(failure.call, SANDBOX_CALL.FS_WRITE);
    assert.equal(failure.detail, "Error: the token endpoint was down");

    const unnamed = yield* apiOver(refusedWith(400), () => Promise.resolve("not-a-token"));
    const unclaimed = yield* Effect.flip(unnamed.updateTags(NAME, {}));
    assert.equal(unclaimed.call, SANDBOX_CALL.TAGS);
    assert.equal(unclaimed.detail, "a token naming no project");
  }),
);

it.effect("a template list asks by name, the only sort Vercel takes a name prefix under", () =>
  Effect.gen(function* () {
    const api = yield* apiOver((url) => {
      const asked = new URL(url);
      assert.equal(asked.searchParams.get("namePrefix"), "luke-native-");
      assert.equal(asked.searchParams.get("sortBy"), "name");
      return Response.json({ sandboxes: [{ name: "luke-native-a" }] });
    });
    const listed = yield* api.listNamed("luke-native-");
    assert.deepEqual(
      listed.map((each) => each.name),
      ["luke-native-a"],
    );
  }),
);

it.effect("a start Vercel refused in passing is tried again until it starts", () =>
  Effect.gen(function* () {
    const api = yield* apiOver(answering(refusedWith(503), refusedWith(429), started));
    const starting = yield* Effect.forkChild(
      api.start(SESSION, { command: "bash", args: [], sudo: true }),
    );
    yield* TestClock.adjust(Duration.seconds(5));
    assert.equal(yield* Fiber.join(starting), COMMAND);
  }),
);

it.effect("a start Vercel refused outright answers at once, though a try after would start", () =>
  Effect.gen(function* () {
    const api = yield* apiOver(answering(refusedWith(400), started));
    const failure = yield* Effect.flip(
      api.start(SESSION, { command: "bash", args: [], sudo: true }),
    );
    assert.equal(failure.status, 400);
    assert.equal(failure.call, SANDBOX_CALL.CMD);
  }),
);

it.effect("a passing refusal that outlasts the tries answers its last status", () =>
  Effect.gen(function* () {
    const api = yield* apiOver(refusedWith(502));
    const writing = yield* Effect.forkChild(
      Effect.flip(api.writeStdin(SESSION, COMMAND, "line\n")),
    );
    yield* TestClock.adjust(Duration.seconds(10));
    const failure = yield* Fiber.join(writing);
    assert.ok(failure instanceof SandboxUnavailable);
    assert.equal(failure.call, SANDBOX_CALL.STDIN);
    assert.equal(failure.status, 502);
  }),
);
