import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { ACCOUNT_STATUS } from "@luke/credentials";
import type { PrFetchOutcome } from "@luke/features";
import type { PrFetchRequest } from "@luke/features/pr-fetch-wire";
import {
  PR_RUN_FLOW,
  PR_RUN_PHASE,
  type PrRunPhase,
  prRunOutputEventSchema,
  prRunStateEventSchema,
} from "@luke/features/pr-run-view";
import type { RepositoryRun } from "@luke/features/repository-run-wire";
import {
  GATEWAY_CLIENT_ROLE,
  GATEWAY_EVENT,
  GATEWAY_METHOD,
  type GatewayEventKind,
  type GatewayMethod,
} from "@luke/gateway";
import { temporaryDirectoryScoped } from "@luke/runtime/testing";
import { unparsedWire, type WireRecord, type WireValue } from "@luke/wire";
import { readEither } from "@luke/wire/effect";
import { Effect, Layer, Queue, Redacted, Result } from "effect";
import { Base64 } from "effect/encoding";
import { composePrRuns } from "./compose-pr-runs.js";
import { fixtureGit, fixtureGitTool, pullRequestOrigin } from "./testing/pull-request-origin.js";

/**
 * A pull request run on this Mac, over real Git, a real shell, a repository
 * on disk standing in for GitHub, and a scripted service: a run fetches the
 * head the service read into Luke's own checkout and runs the repository's
 * command there, says how it ended, hands what it printed to the one
 * connection that asked, and is stopped by Stop, a closed tab, and a
 * sign-out with everything it started. Synthetic accounts, tokens, and
 * repositories throughout.
 */

const machine = NodeChildProcessSpawner.layer.pipe(
  Layer.provideMerge(Layer.mergeAll(NodeFileSystem.layer, NodePath.layer)),
);

const context = { client: { clientId: "desktop", role: GATEWAY_CLIENT_ROLE.OPERATOR } };
const ACCOUNT = "developer@luke.test";
const PULL_REQUEST = { workspaceId: "ws_fixture", repository: "octocat/relay", number: 7 } as const;
const TOKEN = "ghs_fixture_pull_request_token";
const PORT = 43_210;

const readState = readEither(prRunStateEventSchema);
const readOutput = readEither(prRunOutputEventSchema);

interface Heard {
  readonly kind: GatewayEventKind;
  readonly payload: WireValue;
}

