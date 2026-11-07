/**
 * vercel-sandbox-api.test.ts -- what a call of Vercel Sandbox through `@vercel/sandbox` says of a failure, against a scripted fake of Vercel behind the SDK's `fetch`: the call, its status, and Vercel's error or the cause's, every token-shaped run redacted; and what this module decides beside the SDK: a get-or-create hands a sandbox it created to its setup, and meets its name taken with the sandbox holding it, a create refuses it with the 409, each list asks the query Vercel takes, and a sandbox or a snapshot already gone reads as gone.
 */

import assert from "node:assert/strict";
import { it } from "@effect/vitest";
import { Effect } from "effect";
import { runnerSandboxApi } from "../testing/runner-sandbox-fake.js";
import {
  fixtureToken,
  sandboxDeleted,
  sandboxesListed,
  sandboxFetchOver,
  sandboxFound,
} from "../testing/vercel-sandbox-fake.js";
import {
  COMMAND_GONE,
  SANDBOX_CALL,
  type SandboxCall,
  type SandboxUnavailable,
  snapshotGone,
  type VercelSandboxApi,
  vercelSandboxApi,
} from "./vercel-sandbox-api.js";

const SESSION = "sbs_fixture";
const NAME = "luke-native-fixture";
const REFUSAL = { code: "bad_request", message: "Invalid request: the fixture's refusal" } as const;
const SECRET_ENV = "fixture-secret-env-value";
const CREATED_AT = Date.UTC(2026, 10, 5);

/** A sandbox as Vercel's list names it, up in the session it runs. */
const RUNNING_SANDBOX = {
  name: NAME,
  status: "running",
  currentSessionId: SESSION,
  createdAt: CREATED_AT,
} as const;

/** A create of the fixture's sandbox, with a secret in its environment. */
const CREATE_ASK = {
  name: NAME,
  image: "agent-image:fixture",
  tags: {},
  timeoutMs: 60_000,
  vcpus: 2,
  keepLastSnapshots: { count: 1, expiration: 0, deleteEvicted: true },
  env: { SECRET: SECRET_ENV },
} as const;

/** Each call made through the SDK's statics, as a caller asks it. */
const CALLS: readonly {
  readonly call: SandboxCall;
  readonly ask: (api: VercelSandboxApi) => Effect.Effect<unknown, SandboxUnavailable>;
}[] = [
  { call: SANDBOX_CALL.CREATE, ask: (api) => api.create(CREATE_ASK) },
  { call: SANDBOX_CALL.TAGS, ask: (api) => api.updateTags(NAME, { sessionId: "s" }) },
  { call: SANDBOX_CALL.GET, ask: (api) => api.getNamed(NAME) },
  { call: SANDBOX_CALL.LIST, ask: (api) => api.listTagged("session_fixture") },
];

type Responder = (url: string, init: RequestInit) => Response | Promise<Response>;

/** The API under the fixture's token, the SDK sending through the responder given. */
function apiOver(
  respond: Responder,
  readToken: () => Promise<string> = () => Promise.resolve(fixtureToken()),
) {
  return vercelSandboxApi(readToken).pipe(Effect.provide(sandboxFetchOver(respond)));
}

/** A page of the sandboxes named, as Vercel's list answers it. */
const listed = (...names: readonly string[]) =>
  Response.json(sandboxesListed(names.map((name) => ({ ...RUNNING_SANDBOX, name }))));

const refusedWith = (status: number) => () => Response.json({ error: REFUSAL }, { status });

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
        { status: 400 },
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
    // Note that the cause is an abort, because the SDK tries any other failure to connect again on a real timer.
    const throwing = yield* apiOver(() => {
      throw Object.assign(new Error(echoed), { name: "AbortError" });
    });
    for (const api of [refusing, throwing]) {
      const failure = yield* Effect.flip(api.create(CREATE_ASK));
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
    const failure = yield* Effect.flip(api.getNamed(NAME));
    assert.equal(failure.code, "unsupported_media_type");
    assert.equal(failure.detail, "unsupported_media_type: Unsupported Media Type");
  }),
);

