import { join } from "node:path";
import { FetchHttpClient, FileSystem } from "@effect/platform";
import { NodeContext, NodeRuntime } from "@effect/platform-node";
import { Config, Effect, Layer, Option, Redacted, Schema } from "effect";
import {
  type PlannedRequest,
  PROBE_DOOR,
  PROBE_REQUEST_INIT,
  ProbeDoorSchema,
  type ProbeReport,
  planProbes,
  probeDeployment,
  probeFailures,
  readProbePaths,
  VERDICT,
} from "../server/preview-probe.js";

/**
 * Reads the deployed shape of the address handed to it and exits non-zero
 * when a request the clients make is not answered by the deployment's own
 * handler:
 *
 *   PREVIEW_PROBE_DOOR=bypass-secret \
 *     pnpm --dir apps/web exec tsx scripts/preview-probe.ts --url https://tryluke.dev
 *
 * That is the Services preset sitting runbook's read of production after a
 * merge, over the whole derived list rather than its eight requests alone.
 * The door names which project setting the probe relies on; the bypass door
 * sends `VERCEL_AUTOMATION_BYPASS_SECRET` when one is set and otherwise plain
 * GETs, which an unprotected production answers and a protected preview
 * redirects, reported as such. The report is written to standard output and,
 * where `GITHUB_STEP_SUMMARY` names a file, appended there as a table.
 */

const WEB = join(import.meta.dirname, "..");
const REPO_ROOT = join(WEB, "..", "..");
const URL_FLAG = "--url";

const ENV = {
  DOOR: "PREVIEW_PROBE_DOOR",
  BYPASS_SECRET: "VERCEL_AUTOMATION_BYPASS_SECRET",
  STEP_SUMMARY: "GITHUB_STEP_SUMMARY",
} as const;

const doorConfig = Config.literal(...ProbeDoorSchema.literals)(ENV.DOOR);
/** A workflow hands an absent secret over as the empty string, which is no secret. */
const bypassSecretConfig = Config.option(Config.redacted(ENV.BYPASS_SECRET)).pipe(
  Config.map(Option.filter((secret) => Redacted.value(secret).length > 0)),
);
const stepSummaryConfig = Config.option(Config.string(ENV.STEP_SUMMARY));

class AddressMissing extends Schema.TaggedError<AddressMissing>()("AddressMissing", {}) {
  override get message(): string {
    return `${URL_FLAG} <address> names the deployment to probe`;
  }
}

class ShapeMismatch extends Schema.TaggedError<ShapeMismatch>()("ShapeMismatch", {
  failures: Schema.Number,
  total: Schema.Number,
}) {
  override get message(): string {
    return `${this.failures} of ${this.total} requests were not answered by the deployment's own handler`;
  }
}

function addressArgument(argv: readonly string[]): string | undefined {
  const flag = argv.indexOf(URL_FLAG);
  return flag === -1 ? undefined : argv[flag + 1];
}

const write = (text: string) => Effect.sync(() => process.stdout.write(text));

function expectedColumn(request: PlannedRequest): string {
  return request.expected === undefined ? "" : ` (expected ${request.expected})`;
}

function renderReport(report: ProbeReport): string {
  const lines = report.results.map((result) => {
    const error = result.vercelError === undefined ? "" : ` ${result.vercelError}`;
    return `${result.verdict === VERDICT.OK ? "ok  " : "FAIL"} ${result.method} ${result.path} -> ${result.status}${error}${expectedColumn(result)} [${result.verdict}]`;
  });
  return `${report.address} through the ${report.door} door\n${lines.join("\n")}\n`;
}

function renderSummary(report: ProbeReport): string {
  const failures = probeFailures(report);
  const rows = report.results.map(
    (result) =>
      `| ${result.verdict === VERDICT.OK ? "✅" : "❌"} | \`${result.method}\` | \`${result.path}\` | ${result.status}${result.vercelError === undefined ? "" : ` \`${result.vercelError}\``} | ${result.expected ?? ""} | ${result.verdict} |`,
  );
  return [
    `### Deployed shape: ${report.address}`,
    "",
    `Door: \`${report.door}\`. ${failures.length} of ${report.results.length} requests not answered by the deployment's own handler.`,
    "",
    "| | Method | Path | Status | Expected | Verdict |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
    "",
  ].join("\n");
}

function appendStepSummary(text: string): Effect.Effect<void, never, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const path = yield* stepSummaryConfig;
    if (Option.isNone(path)) return;
    const fs = yield* FileSystem.FileSystem;
    yield* fs.writeFileString(path.value, text, { flag: "a" });
  }).pipe(Effect.orDie);
}

const program = Effect.gen(function* () {
  const address = addressArgument(process.argv.slice(2));
  if (address === undefined) return yield* new AddressMissing();
  const door = yield* doorConfig;
  const bypassSecret =
    door === PROBE_DOOR.BYPASS_SECRET ? yield* bypassSecretConfig : Option.none();
  const plan = planProbes(door, yield* readProbePaths({ repoRoot: REPO_ROOT, web: WEB }));
  const report: ProbeReport = {
    door,
    address,
    results: yield* probeDeployment({ address, bypassSecret }, plan),
  };
  yield* write(renderReport(report));
  yield* appendStepSummary(renderSummary(report));
  const failures = probeFailures(report);
  if (failures.length > 0) {
    return yield* new ShapeMismatch({ failures: failures.length, total: report.results.length });
  }
});

const httpClient = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, PROBE_REQUEST_INIT)),
);

NodeRuntime.runMain(program.pipe(Effect.provide(Layer.mergeAll(httpClient, NodeContext.layer))));
