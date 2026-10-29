import type { CommitSummary, TestFailure, TestRun } from "@luke/ui";

/**
 * command-card-model.ts -- the card a command's output reads as under its row: a test run, a commit, or nothing.
 *
 * Every shell command an agent runs, on any harness, is read as eve's `bash`
 * (`native-tool-calls.ts`), so this one read covers them all. The format is
 * told by the output itself, never by the command, since a script or a
 * package's `test` runs the same runner under another name: vitest's
 * `Tests  … (N)` line, jest's `Tests: … N total`, pytest's `=== … in Ns ===`,
 * and go's `--- PASS:` lines. A commit is read only where the command names
 * `git`, from git's `[branch hash] message` line and its count of files and
 * lines. Output that matches none is no card, and its row draws as it always
 * has; the output stays in the row's fold either way. Nothing here draws.
 */

/** Which card a command's output reads as. */
export const COMMAND_CARD = {
  TEST_RESULTS: "test-results",
  COMMIT: "commit",
} as const;

export type CommandCard =
  | { readonly kind: typeof COMMAND_CARD.TEST_RESULTS; readonly run: TestRun }
  | { readonly kind: typeof COMMAND_CARD.COMMIT; readonly commit: CommitSummary };

/** A count a runner prints, as "7 passed" or "2 errors". */
const COUNT_PART = /(\d+)\s+(passed|failed|skipped|todo|pending|errors?)\b/gu;

/** The words a count's kind is said in, by what it adds to. */
const PASSED_WORD = "passed";
const FAILED_WORDS: ReadonlySet<string> = new Set(["failed", "error", "errors"]);

/** How far past a failure's name its error's first line is looked for. */
const ERROR_REACH = 8;

/** A line that only rules off a block, as vitest's `⎯⎯⎯` and pytest's `___` are. */
const RULE_LINE = /^[\s⎯_=─-]*$/u;

/** A runner's duration, as a number and its unit, into milliseconds. */
function durationMs(value: string, unit: string): number {
  return unit === "ms" ? Number(value) : Number(value) * 1000;
}

/** The passed, failed, and skipped counts a runner's summary words say. */
function tally(words: string): Pick<TestRun, "passed" | "failed" | "skipped"> {
  let passed = 0;
  let failed = 0;
  let skipped = 0;
  for (const [, count, word] of words.matchAll(COUNT_PART)) {
    if (count === undefined || word === undefined) continue;
    if (word === PASSED_WORD) passed += Number(count);
    else if (FAILED_WORDS.has(word)) failed += Number(count);
    else skipped += Number(count);
  }
  return { passed, failed, skipped };
}

/** The first line after `at` that says something, within reach; none where `stop` comes first. */
function errorAfter(
  lines: readonly string[],
  at: number,
  stop: (line: string) => boolean,
): string | undefined {
  for (const line of lines.slice(at + 1, at + 1 + ERROR_REACH)) {
    const words = line.trim();
    if (words === "" || RULE_LINE.test(words)) continue;
    return stop(words) ? undefined : words;
  }
  return undefined;
}

/** The failures a runner names on lines `header` matches, once each, with the first line after each as its error. */
function headedFailures(lines: readonly string[], header: RegExp): readonly TestFailure[] {
  const seen = new Set<string>();
  const isHeader = (line: string) => header.test(line);
  return lines.flatMap((line, at) => {
    const name = header.exec(line)?.[1]?.trim();
    if (name === undefined || seen.has(name)) return [];
    seen.add(name);
    const error = errorAfter(lines, at, isHeader);
    return [error === undefined ? { name } : { name, error }];
  });
}

/** vitest's summary: `Tests  1 failed | 7 passed (8)`, `Duration  1.81s`, and a `FAIL  file > name` line over each failure's error. */
const VITEST_TESTS = /^\s*Tests\s{2,}(.+?)\s*\(\d+\)\s*$/mu;
const VITEST_DURATION = /^\s*Duration\s+(\d+(?:\.\d+)?)(ms|s)\b/mu;
const VITEST_FAIL = /^\s*FAIL\s+(.+?)(?:\s+\[ .+ \])?\s*$/u;

function vitestRun(output: string, lines: readonly string[]): TestRun | undefined {
  const summary = VITEST_TESTS.exec(output)?.[1];
  if (summary === undefined) return undefined;
  const duration = VITEST_DURATION.exec(output);
  return {
    ...tally(summary),
    durationMs:
      duration?.[1] === undefined ? undefined : durationMs(duration[1], duration[2] ?? ""),
    failures: headedFailures(lines, VITEST_FAIL),
  };
}

/** jest's summary: `Tests: 1 failed, 7 passed, 8 total`, `Time: 1.2 s`, and a `●` line over each failure's error. */
const JEST_TESTS = /^\s*Tests:\s+(.+?\d+ total)\s*$/mu;
const JEST_TIME = /^\s*Time:\s+(\d+(?:\.\d+)?)\s*(ms|s)\b/mu;
const JEST_BULLET = /^\s*●\s+(?!Console$)(.+)$/u;

function jestRun(output: string, lines: readonly string[]): TestRun | undefined {
  const summary = JEST_TESTS.exec(output)?.[1];
  if (summary === undefined) return undefined;
  const time = JEST_TIME.exec(output);
  return {
    ...tally(summary),
    durationMs: time?.[1] === undefined ? undefined : durationMs(time[1], time[2] ?? ""),
    failures: headedFailures(lines, JEST_BULLET),
  };
}

