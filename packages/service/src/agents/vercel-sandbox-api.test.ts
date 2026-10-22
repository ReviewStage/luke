/**
 * vercel-sandbox-api.test.ts -- what a failed call of Vercel Sandbox's REST API says of itself, against a scripted fake of it: the call, its status, and Vercel's error or the cause's; and a detached command's start and stdin tried again on a passing refusal alone; and a detached command's exit read as Vercel answers it, a plain read naming none until a read that waits has seen it.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { fakeHttpClientLayer } from "@luke/wire/testing";
import { Duration, Effect, Fiber } from "effect";
import { TestClock } from "effect/testing";
import { fixtureToken, runnerSandboxApi } from "../testing/runner-sandbox-fake.js";
import {
  COMMAND_GONE,
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
      Response.json(
        { error: { code: "x", message: `a\n${"word ".repeat(200)}` } },
        { status: 500 },
      ),
    );
    const failure = yield* Effect.flip(api.updateTags(NAME, {}));
    assert.ok(failure.detail !== undefined);
    assert.equal(failure.detail.length, 300);
    assert.equal(failure.detail.includes("\n"), false);
  }),
);

it.effect("a secret Vercel or a cause echoes back is redacted from the detail", () =>
  Effect.gen(function* () {
    const echoed = `env SECRET=${SECRET_ENV} under Bearer ${fixtureToken()}`;
    const refusing = yield* apiOver(() =>
      Response.json({ error: { code: "bad_request", message: echoed } }, { status: 400 }),
    );
    const throwing = yield* apiOver(() => {
      throw new Error(echoed);
    });
    for (const api of [refusing, throwing]) {
      const failure = yield* Effect.flip(
        api.start(SESSION, { command: "bash", args: [], sudo: true }),
      );
      assert.match(failure.detail ?? "", /env SECRET=\[redacted\] under Bearer \[redacted\]/u);
      assert.equal(failure.message.includes(SECRET_ENV), false);
      assert.equal(failure.message.includes(fixtureToken()), false);
    }
  }),
);

it.effect("a long error code of Vercel's own is kept whole", () =>
  Effect.gen(function* () {
    const api = yield* apiOver(() =>
      Response.json(
        { error: { code: "unsupported_media_type", message: "Unsupported Media Type" } },
        { status: 415 },
      ),
    );
    const failure = yield* Effect.flip(api.stopSession(SESSION));
    assert.equal(failure.detail, "unsupported_media_type: Unsupported Media Type");
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

/** The API over a fresh fake, and a detached command started in it. */
const commandStarted = Effect.gen(function* () {
  const fake = runnerSandboxApi();
  const api = yield* vercelSandboxApi(async () => fixtureToken()).pipe(Effect.provide(fake.layer));
  const commandId = yield* api.start(SESSION, {
    command: "node",
    args: ["runner.js"],
    sudo: false,
  });
  const command = fake.commands.find((each) => each.id === commandId);
  assert.ok(command !== undefined);
  return { fake, api, command };
});

it.effect("a command that exited reads as exited, though a plain read names no exit", () =>
  Effect.gen(function* () {
    const { fake, api, command } = yield* commandStarted;
    command.exitCode = 0;
    const plain = yield* Effect.promise(() =>
      fake
        .respond(
          `https://vercel.com/api/v2/sandboxes/sessions/${SESSION}/cmd/${command.id}?teamId=team_fixture`,
          { method: "GET" },
        )
        .then((response) => response.json()),
    );

    const exit = yield* api.commandExit(SESSION, command.id);

    assert.equal(plain.command.exitCode, null);
    assert.equal(exit, 0);
  }),
);

it.effect("a command whose read outwaits the wait still runs", () =>
  Effect.gen(function* () {
    const { fake, api, command } = yield* commandStarted;
    fake.waits.hold = true;

    const reading = yield* Effect.forkChild(api.commandExit(SESSION, command.id));
    yield* TestClock.adjust("2 seconds");

    assert.equal(yield* Fiber.join(reading), null);
  }),
);

it.effect("a command Vercel no longer knows is gone", () =>
  Effect.gen(function* () {
    const { api } = yield* commandStarted;

    assert.equal(yield* api.commandExit(SESSION, "cmd_unknown"), COMMAND_GONE);
  }),
);

it.effect("a command read Vercel refused is unavailable", () =>
  Effect.gen(function* () {
    const { fake, api, command } = yield* commandStarted;
    fake.failCommandReads.remaining = 1;

    const read = yield* Effect.flip(api.commandExit(SESSION, command.id));

    assert.equal(read.status, 503);
  }),
);

it.effect(
  "a command that died is said by the tail of its stderr, every secret it was handed and every token-shaped run redacted, and one that printed nothing by none",
  () =>
    Effect.gen(function* () {
      const { api, command } = yield* commandStarted;
      command.exitCode = 1;
      command.stderr =
        "agent-runner: RunnerFailed: LUKE_RUNNER_TOKEN is not set (was sk-ant-oat01-abcdefghijklmnopqrstuvwxyz0123)\n";

      command.stderr += "bearer was a/b+c\n";
      const tail = yield* api.commandStderrTail(SESSION, command.id, ["a/b+c"]);
      const silent = yield* commandStarted;
      silent.command.exitCode = 1;

      assert.equal(
        tail,
        "agent-runner: RunnerFailed: LUKE_RUNNER_TOKEN is not set (was [redacted]) bearer was [redacted]",
      );
      assert.equal(yield* silent.api.commandStderrTail(SESSION, silent.command.id), undefined);
    }),
);
