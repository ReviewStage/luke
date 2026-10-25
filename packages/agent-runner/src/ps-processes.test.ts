import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assert, describe, it } from "@effect/vitest";
import { Effect } from "effect";
import { ProcessTable } from "./processes.js";
import { psProcessTable } from "./ps-processes.js";

/** The runner's own pid in the listings below, leading its own process group. */
const RUNNER = 4100;

/** Whether the table answers that a process of the agent's runs, over the `ps` given. */
const agentRuns = (ps: string) =>
  Effect.gen(function* () {
    const table = yield* ProcessTable;
    return yield* table.agentProcessRuns;
  }).pipe(Effect.provide(psProcessTable(ps, RUNNER)));

/** The harness the runner spawned. */
const HARNESS = 4101;

/** A row as macOS's `ps -o pid=,ppid=,pgid=,command=` prints it. */
function row(pid: number, parent: number, group: number, command: string): string {
  return `${String(pid).padStart(5)} ${String(parent).padStart(5)} ${String(group).padStart(5)} ${command}`;
}

/** What any Mac lists beside the runner: launchd, and the desktop app that started the runner, in a group of its own. */
const BESIDE = [
  row(1, 0, 1, "/sbin/launchd"),
  row(900, 1, 900, "/Applications/Luke.app/Contents/MacOS/Luke"),
  row(901, 900, 900, "/bin/zsh -l"),
];

/** The runner, its harness, and the harness's command-sandbox bridge, none of them the agent's. */
const LAUNCH = [
  row(RUNNER, 900, RUNNER, "/opt/node agent-runner.mjs"),
  row(HARNESS, RUNNER, RUNNER, "/Applications/Luke.app/Contents/Resources/claude --output-format"),
  row(4102, HARNESS, RUNNER, "socat UNIX-LISTEN:/tmp/claude-http-3fa9.sock,fork TCP:localhost:5"),
];

/** A `ps` of the test's own: a script that prints the rows given and exits as told. */
function fakePs(rows: readonly string[], exitCode = 0) {
  return Effect.acquireRelease(
    Effect.sync(() => {
      const directory = mkdtempSync(join(tmpdir(), "luke-ps-"));
      const listing = join(directory, "listing");
      writeFileSync(listing, `${rows.join("\n")}\n`);
      const ps = join(directory, "ps");
      writeFileSync(ps, `#!/bin/sh\ncat '${listing}'\nexit ${exitCode}\n`);
      chmodSync(ps, 0o755);
      return { directory, ps };
    }),
    ({ directory }) => Effect.sync(() => rmSync(directory, { recursive: true, force: true })),
  );
}

describe("psProcessTable", () => {
  it.effect.each([
    { case: "only the runner, its harness, and the bridge", rows: LAUNCH, runs: false },
    {
      case: "a server the agent's command started",
      rows: [
        ...LAUNCH,
        row(4103, HARNESS, RUNNER, "/bin/zsh -c npm run dev"),
        row(4104, 4103, RUNNER, "node server.js"),
      ],
      runs: true,
    },
    {
      case: "a server that detached to launchd in the runner's group",
      rows: [...LAUNCH, row(4105, 1, RUNNER, "node server.js")],
      runs: true,
    },
    { case: "a listing with no runner in it", rows: [], runs: true },
  ])("answers $runs for $case", ({ rows, runs }) =>
    Effect.gen(function* () {
      const { ps } = yield* fakePs([...BESIDE, ...rows]);
      assert.strictEqual(yield* agentRuns(ps), runs);
    }).pipe(Effect.scoped),
  );

  it.effect("answers that one runs where ps fails, never releasing a wait on a guess", () =>
    Effect.gen(function* () {
      const { ps } = yield* fakePs([...BESIDE, ...LAUNCH], 1);
      assert.isTrue(yield* agentRuns(ps));
    }).pipe(Effect.scoped),
  );
});
