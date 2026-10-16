import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, writeFileSync } from "node:fs";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { temporaryDirectory } from "@luke/runtime/testing";
import { type TestContext, test } from "vitest";

const SCRIPT = fileURLToPath(new URL("../../../scripts/release/verify-ci.mjs", import.meta.url));
const REPOSITORY = "ReviewStage/luke";
const COMMIT = "0123456789abcdef0123456789abcdef01234567";
const ACTIONS = 15368;
const OTHER_APP = 1;

const RULES_PATH = `repos/${REPOSITORY}/rules/branches/main`;
const COMPARE_PATH = `repos/${REPOSITORY}/compare/${COMMIT}...main?per_page=1`;

/** GitHub's answer to the check-runs question for one check name. */
function checkRunsPath(name: string): string {
  return `repos/${REPOSITORY}/commits/${COMMIT}/check-runs?check_name=${encodeURIComponent(name)}&filter=latest&per_page=100`;
}

type CheckRun = { conclusion: string | null; app: { id: number } };

/** What `gh api` answers for each path the script asks, as GitHub's REST API shapes it. */
type Answer =
  | {
      type: string;
      parameters?: { required_status_checks: { context: string; integration_id: number }[] };
    }[]
  | { status: string; files?: { filename: string; patch: string }[] }
  | { check_runs: CheckRun[] };

type Answers = Map<string, Answer>;

/** A repository whose main requires `checks` from GitHub Actions, as the "Protect main" ruleset does. */
function rules(checks: string[]): Answer {
  return [
    { type: "deletion" },
    {
      type: "required_status_checks",
      parameters: {
        required_status_checks: checks.map((context) => ({ context, integration_id: ACTIONS })),
      },
    },
  ];
}

const REQUIRED = ["TypeScript checks", "Tests (1/4)"];

/** Every answer of a commit the merge queue let onto main. */
function merged(): Answers {
  const answers: Answers = new Map([
    [RULES_PATH, rules(REQUIRED)],
    [COMPARE_PATH, { status: "ahead" }],
  ]);
  for (const name of REQUIRED) {
    answers.set(checkRunsPath(name), {
      check_runs: [{ conclusion: "success", app: { id: ACTIONS } }],
    });
  }
  return answers;
}

/** The answers of a commit the merge queue let onto main, but for `changed`. */
function mergedBut(...changed: [string, Answer][]): Answers {
  const answers = merged();
  for (const [path, answer] of changed) answers.set(path, answer);
  return answers;
}

/**
 * Runs the script with a `gh` on PATH that answers each `gh api <path>` from
 * `answers` and fails for any path it was not given, as `gh` fails on an HTTP
 * error.
 */
async function verify(
  t: TestContext,
  answers: Answers,
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  const bin = await temporaryDirectory(t, "luke-verify-ci-");
  writeFileSync(join(bin, "answers.json"), JSON.stringify(Object.fromEntries(answers)));
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/usr/bin/env node",
      'const answers = require(require("node:path").join(__dirname, "answers.json"));',
      "const path = process.argv[3];",
      'if (process.argv[2] !== "api" || !(path in answers)) {',
      '  process.stderr.write("HTTP 404: Not Found (" + path + ")\\n");',
      "  process.exit(1);",
      "}",
      "process.stdout.write(JSON.stringify(answers[path]));",
    ].join("\n"),
  );
  chmodSync(join(bin, "gh"), 0o755);
  const ran = spawnSync(process.execPath, [SCRIPT, REPOSITORY, COMMIT], {
    encoding: "utf8",
    env: { PATH: `${bin}${delimiter}${process.env.PATH}` },
  });
  return { status: ran.status, stdout: ran.stdout, stderr: ran.stderr };
}

test("a commit on main whose every required check succeeded passes", async (t) => {
  assert.equal((await verify(t, merged())).status, 0);
  const atHead = await verify(t, mergedBut([COMPARE_PATH, { status: "identical" }]));
  assert.equal(atHead.status, 0);
  assert.match(atHead.stdout, /TypeScript checks, Tests \(1\/4\)/u);
});

test("a commit main has moved far past passes, however large the comparison", async (t) => {
  const patch = "+".repeat(4 * 1024 * 1024);
  const ran = await verify(
    t,
    mergedBut([COMPARE_PATH, { status: "ahead", files: [{ filename: "CHANGELOG.md", patch }] }]),
  );
  assert.equal(ran.status, 0, ran.stderr);
});

test("a commit beside main fails, however green its checks", async (t) => {
  for (const status of ["behind", "diverged"]) {
    const ran = await verify(t, mergedBut([COMPARE_PATH, { status }]));
    assert.equal(ran.status, 1, status);
    assert.match(ran.stderr, /is not on main/u);
  }
});

test("a required check that failed, never ran, or failed on its re-run fails the commit", async (t) => {
  const runs = {
    failed: [{ conclusion: "failure", app: { id: ACTIONS } }],
    "never ran": [],
    "still running": [{ conclusion: null, app: { id: ACTIONS } }],
    "failed on its re-run": [
      { conclusion: "success", app: { id: ACTIONS } },
      { conclusion: "failure", app: { id: ACTIONS } },
    ],
  } satisfies Record<string, CheckRun[]>;
  for (const [what, checkRuns] of Object.entries(runs)) {
    const ran = await verify(
      t,
      mergedBut([checkRunsPath("Tests (1/4)"), { check_runs: checkRuns }]),
    );
    assert.equal(ran.status, 1, what);
    assert.match(ran.stderr, /"Tests \(1\/4\)" has not succeeded/u, what);
  }
});

test("a check of the required name reported by another app does not count", async (t) => {
  const ran = await verify(
    t,
    mergedBut([
      checkRunsPath("TypeScript checks"),
      { check_runs: [{ conclusion: "success", app: { id: OTHER_APP } }] },
    ]),
  );
  assert.equal(ran.status, 1);
  assert.match(ran.stderr, /"TypeScript checks" has not succeeded/u);
});

test("rules that require no check vouch for nothing, so the commit fails", async (t) => {
  const ran = await verify(t, mergedBut([RULES_PATH, rules([])]));
  assert.equal(ran.status, 1);
  assert.match(ran.stderr, /require no status check/u);
});

test("a question GitHub does not answer fails the commit rather than passing it", async (t) => {
  const answers = merged();
  answers.delete(COMPARE_PATH);
  const ran = await verify(t, answers);
  assert.equal(ran.status, 1);
  assert.match(ran.stderr, /could not confirm CI/u);
});
