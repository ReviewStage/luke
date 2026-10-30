import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { temporaryDirectory } from "@luke/wire/testing";
import { Effect } from "effect";
import type { TestContext } from "vitest";
import { hostProcessTable } from "./host-processes.js";
import { ProcessTable } from "./processes.js";

/** The runner's own pid in the listings below, leading its own process group, as the host starts it. */
const RUNNER = 4100;

/** The harness the runner spawned. */
const HARNESS = 4101;

/** The host that started the runner. */
const HOST = 900;

/** One process of a listing: its id, parent, group, and command line. */
interface Row {
  readonly pid: number;
  readonly parent: number;
  readonly group: number;
  readonly command: string;
}

const row = (pid: number, parent: number, group: number, command: string): Row => ({
  pid,
  parent,
  group,
  command,
});

/** What a box runs beside the runner: init, the host, and another agent's runner with a server of its own, each in a group of its own. */
const BESIDE = [
  row(1, 0, 1, "/sbin/init"),
  row(HOST, 1, HOST, "/opt/luke-host/node/bin/node /opt/luke-host/lib/luke-host.mjs run"),
  row(5100, HOST, 5100, "/opt/luke-host/node/bin/node /opt/luke-host/lib/agent-runner.mjs"),
  row(5101, 5100, 5100, "/state/agent-tools/claude/0.3.304/claude"),
  row(5102, 5101, 5100, "node server.js"),
];

/** The runner, its harness, and the harness's command-sandbox bridge, none of them the agent's. */
const LAUNCH = [
  row(RUNNER, HOST, RUNNER, "/opt/luke-host/node/bin/node /opt/luke-host/lib/agent-runner.mjs"),
  row(HARNESS, RUNNER, RUNNER, "/state/agent-tools/claude/0.3.304/claude --output-format"),
  row(4102, HARNESS, RUNNER, "socat UNIX-LISTEN:/tmp/claude-http-3fa9.sock,fork TCP:localhost:5"),
];

/** Whether the table answers that a process of the agent's runs, over the sources given. */
const agentRuns = (sources: { readonly proc: string; readonly ps: string }) =>
  Effect.gen(function* () {
    const table = yield* ProcessTable;
    return yield* table.agentProcessRuns;
  }).pipe(Effect.provide(hostProcessTable(RUNNER, sources)));

/** A folder of the test's own, gone once it finishes. */
const folderOf = (ctx: TestContext) => Effect.promise(() => temporaryDirectory(ctx, "luke-ps-"));

/** A `ps` of the test's own, as a Mac lists its processes: a script printing the rows given as `ps -o pid=,ppid=,pgid=,command=` does, and exiting as told. */
const fakePs = (ctx: TestContext, rows: readonly Row[], exitCode = 0) =>
  Effect.gen(function* () {
    const directory = yield* folderOf(ctx);
    const listing = join(directory, "listing");
    const lines = rows.map(
      (each) =>
        `${String(each.pid).padStart(5)} ${String(each.parent).padStart(5)} ${String(each.group).padStart(5)} ${each.command}`,
    );
    writeFileSync(listing, `${lines.join("\n")}\n`);
    const ps = join(directory, "ps");
    writeFileSync(ps, `#!/bin/sh\ncat '${listing}'\nexit ${exitCode}\n`);
    chmodSync(ps, 0o755);
    return { proc: join(directory, "no-proc"), ps };
  });

/** A `/proc` of the test's own, as Linux lists its processes: each row's `stat`, its command's name in parentheses, and its `cmdline`. */
const fakeProc = (ctx: TestContext, rows: readonly Row[]) =>
  Effect.gen(function* () {
    const proc = join(yield* folderOf(ctx), "proc");
    mkdirSync(join(proc, "self"), { recursive: true });
    writeFileSync(join(proc, "self", "stat"), "");
    for (const each of rows) {
      const folder = join(proc, String(each.pid));
      mkdirSync(folder);
      // Note that the name holds a parenthesis and a space, as a process may name itself, which must not shift the fields after it.
      writeFileSync(
        join(folder, "stat"),
        `${each.pid} (a) b) S ${each.parent} ${each.group} ${each.group} 0 -1 4194560`,
      );
      writeFileSync(join(folder, "cmdline"), `${each.command.split(" ").join("\0")}\0`);
    }
    return { proc, ps: join(proc, "no-ps") };
  });

describe("hostProcessTable", () => {
  it.effect.each([
    {
      case: "only the runner, its harness, and the bridge, beside the host and another agent's server",
      rows: LAUNCH,
      runs: false,
    },
    {
      case: "a server the agent's command started",
      rows: [
        ...LAUNCH,
        row(4103, HARNESS, RUNNER, "/bin/bash -c npm run dev"),
        row(4104, 4103, RUNNER, "node server.js"),
      ],
      runs: true,
    },
    {
      case: "a server that left the runner's group but not its descent",
      rows: [...LAUNCH, row(4105, HARNESS, 4105, "node server.js")],
      runs: true,
    },
    {
      case: "a server that detached to init in the runner's group",
      rows: [...LAUNCH, row(4106, 1, RUNNER, "node server.js")],
      runs: true,
    },
    { case: "a listing with no runner in it", rows: [], runs: true },
  ])("answers $runs over ps for $case", ({ rows, runs }, ctx) =>
    Effect.gen(function* () {
      assert.strictEqual(yield* agentRuns(yield* fakePs(ctx, [...BESIDE, ...rows])), runs);
    }),
  );

  it.effect("reads a box's /proc where it has one", (ctx) =>
    Effect.gen(function* () {
      assert.isFalse(yield* agentRuns(yield* fakeProc(ctx, [...BESIDE, ...LAUNCH])));
      const server = row(4103, HARNESS, RUNNER, "node server.js");
      assert.isTrue(yield* agentRuns(yield* fakeProc(ctx, [...BESIDE, ...LAUNCH, server])));
    }),
  );

  it.effect("answers that one runs where ps fails, never releasing a wait on a guess", (ctx) =>
    Effect.gen(function* () {
      assert.isTrue(yield* agentRuns(yield* fakePs(ctx, [...BESIDE, ...LAUNCH], 1)));
    }),
  );
});
