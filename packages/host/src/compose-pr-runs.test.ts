import assert from "node:assert/strict";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { NodeChildProcessSpawner, NodeFileSystem, NodePath } from "@effect/platform-node";
import { it } from "@effect/vitest";
import { ACCOUNT_STATUS } from "@luke/credentials";
import type { RunSnapshotOutcome } from "@luke/features";
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
import { Effect, Fiber, Layer, Queue, Redacted, Result } from "effect";
import { Base64 } from "effect/encoding";
import { TestClock } from "effect/testing";
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
const AGENT = "8c1a6a4f-3d2e-4d8b-8b66-6f4c7a2e3b21";
const PULL_REQUEST = {
  workspaceId: "ws_fixture",
  repository: "octocat/relay",
  agentId: AGENT,
} as const;
const TOKEN = "ghs_fixture_pull_request_token";
const PORT = 43_210;

const readState = readEither(prRunStateEventSchema);
const readOutput = readEither(prRunOutputEventSchema);

interface Heard {
  readonly kind: GatewayEventKind;
  readonly payload: WireValue;
}

/**
 * The composer over a fresh origin, a state root, and a service that answers
 * the agent's work as a snapshot: the origin's `main` is where the agent's
 * work starts, and its `work` branch, where the test's commits land, is the
 * agent's working tree. A service told so answers waking first, or that the
 * work is too large.
 */
function subject(options: { waking?: number; tooLarge?: boolean } = {}) {
  return Effect.gen(function* () {
    const scratch = yield* temporaryDirectoryScoped("luke-pr-runs-");
    const origin = pullRequestOrigin(path.join(scratch, "origin"));
    const base = origin.commit({ "README.md": "base\n", ".gitignore": "node_modules/\n" });
    origin.branch("work");
    const first = origin.commit({ "README.md": "first\n" });
    const heard = yield* Queue.unbounded<Heard>();
    const asked: string[] = [];
    let waking = options.waking ?? 0;
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
        take: (agentId) =>
          Effect.sync((): RunSnapshotOutcome => {
            asked.push(agentId);
            if (waking > 0) {
              waking -= 1;
              return { waking: true };
            }
            if (options.tooLarge === true) return { tooLarge: 9_000_000 };
            const head = fixtureGit(origin.folder, ["rev-parse", "HEAD"]);
            return {
              snapshot: {
                repository: "octocat/relay",
                base,
                branch: "luke/fix-relay",
                patch: gzipSync(origin.diff(base, head)).toString("base64"),
                token: Redacted.make(TOKEN),
              },
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
      `agent-${AGENT}`,
    );
    return {
      scratch,
      origin,
      base,
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
  "a run takes the agent's working tree, runs the command from the checkout, and says it succeeded",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { setCommand, start, until, printed, base, checkout, asked, revoked } =
          yield* subject();
        yield* setCommand("git rev-parse HEAD^; cat README.md; pwd");

        assert.deepEqual(yield* start(), { done: true });
        const running = yield* until([PR_RUN_PHASE.RUNNING, PR_RUN_PHASE.FAILURE]);
        const ended = yield* until([PR_RUN_PHASE.SUCCESS, PR_RUN_PHASE.FAILURE]);

        assert.equal(running.phase, PR_RUN_PHASE.RUNNING);
        assert.equal(running.sha?.length, 40);
        assert.deepEqual(
          { phase: ended.phase, exitCode: ended.exitCode },
          { phase: PR_RUN_PHASE.SUCCESS, exitCode: 0 },
        );
        // The checkout stands on the agent's work, its starting commit beneath it.
        assert.match(printed(), new RegExp(base, "u"));
        assert.match(printed(), /first/u);
        assert.match(printed(), new RegExp(checkout, "u"));
        assert.deepEqual(asked, [AGENT]);
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

it.effect("a sandbox waking is asked again until it answers, and the run goes on", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { setCommand, start, until, asked } = yield* subject({ waking: 2 });
      yield* setCommand("true");

      yield* start();
      const running = yield* Effect.forkChild(until([PR_RUN_PHASE.RUNNING, PR_RUN_PHASE.FAILURE]));
      // Note that the clock is moved in the run's own steps, since each ask waits two seconds before the next.
      while (asked.length < 3) yield* TestClock.adjust("2 seconds");
      const state = yield* Fiber.join(running);

      assert.equal(state.phase, PR_RUN_PHASE.RUNNING);
      assert.deepEqual(asked, [AGENT, AGENT, AGENT]);
    }),
  ).pipe(Effect.provide(machine)),
);

it.effect("work too large to copy fails without running anything", () =>
  Effect.scoped(
    Effect.gen(function* () {
      const { setCommand, start, until, revoked, checkout } = yield* subject({ tooLarge: true });
      yield* setCommand("touch ran");

      yield* start();
      const ended = yield* until([PR_RUN_PHASE.RUNNING, PR_RUN_PHASE.FAILURE]);

      assert.equal(ended.phase, PR_RUN_PHASE.FAILURE);
      assert.match(ended.message ?? "", /too large/u);
      assert.deepEqual(revoked, []);
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
  "a second Run ends the first before the checkout moves to the newest work, and a deletion waits for no run",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { setCommand, start, until, untilPrinted, printed, call, origin, checkout } =
          yield* subject();
        yield* setCommand("cat README.md; echo $$ >> ../agent.pids; echo ready; sleep 60");

        yield* start("conn-1");
        yield* untilPrinted("ready", "conn-1");
        const refused = yield* call(GATEWAY_METHOD.PR_RUNS_DELETE, { ...PULL_REQUEST });
        origin.commit({ "README.md": "second\n" });
        yield* start("conn-2");
        const running = yield* until([PR_RUN_PHASE.RUNNING], "conn-2");
        yield* untilPrinted("ready", "conn-2");

        assert.deepEqual(refused, { refused: "Stop the run before deleting its local checkout." });
        assert.notEqual(running.sha, undefined);
        assert.match(printed("conn-1"), /first/u);
        assert.match(printed("conn-2"), /second/u);
        const [firstRun = 0, secondRun = 0] = readFileSync(
          `${path.dirname(checkout)}/agent.pids`,
          "utf8",
        )
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
  "setup runs before the run command on an agent's first Run, and again only when a lockfile changes; the run is handed its port",
  () =>
    Effect.scoped(
      Effect.gen(function* () {
        const { setCommand, start, until, printed, origin, checkout } = yield* subject();
        yield* setCommand('echo "run on $LUKE_PORT"', "echo set-up >> ../setups");

        yield* start();
        const first = yield* until([PR_RUN_PHASE.SUCCESS, PR_RUN_PHASE.FAILURE]);
        yield* start();
        yield* until([PR_RUN_PHASE.SUCCESS, PR_RUN_PHASE.FAILURE]);
        origin.commit({ "pnpm-lock.yaml": "lock: 2\n" });
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