/** pytest's summary: `=== 1 failed, 7 passed in 0.12s ===`, bare under `-q`, and a `FAILED path::name - Error` line for each failure. */
const PYTEST_SUMMARY =
  /^(?:=+ )?(\d+ \w+(?:, \d+ \w+)*) in (\d+(?:\.\d+)?)s(?: \([\d:]+\))?(?: =+)?$/mu;
const PYTEST_FAILED = /^(?:FAILED|ERROR) (.+?)(?: - (.*))?$/u;

function pytestRun(output: string, lines: readonly string[]): TestRun | undefined {
  const summary = PYTEST_SUMMARY.exec(output);
  if (summary?.[1] === undefined || summary[2] === undefined) return undefined;
  const counts = tally(summary[1]);
  if (counts.passed + counts.failed + counts.skipped === 0) return undefined;
  const failures = lines.flatMap((line) => {
    const failed = PYTEST_FAILED.exec(line);
    if (failed?.[1] === undefined) return [];
    return [failed[2] === undefined ? { name: failed[1] } : { name: failed[1], error: failed[2] }];
  });
  return { ...counts, durationMs: durationMs(summary[2], "s"), failures };
}

/** go test -v: a `--- PASS|FAIL|SKIP: Name (0.00s)` line for each test and subtest, `=== RUN   Name` where it starts, `file.go:12: words` for what it logged, and `ok  pkg  0.01s` for each package. */
const GO_RESULT = /^\s*--- (PASS|FAIL|SKIP): (\S+) \(\d+(?:\.\d+)?s\)$/u;
const GO_RUN = /^=== RUN\s+(\S+)$/u;
const GO_LOG = /^\s+(\S+\.go:\d+: .+)$/u;
const GO_PACKAGE = /^(?:ok|FAIL)\s+\S+\s+(\d+(?:\.\d+)?)s\b/u;

/** What a failed go test logged first: between its `=== RUN` and its `--- FAIL`, or, as older go prints it, the line after. */
function goError(lines: readonly string[], name: string, at: number): string | undefined {
  const started = lines.findLastIndex(
    (line, index) => index < at && GO_RUN.exec(line)?.[1] === name,
  );
  const between = started === -1 ? [] : lines.slice(started + 1, at);
  const logged = [...between, lines[at + 1] ?? ""].find((line) => GO_LOG.test(line));
  return logged === undefined ? undefined : GO_LOG.exec(logged)?.[1];
}

function goRun(lines: readonly string[]): TestRun | undefined {
  const results = lines.flatMap((line, at) => {
    const result = GO_RESULT.exec(line);
    return result?.[1] === undefined || result[2] === undefined
      ? []
      : [{ status: result[1], name: result[2], at }];
  });
  if (results.length === 0) return undefined;
  // Note that a test with subtests is counted by its subtests alone, because go reports the parent too and a reader counts what ran.
  const parents = new Set(
    results.flatMap(({ name }) =>
      name
        .split("/")
        .slice(0, -1)
        .map((_, depth, parts) => parts.slice(0, depth + 1).join("/")),
    ),
  );
  const leaves = results.filter(({ name }) => !parents.has(name));
  const failures = leaves.flatMap(({ status, name, at }) => {
    if (status !== "FAIL") return [];
    const error = goError(lines, name, at);
    return [error === undefined ? { name } : { name, error }];
  });
  const packages = lines.flatMap((line) => GO_PACKAGE.exec(line)?.[1] ?? []);
  return {
    passed: leaves.filter(({ status }) => status === "PASS").length,
    failed: failures.length,
    skipped: leaves.filter(({ status }) => status === "SKIP").length,
    durationMs:
      packages.length === 0
        ? undefined
        : packages.reduce((sum, seconds) => sum + durationMs(seconds, "s"), 0),
    failures,
  };
}

/** git's word in a command, and its summary of a commit made: `[branch abc1234] message`, then ` 3 files changed, 12 insertions(+), 4 deletions(-)`. */
const GIT_COMMAND = /\bgit\b/u;
const COMMIT_HEAD = /^\[(.+?)(?: \(root-commit\))? ([0-9a-f]{7,40})\] (.+)$/mu;
const COMMIT_STAT =
  /^\s*(\d+) files? changed(?:, (\d+) insertions?\(\+\))?(?:, (\d+) deletions?\(-\))?/mu;

function commitOf(command: string, output: string): CommitSummary | undefined {
  if (!GIT_COMMAND.test(command)) return undefined;
  const head = COMMIT_HEAD.exec(output);
  if (head?.[1] === undefined || head[2] === undefined || head[3] === undefined) return undefined;
  const stat = COMMIT_STAT.exec(output);
  return {
    hash: head[2],
    branch: head[1],
    message: head[3].trim(),
    filesChanged: Number(stat?.[1] ?? 0),
    insertions: Number(stat?.[2] ?? 0),
    deletions: Number(stat?.[3] ?? 0),
  };
}

/** The card `command`'s `output` reads as, the output as a terminal showed it; none where it reads as neither a commit nor a test run. */
export function commandCard(command: string, output: string): CommandCard | undefined {
  const commit = commitOf(command, output);
  if (commit !== undefined) return { kind: COMMAND_CARD.COMMIT, commit };
  const lines = output.split("\n").map((line) => line.trimEnd());
  const run =
    vitestRun(output, lines) ?? jestRun(output, lines) ?? pytestRun(output, lines) ?? goRun(lines);
  return run === undefined ? undefined : { kind: COMMAND_CARD.TEST_RESULTS, run };
}
