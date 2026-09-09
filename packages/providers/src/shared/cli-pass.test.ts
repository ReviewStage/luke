import assert from "node:assert/strict";
import test from "node:test";
import {
  ACT_RESULT_STATUS,
  CLI_CONNECTION,
  type ProviderSessionObservation,
  SESSION_LOCATION,
  SESSION_STATUS,
  type SessionProvider,
} from "@sidecar/session";
import { ADAPTER_DIAGNOSTIC_KIND } from "./adapter-diagnostics.js";
import { ADAPTER_FAILURE, AdapterFailure } from "./adapter-failure.js";
import { type CliPassInput, type CliRun, cliPass } from "./cli-pass.js";

const TEST_TIME = Date.parse("2026-09-01T12:00:00.000Z");
const BINARY = "stub";
const LOGIN_PROBE_ARGV = ["login", "status"];
const LIST_ARGV = ["cloud", "list", "--json"];

const STUB_PROVIDER: SessionProvider = { id: "stub", displayName: "Stub" };

function observation(providerSessionId: string): ProviderSessionObservation {
  return {
    providerSessionId,
    title: providerSessionId,
    status: SESSION_STATUS.WORKING,
    lastActivityAt: TEST_TIME,
  };
}

interface CliBehavior {
  signedOut?: boolean;
  binaryMissing?: boolean;
  listFails?: boolean;
  listStdout?: string;
}

function fakeCli(behavior: CliBehavior = {}) {
  const invocations: (readonly string[])[] = [];
  const run: CliRun = async (_binary, argv) => {
    invocations.push(argv);
    if (behavior.binaryMissing) {
      throw new AdapterFailure(ADAPTER_FAILURE.UNAVAILABLE, "no binary");
    }
    if (argv.join(" ") === LOGIN_PROBE_ARGV.join(" ")) {
      return { exitCode: behavior.signedOut ? 1 : 0, stdout: "" };
    }
    if (behavior.listFails) return { exitCode: 1, stdout: "" };
    return { exitCode: 0, stdout: behavior.listStdout ?? JSON.stringify({ items: [] }) };
  };
  return { run, invocations, behavior };
}

function harness(
  behavior: CliBehavior = {},
  overrides: Partial<CliPassInput> = {},
): {
  pass: ReturnType<typeof cliPass>;
  invocations: (readonly string[])[];
  behavior: CliBehavior;
  forgotten: () => number;
  collected: () => number;
} {
  const cli = fakeCli(behavior);
  let forgotten = 0;
  let collected = 0;
  const pass = cliPass({
    provider: STUB_PROVIDER,
    binary: BINARY,
    loginProbeArgv: LOGIN_PROBE_ARGV,
    run: cli.run,
    now: () => TEST_TIME,
    minimumRefreshIntervalMs: 0,
    forget: () => {
      forgotten += 1;
    },
    collect: async (request) => {
      collected += 1;
      await request(LIST_ARGV);
      return [observation("one")];
    },
    ...overrides,
  });
  return {
    pass,
    invocations: cli.invocations,
    behavior: cli.behavior,
    forgotten: () => forgotten,
    collected: () => collected,
  };
}

test("a signed-in pass reports its sessions as living in the cloud", async () => {
  const { pass, invocations } = harness();
  const observations = await pass.run();
  assert.deepEqual(
    observations.map((entry) => entry.location),
    [SESSION_LOCATION.CLOUD],
  );
  assert.equal(pass.connection(), CLI_CONNECTION.CONNECTED);
  assert.deepEqual(invocations, [LOGIN_PROBE_ARGV, LIST_ARGV]);
});

test("a signed-out CLI is observed as having nothing, and the list is never run", async () => {
  const { pass, invocations, collected } = harness({ signedOut: true });
  assert.deepEqual(await pass.run(), []);
  assert.equal(pass.connection(), CLI_CONNECTION.SIGNED_OUT);
  assert.equal(collected(), 0);
  assert.deepEqual(invocations, [LOGIN_PROBE_ARGV]);
});

test("an absent binary is observed as having nothing", async () => {
  const { pass } = harness({ binaryMissing: true });
  assert.deepEqual(await pass.run(), []);
  assert.equal(pass.connection(), CLI_CONNECTION.CLI_MISSING);
});

