/**
 * cli.ts -- `pnpm probe:codex` and `pnpm probe:codex:sign-in`, run once by the developer from a `vercel link`ed checkout on their Mac.
 *
 * `pnpm probe:codex` signs in through the browser and hands the credentials
 * straight to the probe in the same process; with
 * `LUKE_PROBE_CODEX_CREDENTIALS` naming a file `probe:codex:sign-in` wrote,
 * it reads them from there instead. Either way no credential is printed, put
 * in argv, or exported. The probe opens its own sandbox, prints one line per
 * check, and writes the sanitized recording and report under
 * `tools/codex-probe/fixtures/live/`, refusing to write either if anything
 * secret-shaped survived the sanitizer.
 */

import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs, promisify } from "node:util";
import { formatReport, judge, passed } from "./checks.js";
import { type ChatGptCredentials, createExtAgentHostId } from "./oauth.js";
import { PROBE_BOUNDS, readGithubRepository, runProbe } from "./probe.js";
import { findLeaks, type KnownSecret, Sanitizer, SECRET_KIND } from "./sanitize.js";
import { readCredentialsFile, signIn, writeCredentialsFile } from "./sign-in.js";

/** Where the live recording lands, relative to the repository root the command runs from. */
const LIVE_FIXTURES = "tools/codex-probe/fixtures/live";

/** A line to the terminal; nothing passed here carries a credential. */
function say(line: string): void {
  process.stdout.write(`${line}\n`);
}

/** The developer's GitHub token from their own `gh`, read into memory for the firewall alone. */
async function githubToken(): Promise<string> {
  const { stdout } = await promisify(execFile)("gh", ["auth", "token"]);
  return stdout.trim();
}

/** Every value of a run's credentials the sanitizer must replace. */
function secretsOf(
  credentials: readonly ChatGptCredentials[],
  github: string | undefined,
): readonly KnownSecret[] {
  const secrets = credentials.flatMap((one): KnownSecret[] => [
    { kind: SECRET_KIND.ACCESS_TOKEN, value: one.tokens.accessToken },
    { kind: SECRET_KIND.REFRESH_TOKEN, value: one.tokens.refreshToken },
    { kind: SECRET_KIND.CLIENT_ID, value: one.issuedClientId },
    { kind: SECRET_KIND.HOST_ID, value: one.extAgentHostId },
    ...(one.tokens.idToken === undefined
      ? []
      : [{ kind: SECRET_KIND.ID_TOKEN, value: one.tokens.idToken }]),
  ]);
  return github === undefined
    ? secrets
    : [...secrets, { kind: SECRET_KIND.GITHUB_TOKEN, value: github }];
}

/** The sign-in alone: credentials into a protected file, whose path is printed. */
async function signInOnly(): Promise<void> {
  const credentials = await signIn({ fetch, extAgentHostId: createExtAgentHostId(), say });
  const file = await writeCredentialsFile(credentials);
  say(
    `Credentials written to an owner-only file. Run the probe with:\nLUKE_PROBE_CODEX_CREDENTIALS=${file} pnpm probe:codex`,
  );
}

/** The probe: sign in or read the file, run, judge, print, and write the sanitized recording. */
async function probe(values: {
  repository?: string | undefined;
  model?: string | undefined;
  "ci-seconds"?: string | undefined;
}): Promise<boolean> {
  const file = process.env.LUKE_PROBE_CODEX_CREDENTIALS;
  const repository = readGithubRepository(values.repository);
  const credentials =
    file === undefined || file.length === 0
      ? await signIn({ fetch, extAgentHostId: createExtAgentHostId(), say })
      : await readCredentialsFile(file);
  const github = repository === undefined ? undefined : await githubToken();
  const run = await runProbe({
    credentials,
    fetch,
    say,
    githubRepository: repository,
    githubToken: github,
    model: values.model,
    ciSeconds: Number(values["ci-seconds"] ?? PROBE_BOUNDS.CI_SECONDS),
  });
  const results = judge(run.observations);
  const secrets = secretsOf(run.credentials, github);
  const sanitizer = new Sanitizer(secrets);
  const lines = run.recorded.map((one) => JSON.stringify(sanitizer.value({ ...one })));
  const report = JSON.stringify(
    sanitizer.value({ results: results.map((one) => ({ ...one })), notes: [...run.notes] }),
    null,
    2,
  );
  say(`\n${sanitizer.text(formatReport(results))}`);
  for (const note of run.notes) say(`note: ${sanitizer.text(note)}`);
  const recording = `${lines.join("\n")}\n`;
  const leaks = [...findLeaks(recording, secrets), ...findLeaks(report, secrets)];
  if (leaks.length > 0) {
    say(`Not writing the recording: it still holds ${[...new Set(leaks)].join(", ")}.`);
    return false;
  }
  await mkdir(LIVE_FIXTURES, { recursive: true });
  await writeFile(path.join(LIVE_FIXTURES, "app-server.jsonl"), recording);
  await writeFile(path.join(LIVE_FIXTURES, "report.json"), `${report}\n`);
  say(`Sanitized recording and report written to ${LIVE_FIXTURES}/.`);
  return passed(results);
}

/** The entry: `sign-in` alone, or the probe. */
async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      repository: { type: "string" },
      model: { type: "string" },
      "ci-seconds": { type: "string" },
    },
  });
  if (positionals[0] === "sign-in") {
    await signInOnly();
    return;
  }
  process.exitCode = (await probe(values)) ? 0 : 1;
}

main().catch((cause: Error) => {
  process.stderr.write(`codex probe failed: ${cause.message}\n`);
  process.exitCode = 1;
});