/** The composer over a fresh origin, a state root, and a service that reads the origin's pull request ref, or the heads it is told to answer. */
function subject(options: { heads?: () => string | undefined } = {}) {
  return Effect.gen(function* () {
    const scratch = yield* temporaryDirectoryScoped("luke-pr-runs-");
    const origin = pullRequestOrigin(path.join(scratch, "origin"));
    const first = origin.commit({ "README.md": "first\n", ".gitignore": "node_modules/\n" });
    origin.pointPullRequest(PULL_REQUEST.number, first);
    const heard = yield* Queue.unbounded<Heard>();
    const asked: PrFetchRequest[] = [];
    const revoked: string[] = [];
    // The workspace's shared commands, as the service keeps them.
    let runs: RepositoryRun[] = [];
    let signedIn = true;
    const composer = yield* composePrRuns({
      kernel: {
        stateRoot: path.join(scratch, "state"),
        runMode: { sendsNetwork: true },
        emit: (kind, payload) => void Queue.offerUnsafe(heard, { kind, payload }),
      },
      account: {
        capabilitiesActive: () => signedIn,
        snapshot: () =>
          signedIn
            ? { status: ACCOUNT_STATUS.SIGNED_IN, email: ACCOUNT, provider: "github" }
            : { status: ACCOUNT_STATUS.SIGNED_OUT },
      },
      runs: {
        list: () => Effect.sync(() => runs),
        set: (request) =>
          Effect.sync(() => {
            const { workspaceId: _workspace, ...run } = request;
            runs = [
              ...runs.filter((each) => each.repository !== run.repository.toLowerCase()),
              {
                ...run,
                repository: run.repository.toLowerCase(),
              },
            ];
            return runs;
          }),
      },
      freePort: Effect.succeed(PORT),
      client: {
        fetch: (request) =>
          Effect.sync((): PrFetchOutcome => {
            asked.push(request);
            const head =
              options.heads?.() ??
              fixtureGit(origin.folder, ["rev-parse", `refs/pull/${request.prNumber}/head`]);
            return {
              headSha: head,
              headRef: "fix-relay",
              token: Redacted.make(TOKEN),
              expiresAt: "2026-10-01T01:00:00Z",
            };
          }),
      },
      revoke: (token) => Effect.sync(() => void revoked.push(Redacted.value(token))),
      sourceUrl: () => origin.folder,
      git: fixtureGitTool(scratch),
      shell: { path: "/bin/sh" },
      helper: { path: process.execPath, environment: {} },
    });
    const call = (method: GatewayMethod, params: WireRecord = {}) => {
      const handler = composer.methods[method];
      assert.ok(handler, `no handler for ${method}`);
      return handler(params, context);
    };
    const all: Heard[] = [];
    /** Every event heard until a state of one of the phases, which is answered. */
    const until = (phases: readonly PrRunPhase[], connectionId = "conn-1") =>
      Effect.gen(function* () {
        for (;;) {
          const event = yield* Queue.take(heard);
          all.push(event);
          if (event.kind !== GATEWAY_EVENT.PR_RUN_STATE) continue;
          const state = Result.getOrThrow(readState(unparsedWire(event.payload)));
          if (state.connectionId === connectionId && phases.includes(state.phase)) return state;
        }
      });
    /** Every event heard until the connection has been handed the text. */
    const untilPrinted = (text: string, connectionId = "conn-1") =>
      Effect.gen(function* () {
        while (!printed(connectionId).includes(text)) all.push(yield* Queue.take(heard));
      });
    /** What the run printed to the connection, as text. */
    const printed = (connectionId = "conn-1") =>
      all
        .flatMap((event) => {
          if (event.kind !== GATEWAY_EVENT.PR_RUN_OUTPUT) return [];
          const output = Result.getOrThrow(readOutput(unparsedWire(event.payload)));
          if (output.connectionId !== connectionId) return [];
          return [Buffer.from(Result.getOrThrow(Base64.decode(output.data))).toString("utf8")];
        })
        .join("");
    const setCommand = (runCommand: string | null, setupCommand: string | null = null) =>
      call(GATEWAY_METHOD.PR_RUNS_SET_COMMAND, {
        workspaceId: PULL_REQUEST.workspaceId,
        repository: PULL_REQUEST.repository,
        setupCommand,
        runCommand,
      });
    const start = (connectionId = "conn-1") =>
      call(GATEWAY_METHOD.PR_RUNS_START, { connectionId, ...PULL_REQUEST });
    const checkout = path.join(
      scratch,
      "state",
      "pr-runs",
      ACCOUNT,
      "ws_fixture",
      "octocat",
      "relay",
      "pr-7",
    );
    return {
      scratch,
      origin,
      first,
      composer,
      call,
      until,
      untilPrinted,
      printed,
      setCommand,
      start,
      checkout,
      asked,
      revoked,
      heard: () => all,
      signOut: () => {
        signedIn = false;
      },
    };
  });
}

/** Whether a process of that id still runs. */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

it.effect(
  "a repository with no run command is told where to set one, and nothing is fetched or run",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { start, asked, checkout } = yield* subject();

        const answered = yield* start();

        assert.deepEqual(answered, {
          refused:
            "octocat/relay has no run command yet. Fill it in under Settings › Workspace › Repositories, then run it again.",
        });
        assert.deepEqual(asked, []);
        assert.equal(existsSync(checkout), false);
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect(
  "a run fetches the head the service read, runs the command from the checkout, and says it succeeded",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { setCommand, start, until, printed, first, checkout, asked, revoked } =
          yield* subject();
        yield* setCommand("git rev-parse HEAD; pwd");

        assert.deepEqual(yield* start(), { done: true });
        const running = yield* until([PR_RUN_PHASE.RUNNING, PR_RUN_PHASE.FAILURE]);
        const ended = yield* until([PR_RUN_PHASE.SUCCESS, PR_RUN_PHASE.FAILURE]);

        assert.equal(running.phase, PR_RUN_PHASE.RUNNING);
        assert.equal(running.sha, first);
        assert.deepEqual(
          { phase: ended.phase, exitCode: ended.exitCode },
          { phase: PR_RUN_PHASE.SUCCESS, exitCode: 0 },
        );
        assert.match(printed(), new RegExp(first, "u"));
        assert.match(printed(), new RegExp(checkout, "u"));
        assert.deepEqual(asked, [
          { workspaceId: "ws_fixture", repository: "octocat/relay", prNumber: 7 },
        ]);
        // The token was given back before the command ran, and is in no event.
        assert.deepEqual(revoked, [TOKEN]);
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect("a command that fails says so with its status", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { setCommand, start, until } = yield* subject();
      yield* setCommand("exit 4");

      yield* start();
      const ended = yield* until([PR_RUN_PHASE.SUCCESS, PR_RUN_PHASE.FAILURE]);

      assert.deepEqual(
        { phase: ended.phase, exitCode: ended.exitCode },
        { phase: PR_RUN_PHASE.FAILURE, exitCode: 4 },
      );
    }),
  ).pipe(Effect.provide(machine)),
);