test("signing out clears what an earlier pass observed", async () => {
  const { pass, behavior, forgotten } = harness();
  assert.equal((await pass.run()).length, 1);
  behavior.signedOut = true;
  assert.deepEqual(await pass.run(), []);
  assert.deepEqual(pass.latest(), []);
  assert.equal(forgotten(), 1);
});

test("a command that ran and failed keeps the previous snapshot", async () => {
  const { pass, behavior, forgotten } = harness();
  const first = await pass.run();
  behavior.listFails = true;
  assert.deepEqual(await pass.run(), first);
  assert.equal(forgotten(), 0);
});

test("inside the refresh interval a second pass runs nothing at all", async () => {
  const { pass, invocations } = harness({}, { minimumRefreshIntervalMs: 60_000 });
  const first = await pass.run();
  const before = invocations.length;
  assert.deepEqual(await pass.run(), first);
  assert.equal(invocations.length, before);
});

test("a write that landed makes the next pass actually ask", async () => {
  const { pass, invocations } = harness({}, { minimumRefreshIntervalMs: 60_000 });
  await pass.run();
  const written = await pass.write(["cloud", "create"]);
  assert.equal(written.outcome.status, ACT_RESULT_STATUS.ACCEPTED);
  const before = invocations.length;
  await pass.run();
  assert.ok(invocations.length > before);
});

test("a write refuses without running when the CLI has signed out since the pass", async () => {
  const { pass, behavior, invocations } = harness();
  await pass.run();
  behavior.signedOut = true;
  const before = invocations.length;
  const written = await pass.write(["cloud", "create"]);
  assert.deepEqual(written, {
    outcome: {
      status: ACT_RESULT_STATUS.REJECTED,
      reason: "Stub's CLI is signed out, so nothing was sent.",
    },
  });
  // The probe ran; the write itself did not.
  assert.deepEqual(invocations.slice(before), [LOGIN_PROBE_ARGV]);
  assert.deepEqual(pass.latest(), []);
});

test("a write refuses without running when the binary has gone", async () => {
  const { pass, behavior } = harness();
  await pass.run();
  behavior.binaryMissing = true;
  const written = await pass.write(["cloud", "create"]);
  assert.deepEqual(written.outcome, {
    status: ACT_RESULT_STATUS.REJECTED,
    reason: "Stub's CLI is not installed, so nothing was sent.",
  });
});

test("a write the CLI refused names no CLI output", async () => {
  const { pass } = harness({ listFails: true });
  const written = await pass.write(["cloud", "create"]);
  assert.deepEqual(written.outcome, {
    status: ACT_RESULT_STATUS.REJECTED,
    reason: "Stub's CLI refused the request.",
  });
});

test("unreadable CLI output is transient, not a diagnostic", async () => {
  const diagnostics: string[] = [];
  const { pass } = harness(
    { listStdout: "not json" },
    {
      onDiagnostic: (kind) => {
        diagnostics.push(kind);
      },
    },
  );
  assert.deepEqual(await pass.run(), []);
  assert.deepEqual(diagnostics, []);
});

test("a bug in the adapter's own parsing is reported and rethrown", async () => {
  const diagnostics: string[] = [];
  const { pass } = harness(
    {},
    {
      collect: async () => {
        throw new TypeError("the adapter misread a row");
      },
      onDiagnostic: (kind) => {
        diagnostics.push(kind);
      },
    },
  );
  await assert.rejects(pass.run(), TypeError);
  assert.deepEqual(diagnostics, [ADAPTER_DIAGNOSTIC_KIND.PASS_FAILURE]);
});

test("a superseded pass never lands its answer over the newer one", async () => {
  let release: (() => void) | undefined;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let passes = 0;
  const { pass } = harness(
    {},
    {
      collect: async (request) => {
        passes += 1;
        if (passes === 1) await held;
        await request(LIST_ARGV);
        return [observation(`pass-${passes}`)];
      },
    },
  );
  const first = pass.run();
  const second = await pass.run();
  release?.();
  assert.deepEqual(await first, second);
  assert.deepEqual(
    pass.latest().map((entry) => entry.providerSessionId),
    ["pass-2"],
  );
});
