import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { temporaryDirectory } from "@repo/wire/testing";
import { Effect } from "effect";
import type { TestContext } from "vitest";
import { hostProcessTable } from "./host-processes.js";
import { ProcessTable } from "./processes.js";

const RUNNER = 4100;

const HARNESS = 4101;

const HOST = 900;

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

const BESIDE = [
  row(1, 0, 1, "/sbin/init"),
  row(HOST, 1, HOST, "/opt/vespin-host/node/bin/node /opt/vespin-host/lib/vespin-host.mjs run"),
  row(5100, HOST, 5100, "/opt/vespin-host/node/bin/node /opt/vespin-host/lib/agent-runner.mjs"),
  row(5101, 5100, 5100, "/state/agent-tools/claude/0.3.304/claude"),
  row(5102, 5101, 5100, "node server.js"),
];

const LAUNCH = [
  row(RUNNER, HOST, RUNNER, "/opt/vespin-host/node/bin/node /opt/vespin-host/lib/agent-runner.mjs"),
  row(HARNESS, RUNNER, RUNNER, "/state/agent-tools/claude/0.3.304/claude --output-format"),
  row(4102, HARNESS, RUNNER, "socat UNIX-LISTEN:/tmp/claude-http-3fa9.sock,fork TCP:localhost:5"),
];

const agentRuns = (sources: { readonly proc: string; readonly ps: string }) =>
  Effect.gen(function* () {
    const table = yield* ProcessTable;
    return yield* table.agentProcessRuns;
  }).pipe(Effect.provide(hostProcessTable(RUNNER, sources)));

const folderOf = (ctx: TestContext) => Effect.promise(() => temporaryDirectory(ctx, "vespin-ps-"));

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

const fakeProc = (ctx: TestContext, rows: readonly Row[]) =>
  Effect.gen(function* () {
    const proc = join(yield* folderOf(ctx), "proc");
    mkdirSync(join(proc, "self"), { recursive: true });
    writeFileSync(join(proc, "self", "stat"), "");
    for (const each of rows) {
      const folder = join(proc, String(each.pid));
      mkdirSync(folder);
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