it.effect("a token that could not be read names the call and why", () =>
  Effect.gen(function* () {
    const unread = yield* apiOver(refusedWith(400), () =>
      Promise.reject(new Error("the token endpoint was down")),
    );
    const failure = yield* Effect.flip(unread.listTagged("session_fixture"));
    assert.equal(failure.call, SANDBOX_CALL.LIST);
    assert.equal(failure.detail, "Error: the token endpoint was down");

    const unnamed = yield* apiOver(refusedWith(400), () => Promise.resolve("not-a-token"));
    const unclaimed = yield* Effect.flip(unnamed.updateTags(NAME, {}));
    assert.equal(unclaimed.call, SANDBOX_CALL.TAGS);
    assert.equal(unclaimed.detail, "a token naming no project");
  }),
);

it.effect(
  "a get-or-create resumes the sandbox standing, hands one it created to onCreate before it answers, and meets its name taken on its create with the sandbox holding it, handed to onCreate too; a create refuses that name with Vercel's 409",
  () =>
    Effect.gen(function* () {
      const gets: (string | null)[] = [];
      let standing = true;
      let taken = false;
      const api = yield* apiOver((url, init) => {
        if (init.method === "POST") {
          if (taken) {
            standing = true;
            return Response.json(
              { error: { code: "sandbox_already_exists", message: "the name is taken" } },
              { status: 409 },
            );
          }
          return Response.json(sandboxFound(RUNNING_SANDBOX));
        }
        gets.push(new URL(url).searchParams.get("resume"));
        return standing ? Response.json(sandboxFound(RUNNING_SANDBOX)) : refusedWith(404)();
      });
      const setUp: string[] = [];
      const onCreate = async (created: { readonly currentSessionId: string }) => {
        setUp.push(created.currentSessionId);
      };

      const found = yield* api.getOrCreate(CREATE_ASK, onCreate);
      const setUpOnFound = setUp.length;
      standing = false;
      const created = yield* api.getOrCreate(CREATE_ASK, onCreate);
      taken = true;
      const joined = yield* api.getOrCreate(CREATE_ASK, onCreate);
      const refused = yield* Effect.flip(api.create(CREATE_ASK));

      assert.deepEqual(
        [found, created, joined].map((each) => each.currentSessionId),
        [SESSION, SESSION, SESSION],
      );
      assert.equal(setUpOnFound, 0);
      assert.deepEqual(setUp, [SESSION, SESSION]);
      assert.deepEqual(gets, ["true", "true", "true", "true"]);
      assert.equal(refused.call, SANDBOX_CALL.CREATE);
      assert.equal(refused.status, 409);
    }),
);

it.effect(
  "the list of running sandboxes asks the query Vercel takes: running ones alone, by creation, in the order asked",
  () =>
    Effect.gen(function* () {
      const queries: URLSearchParams[] = [];
      const api = yield* apiOver((url) => {
        queries.push(new URL(url).searchParams);
        return listed("luke-native-a");
      });

      const running = yield* api.listRunning(undefined, "desc");

      const [runningQuery] = queries;
      assert.equal(runningQuery?.get("status"), "running");
      assert.equal(runningQuery?.get("sortBy"), "createdAt");
      assert.equal(runningQuery?.get("sortOrder"), "desc");
      assert.deepEqual(
        running.sandboxes.map((each) => each.name),
        ["luke-native-a"],
      );
    }),
);

it.effect("a sandbox Vercel no longer holds is none", () =>
  Effect.gen(function* () {
    const api = yield* apiOver(refusedWith(404));

    assert.equal(yield* api.getNamed(NAME), undefined);
  }),
);

it.effect(
  "a create Vercel refused for its snapshot gone reads as gone, and the same status for a stopped sandbox or with no code does not",
  () =>
    Effect.gen(function* () {
      let error: object = { code: "snapshot_not_found", message: "the snapshot is gone" };
      const api = yield* apiOver(() => Response.json({ error }, { status: 410 }));
      const refusal = () => Effect.flip(api.create(CREATE_ASK));

      const lost = yield* refusal();
      error = { code: "sandbox_stopped", message: "the sandbox is stopped" };
      const stopped = yield* refusal();
      error = { message: "gone" };
      const unnamed = yield* refusal();

      assert.equal(snapshotGone(lost), true);
      assert.equal(snapshotGone(stopped), false);
      assert.equal(snapshotGone(unnamed), false);
    }),
);

/** A stopped sandbox as Vercel's list names it. */
const STOPPED_SANDBOX = { ...RUNNING_SANDBOX, status: "stopped" } as const;

