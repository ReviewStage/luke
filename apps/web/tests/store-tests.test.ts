import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, expect, test } from "vitest";
import {
  coverageDrift,
  filesRun,
  importsStoreDoor,
  STORE_TEST_DOORS,
  storeTestFiles,
} from "../scripts/store-tests.js";

/**
 * The store selection replaced a hand-maintained list, so what it must not
 * do is lose a file quietly. Two readings of the tests directory have to
 * agree: the selection, which reads a door's import, and an independent
 * reading of what each file uses from a door. A file that reaches a door
 * some other way, through a re-export or a path this suite has not seen,
 * shows up as the difference between the two, named.
 */

const THIS_FILE = fileURLToPath(import.meta.url);
const TESTS_DIRECTORY = dirname(THIS_FILE);

/** What a door exports, as a file would use it; the second reading. */
const DOOR_SYMBOLS = [
  "openHostedStoreTestDatabase",
  "testSqlClient",
  "unmigratedPgliteSqlClient",
  "openMigratedPglite",
  "sqlClientOverPglite",
  "cloneStoreTestPostgres",
  "STORE_TEST_DATABASE_ENVIRONMENT",
] as const;

const usesDoorSymbol = (source: string) => DOOR_SYMBOLS.some((symbol) => source.includes(symbol));

/** Every test file but this one, which names the symbols without using them. */
const filesUsingADoorSymbol = () =>
  readdirSync(TESTS_DIRECTORY, { recursive: true, encoding: "utf8" })
    .filter((entry) => entry.endsWith(".test.ts") && entry !== basename(THIS_FILE))
    .filter((entry) => usesDoorSymbol(readFileSync(join(TESTS_DIRECTORY, entry), "utf8")))
    .sort();

const temporary: string[] = [];
afterEach(() => {
  for (const directory of temporary.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixtureTests(files: Record<string, string>): string {
  const directory = mkdtempSync(join(tmpdir(), "luke-store-selection-"));
  temporary.push(directory);
  for (const [file, source] of Object.entries(files)) {
    mkdirSync(join(directory, file, ".."), { recursive: true });
    writeFileSync(join(directory, file), source);
  }
  return directory;
}

test("a door's import is read in each spelling a file uses, and nothing else is", () => {
  expect(importsStoreDoor(`import { x } from "${STORE_TEST_DOORS.HOSTED_STORE_DATABASE}";`)).toBe(
    true,
  );
  expect(importsStoreDoor(`import { x } from "${STORE_TEST_DOORS.SQL_CLIENT}.js";`)).toBe(true);
  expect(importsStoreDoor(`import { x } from '${STORE_TEST_DOORS.STORE_TEST_POSTGRES}';`)).toBe(
    true,
  );
  expect(importsStoreDoor(`import {\n  a,\n  b,\n} from "${STORE_TEST_DOORS.SQL_CLIENT}";`)).toBe(
    true,
  );
  expect(importsStoreDoor(`import { x } from "./support/sql-client-fixtures";`)).toBe(false);
  expect(importsStoreDoor(`import { x } from "../server/db/sql-client";`)).toBe(false);
  expect(importsStoreDoor(`import { PGlite } from "@electric-sql/pglite";`)).toBe(false);
});

test("the selection is every test file importing a door, wherever it sits, in path order, and no other", () => {
  const directory = fixtureTests({
    "zeta.test.ts": `import { openHostedStoreTestDatabase } from "${STORE_TEST_DOORS.HOSTED_STORE_DATABASE}";`,
    "alpha.test.ts": `import { testSqlClient } from "${STORE_TEST_DOORS.SQL_CLIENT}.js";`,
    "nested/deep.test.ts": `import { cloneStoreTestPostgres } from "${STORE_TEST_DOORS.STORE_TEST_POSTGRES}";`,
    "plain.test.ts": `import { test } from "vitest";`,
    "support/sql-client.ts": `export const testSqlClient = 1;`,
    "notes.ts": `import { testSqlClient } from "${STORE_TEST_DOORS.SQL_CLIENT}";`,
  });
  expect(storeTestFiles(directory)).toEqual([
    "alpha.test.ts",
    "nested/deep.test.ts",
    "zeta.test.ts",
  ]);
});

test("the drift names what was selected and not run, and what ran unselected, and is empty for a match", () => {
  expect(coverageDrift(["a.test.ts", "b.test.ts"], ["b.test.ts", "a.test.ts"])).toEqual({
    notRun: [],
    notSelected: [],
  });
  expect(
    coverageDrift(["a.test.ts", "b.test.ts", "c.test.ts"], ["c.test.ts", "z.test.ts"]),
  ).toEqual({
    notRun: ["a.test.ts", "b.test.ts"],
    notSelected: ["z.test.ts"],
  });
});

test("a vitest report's absolute names read back as the selection's relative ones", () => {
  const report = {
    testResults: [
      { name: join(TESTS_DIRECTORY, "nested", "deep.test.ts") },
      { name: join(TESTS_DIRECTORY, "alpha.test.ts") },
    ],
  };
  expect(filesRun(report, TESTS_DIRECTORY)).toEqual(["nested/deep.test.ts", "alpha.test.ts"]);
});

test("over this repository, the selection and the files using a door's exports are one set", () => {
  const selected = storeTestFiles(TESTS_DIRECTORY);
  const usingASymbol = filesUsingADoorSymbol();
  expect(coverageDrift(selected, usingASymbol)).toEqual({ notRun: [], notSelected: [] });
  expect(selected.length).toBe(usingASymbol.length);
  expect(selected).toContain("store-database-isolation.test.ts");
  expect(selected).not.toContain(basename(THIS_FILE));
});
