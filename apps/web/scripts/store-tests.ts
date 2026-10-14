import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve, sep } from "node:path";
import { exit } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

/**
 * `test:store` runs the tests that open a database against a real Postgres
 * on CI, and this is how those tests are found. A test meets a database
 * through one door, `@luke/database/testing`, and through nothing else:
 * `LUKE_STORE_TEST_DATABASE_URL` is read there alone, so a file that
 * imports no door cannot run against Postgres whatever it does, and a file
 * that imports one runs against Postgres the moment it exists. The set is
 * read from the files, so adding a store test edits no list. The list this
 * replaces was hand-maintained, conflicted on every concurrent PR that
 * added a store test (four times in two hours on one PR on 2026-09-11), and
 * had drifted: nine files opened a database and were not on it, and one on
 * it opened none (LUKE-176).
 *
 * The count is then asserted as a value: vitest's JSON report names every
 * file it ran, and a run that did not cover exactly the selected set fails,
 * naming each file that fell out or crept in, so a file the selection finds
 * but vitest does not run cannot pass silently.
 */

/**
 * Matches an import of the module that makes a test a store test,
 * `@luke/database/testing`, and the `.js` spelling vitest resolves the same
 * way. `no-database`, a client that refuses every statement, stands behind a
 * subpath of its own so that importing it does not.
 */
const doorImport = /from\s+["']@luke\/database\/testing(?:\.js)?["']/;

/** Where store tests live, from the repository root. */
const STORE_TEST_ROOTS = ["apps/web/tests"];

const TEST_FILE_SUFFIX = ".test.ts";

/** Whether one test file's source imports a database door. */
export function importsStoreDoor(source: string): boolean {
  return doorImport.test(source);
}

/**
 * The store tests under each of `roots` in `repository`, as paths relative to
 * it, in path order: every `.test.ts` whose source imports the door.
 */
export function storeTestFiles(
  repository: string,
  roots: ReadonlyArray<string>,
): ReadonlyArray<string> {
  return roots
    .flatMap((root) =>
      readdirSync(join(repository, root), { recursive: true, encoding: "utf8" }).map(
        (entry) => `${root}/${entry.split(sep).join("/")}`,
      ),
    )
    .filter((entry) => entry.endsWith(TEST_FILE_SUFFIX))
    .filter((entry) => importsStoreDoor(readFileSync(join(repository, entry), "utf8")))
    .sort();
}

export interface CoverageDrift {
  /** Selected, and absent from what vitest reports having run. */
  readonly notRun: ReadonlyArray<string>;
  /** Run, and absent from the selection. */
  readonly notSelected: ReadonlyArray<string>;
}

/** The two sets compared, each side's surplus named; both empty when vitest ran exactly the selection. */
export function coverageDrift(
  selected: ReadonlyArray<string>,
  ran: ReadonlyArray<string>,
): CoverageDrift {
  const selectedSet = new Set(selected);
  const ranSet = new Set(ran);
  return {
    notRun: selected.filter((file) => !ranSet.has(file)),
    notSelected: ran.filter((file) => !selectedSet.has(file)).sort(),
  };
}

interface VitestJsonReport {
  readonly testResults: ReadonlyArray<{ readonly name: string }>;
}

/** The files a vitest JSON report names, relative to `repository`. */
export function filesRun(report: VitestJsonReport, repository: string): ReadonlyArray<string> {
  return report.testResults.map((result) => relative(repository, result.name).split(sep).join("/"));
}

const REPOSITORY = resolve(fileURLToPath(new URL(".", import.meta.url)), "../../..");

function main(): number {
  const selected = storeTestFiles(REPOSITORY, STORE_TEST_ROOTS);
  // biome-ignore lint/suspicious/noConsole: a script's output is its log.
  console.log(`test:store: ${selected.length} files import a database door`);
  const reportDirectory = mkdtempSync(join(tmpdir(), "luke-store-tests-"));
  const reportPath = join(reportDirectory, "vitest.json");
  try {
    const run = spawnSync(
      "pnpm",
      [
        "exec",
        "vitest",
        "run",
        "--reporter=default",
        "--reporter=json",
        `--outputFile.json=${reportPath}`,
        ...selected,
      ],
      { cwd: REPOSITORY, stdio: "inherit" },
    );
    const report: VitestJsonReport = JSON.parse(readFileSync(reportPath, "utf8"));
    const drift = coverageDrift(selected, filesRun(report, REPOSITORY));
    for (const file of drift.notRun) {
      console.error(`test:store: selected and not run: ${file}`);
    }
    for (const file of drift.notSelected) {
      console.error(`test:store: run and not selected: ${file}`);
    }
    if (drift.notRun.length > 0 || drift.notSelected.length > 0) {
      console.error(
        `test:store: vitest ran ${report.testResults.length} files, the selection holds ${selected.length}`,
      );
      return 1;
    }
    return run.status ?? 1;
  } finally {
    rmSync(reportDirectory, { recursive: true, force: true });
  }
}

const executedPath = process.argv[1];
if (executedPath && import.meta.url === pathToFileURL(executedPath).href) {
  exit(main());
}