/** Vercel's answer to a lookup and to a delete, as `@vercel/sandbox` reads them. */
const sandboxAnswer = (method: string) =>
  Response.json(
    method === "DELETE" ? sandboxDeleted(STOPPED_SANDBOX) : sandboxFound(STOPPED_SANDBOX),
  );

it.effect(
  "a delete wakes no stopped sandbox, takes its orphan snapshots, counts one gone as deleted, and names Vercel's refusal",
  () =>
    Effect.gen(function* () {
      const asked: { readonly method: string; readonly url: URL }[] = [];
      let answer: (method: string) => Response = sandboxAnswer;
      const api = yield* apiOver((url, init) => {
        const method = init.method ?? "GET";
        asked.push({ method, url: new URL(url) });
        return answer(method);
      });

      yield* api.deleteSandbox(NAME);
      const [lookup, deletion] = asked;
      assert.equal(lookup?.url.searchParams.get("resume"), "false");
      assert.equal(deletion?.method, "DELETE");
      assert.equal(deletion?.url.searchParams.get("deleteOrphanSnapshots"), "true");

      answer = () => refusedWith(404)();
      yield* api.deleteSandbox(NAME);

      answer = () => refusedWith(400)();
      const failure = yield* Effect.flip(api.deleteSandbox(NAME));
      assert.equal(failure.call, SANDBOX_CALL.DELETE);
      assert.equal(failure.status, 400);
      assert.equal(failure.detail, `${REFUSAL.code}: ${REFUSAL.message}`);
      assert.equal(failure.message.includes(fixtureToken()), false);
    }),
);

/** A sandbox opened in the runner's fake, and its session held, with a detached command started in it. */
const commandStarted = Effect.gen(function* () {
  const fake = runnerSandboxApi();
  const api = yield* vercelSandboxApi(async () => fixtureToken()).pipe(Effect.provide(fake.layer));
  const opened = yield* api.create({ ...CREATE_ASK, env: {} });
  const ref = { name: opened.name, sessionId: opened.currentSessionId };
  const session = yield* api.session(ref);
  const commandId = yield* session.start({ command: "node", args: ["runner.js"], sudo: false });
  const command = fake.commands.find((each) => each.id === commandId);
  assert.ok(command !== undefined);
  return { fake, api, ref, session, command };
});

it.effect(
  "a session its sandbox no longer runs answers as one Vercel no longer holds: a stop counts as stopped, a command reads as gone, and anything else is not found",
  () =>
    Effect.gen(function* () {
      const { fake, api, ref, command } = yield* commandStarted;
      const sandbox = fake.sandboxes[0];
      assert.ok(sandbox !== undefined);
      sandbox.status = "stopped";
      yield* api.resume(ref.name);

      const ended = yield* api.session(ref);

      yield* ended.stop();
      assert.equal(yield* ended.commandExit(command.id), COMMAND_GONE);
      yield* ended.kill(command.id);
      const ran = yield* Effect.flip(ended.run({ command: "true", args: [] }));
      assert.equal(ran.status, 404);
      assert.equal(sandbox.status, "running");
    }),
);

it.effect(
  "a command's exit reads as Vercel answers a read that waits for it: none while it runs, its code once it exited, and gone once Vercel no longer knows it",
  () =>
    Effect.gen(function* () {
      const { session, command } = yield* commandStarted;

      const running = yield* session.commandExit(command.id);
      command.exitCode = 0;
      const exited = yield* session.commandExit(command.id);

      assert.equal(running, null);
      assert.equal(exited, 0);
      assert.equal(yield* session.commandExit("cmd_unknown"), COMMAND_GONE);
    }),
);

it.effect(
  "a command that died is said by the tail of its stderr, every secret it was handed and every token-shaped run redacted, and one that printed nothing by none",
  () =>
    Effect.gen(function* () {
      const { session, command } = yield* commandStarted;
      command.exitCode = 1;
      command.stderr = `agent-runner: RunnerFailed: was sk-ant-oat01-abcdefghijklmnopqrstuvwxyz0123\nbearer was a/b+c\n`;
      const silent = yield* commandStarted;
      silent.command.exitCode = 1;

      assert.equal(
        yield* session.commandStderrTail(command.id, ["a/b+c"]),
        "agent-runner: RunnerFailed: was [redacted] bearer was [redacted]",
      );
      assert.equal(yield* silent.session.commandStderrTail(silent.command.id), undefined);
    }),
);