it.effect(
  "a head that moved between the service's read and the fetch is asked for again, never run",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const stale = "0".repeat(40);
        const answers = [stale];
        const { setCommand, start, until, asked, first } = yield* subject({
          heads: () => answers.shift(),
        });
        yield* setCommand("true");

        yield* start();
        const running = yield* until([PR_RUN_PHASE.RUNNING, PR_RUN_PHASE.FAILURE]);

        assert.equal(running.phase, PR_RUN_PHASE.RUNNING);
        assert.equal(running.sha, first);
        assert.equal(asked.length, 2);
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect("a head that never matches what was fetched fails without running anything", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { setCommand, start, until, asked, revoked, checkout } = yield* subject({
        heads: () => "0".repeat(40),
      });
      yield* setCommand("touch ran");

      yield* start();
      const ended = yield* until([PR_RUN_PHASE.RUNNING, PR_RUN_PHASE.FAILURE]);

      assert.equal(ended.phase, PR_RUN_PHASE.FAILURE);
      assert.match(ended.message ?? "", /kept moving/u);
      assert.equal(asked.length, 3);
      assert.equal(revoked.length, 3);
      assert.equal(existsSync(path.join(checkout, "ran")), false);
    }),
  ).pipe(Effect.provide(machine)),
);

it.effect(
  "Stop, a closed tab, and a sign-out each end the run and what it started, and keep the checkout",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { setCommand, start, untilPrinted, call, composer, checkout, signOut } =
          yield* subject();
        yield* setCommand("sleep 60 & echo $! > child.pid; echo $$ > parent.pid; echo ready; wait");
        const pids = () =>
          ["parent.pid", "child.pid"].map((file) =>
            Number(readFileSync(path.join(checkout, file), "utf8")),
          );
        const stops = [
          {
            connectionId: "conn-stop",
            stop: call(GATEWAY_METHOD.PR_RUNS_STOP, { ...PULL_REQUEST }),
          },
          {
            connectionId: "conn-close",
            stop: call(GATEWAY_METHOD.PR_RUNS_RELEASE, { connectionId: "conn-close" }),
          },
          {
            connectionId: "conn-signout",
            stop: Effect.andThen(Effect.sync(signOut), composer.reset),
          },
        ];
        for (const { connectionId, stop } of stops) {
          yield* start(connectionId);
          yield* untilPrinted("ready", connectionId);
          const [parent = 0, child = 0] = pids();
          assert.ok(alive(parent) && alive(child), connectionId);

          yield* stop;

          assert.equal(alive(parent), false, connectionId);
          assert.equal(alive(child), false, connectionId);
          assert.equal(existsSync(path.join(checkout, "README.md")), true, connectionId);
          for (const file of ["parent.pid", "child.pid"])
            rmSync(path.join(checkout, file), { force: true });
        }
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect(
  "a second Run ends the first before the checkout moves to the newest head, and a deletion waits for no run",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { setCommand, start, until, untilPrinted, printed, call, origin, checkout } =
          yield* subject();
        yield* setCommand("cat README.md; echo $$ >> ../pr-7.pids; echo ready; sleep 60");

        yield* start("conn-1");
        yield* untilPrinted("ready", "conn-1");
        const refused = yield* call(GATEWAY_METHOD.PR_RUNS_DELETE, { ...PULL_REQUEST });
        const second = origin.commit({ "README.md": "second\n" });
        origin.pointPullRequest(PULL_REQUEST.number, second);
        yield* start("conn-2");
        const running = yield* until([PR_RUN_PHASE.RUNNING], "conn-2");
        yield* untilPrinted("ready", "conn-2");

        assert.deepEqual(refused, { refused: "Stop the run before deleting its local checkout." });
        assert.equal(running.sha, second);
        assert.match(printed("conn-1"), /first/u);
        assert.match(printed("conn-2"), /second/u);
        const [firstRun = 0, secondRun = 0] = readFileSync(`${checkout}.pids`, "utf8")
          .trim()
          .split("\n")
          .map(Number);
        assert.equal(alive(firstRun), false);
        assert.equal(alive(secondRun), true);

        yield* call(GATEWAY_METHOD.PR_RUNS_STOP, { ...PULL_REQUEST });
        assert.deepEqual(yield* call(GATEWAY_METHOD.PR_RUNS_DELETE, { ...PULL_REQUEST }), {
          done: true,
        });
        assert.equal(existsSync(checkout), false);
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect("output past what the tab has drawn waits for its acks, and arrives whole", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { setCommand, start, until, call, heard } = yield* subject();
      const total = PR_RUN_FLOW.PAUSE_ABOVE_BYTES * 3;
      yield* setCommand(`head -c ${total} /dev/zero`);
      const emitted = () =>
        heard()
          .flatMap((event) =>
            event.kind === GATEWAY_EVENT.PR_RUN_OUTPUT
              ? [
                  Result.getOrThrow(
                    Base64.decode(Result.getOrThrow(readOutput(unparsedWire(event.payload))).data),
                  ).length,
                ]
              : [],
          )
          .reduce((sum, bytes) => sum + bytes, 0);

      yield* start();
      yield* until([PR_RUN_PHASE.RUNNING]);
      let acked = 0;
      const ended = yield* Effect.gen(function* () {
        for (;;) {
          yield* call(GATEWAY_METHOD.PR_RUNS_ACK, {
            connectionId: "conn-1",
            bytes: emitted() - acked,
          });
          acked = emitted();
          const state = yield* Effect.race(
            until([PR_RUN_PHASE.SUCCESS, PR_RUN_PHASE.FAILURE]),
            Effect.as(Effect.yieldNow, undefined),
          );
          if (state !== undefined) return state;
        }
      });

      assert.equal(ended.phase, PR_RUN_PHASE.SUCCESS);
      assert.equal(emitted(), total);
    }),
  ).pipe(Effect.provide(machine)),
);

it.effect(
  "a tab drawn again is told where the run stands and handed what it prints next; one set aside is handed nothing",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { setCommand, start, until, untilPrinted, printed, call, checkout } =
          yield* subject();
        yield* setCommand("echo before; while [ ! -f go ]; do sleep 0.05; done; echo after");

        yield* start("conn-1");
        yield* untilPrinted("before", "conn-1");
        yield* call(GATEWAY_METHOD.PR_RUNS_DETACH, { connectionId: "conn-1" });
        yield* call(GATEWAY_METHOD.PR_RUNS_ATTACH, { connectionId: "conn-2", ...PULL_REQUEST });
        const told = yield* until([PR_RUN_PHASE.RUNNING], "conn-2");
        writeFileSync(path.join(checkout, "go"), "");
        const ended = yield* until([PR_RUN_PHASE.SUCCESS, PR_RUN_PHASE.FAILURE], "conn-2");

        assert.equal(told.phase, PR_RUN_PHASE.RUNNING);
        assert.equal(ended.phase, PR_RUN_PHASE.SUCCESS);
        assert.match(printed("conn-2"), /after/u);
        assert.doesNotMatch(printed("conn-1"), /after/u);
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect(
  "setup runs before the run command on a pull request's first Run, and again only when a lockfile changes; the run is handed its port",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { setCommand, start, until, printed, origin, checkout } = yield* subject();
        yield* setCommand('echo "run on $LUKE_PORT"', "echo set-up >> ../setups");

        yield* start();
        const first = yield* until([PR_RUN_PHASE.SUCCESS, PR_RUN_PHASE.FAILURE]);
        yield* start();
        yield* until([PR_RUN_PHASE.SUCCESS, PR_RUN_PHASE.FAILURE]);
        origin.pointPullRequest(
          PULL_REQUEST.number,
          origin.commit({ "pnpm-lock.yaml": "lock: 2\n" }),
        );
        yield* start();
        yield* until([PR_RUN_PHASE.SUCCESS, PR_RUN_PHASE.FAILURE]);

        assert.equal(first.phase, PR_RUN_PHASE.SUCCESS);
        assert.match(printed(), new RegExp(`run on ${PORT}`, "u"));
        assert.equal(
          readFileSync(path.join(path.dirname(checkout), "setups"), "utf8"),
          "set-up\nset-up\n",
        );
      }),
    ).pipe(Effect.provide(machine)),
);

it.effect("a setup that fails ends the run before its command, and runs again next time", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { setCommand, start, until, checkout } = yield* subject();
      yield* setCommand("touch ran", "exit 2");

      yield* start();
      const ended = yield* until([PR_RUN_PHASE.SUCCESS, PR_RUN_PHASE.FAILURE]);
      yield* setCommand("touch ran", "true");
      yield* start();
      const again = yield* until([PR_RUN_PHASE.SUCCESS, PR_RUN_PHASE.FAILURE]);

      assert.equal(ended.phase, PR_RUN_PHASE.FAILURE);
      assert.match(ended.message ?? "", /Setup exited 2/u);
      assert.equal(again.phase, PR_RUN_PHASE.SUCCESS);
      assert.equal(existsSync(path.join(checkout, "ran")), true);
    }),
  ).pipe(Effect.provide(machine)),
);
