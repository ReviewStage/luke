import { expect, it } from "vitest";
import { COMMAND_CARD, type CommandCard, commandCard } from "./command-card-model.js";
import { cutCallCard, toolCallView } from "./tool-call-model.js";

const VITEST = `
 ❯ src/parser.test.ts (8 tests | 1 failed) 12ms
   × parser > reads jest 3ms

⎯⎯⎯⎯⎯⎯⎯ Failed Tests 1 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  src/parser.test.ts > parser > reads jest
AssertionError: expected 1 to be 2 // Object.is equality

- Expected
+ Received

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/1]⎯

 Test Files  1 failed (1)
      Tests  1 failed | 6 passed | 1 skipped (8)
   Start at  10:00:00
   Duration  1.81s (transform 120ms, setup 0ms)
exit 1`;

const JEST = `
FAIL src/parser.test.js
  parser
    ✕ reads jest (3 ms)
    ✓ reads vitest (1 ms)

  ● parser › reads jest

    expect(received).toBe(expected) // Object.is equality

    Expected: 2
    Received: 1

Test Suites: 1 failed, 1 total
Tests:       1 failed, 7 passed, 8 total
Snapshots:   0 total
Time:        1.2 s
Ran all test suites.`;

const PYTEST = `
============================= test session starts ==============================
collected 8 items

tests/test_parser.py .F......                                            [100%]

=================================== FAILURES ===================================
_______________________________ test_reads_jest ________________________________

    def test_reads_jest():
>       assert 1 == 2
E       assert 1 == 2

tests/test_parser.py:4: AssertionError
=========================== short test summary info ============================
FAILED tests/test_parser.py::test_reads_jest - assert 1 == 2
========================= 1 failed, 7 passed in 0.12s ==========================`;

const GO = `
=== RUN   TestReadsVitest
--- PASS: TestReadsVitest (0.00s)
=== RUN   TestReadsJest
    parser_test.go:12: expected 2, got 1
--- FAIL: TestReadsJest (0.00s)
=== RUN   TestTable
=== RUN   TestTable/empty
=== RUN   TestTable/full
--- PASS: TestTable (0.00s)
    --- PASS: TestTable/empty (0.00s)
    --- PASS: TestTable/full (0.00s)
=== RUN   TestLater
    parser_test.go:30: not yet
--- SKIP: TestLater (0.00s)
=== RUN   TestCleanup
=== RUN   TestCleanup/child
    cleanup_test.go:20: leaked a file
--- FAIL: TestCleanup (0.00s)
    --- PASS: TestCleanup/child (0.00s)
FAIL
FAIL	example.com/parser	0.25s
FAIL`;

const COMMIT = `[luke/feat/agent-tool-cards-trial 3f9c2ab] feat(ui): rich tool cards
 3 files changed, 120 insertions(+), 4 deletions(-)
 create mode 100644 packages/ui/src/components/commit-card/commit-card.tsx`;

const VITEST_CARD: CommandCard = {
  kind: COMMAND_CARD.TEST_RESULTS,
  run: {
    passed: 6,
    failed: 1,
    skipped: 1,
    durationMs: 1810,
    failures: [
      {
        name: "src/parser.test.ts > parser > reads jest",
        error: "AssertionError: expected 1 to be 2 // Object.is equality",
      },
    ],
  },
};

it.each<[string, string, string, CommandCard | undefined]>([
  ["vitest", "pnpm exec vitest run src/parser.test.ts", VITEST, VITEST_CARD],
  [
    "jest",
    "npm test",
    JEST,
    {
      kind: COMMAND_CARD.TEST_RESULTS,
      run: {
        passed: 7,
        failed: 1,
        skipped: 0,
        durationMs: 1200,
        failures: [
          {
            name: "parser › reads jest",
            error: "expect(received).toBe(expected) // Object.is equality",
          },
        ],
      },
    },
  ],
  [
    "pytest",
    "python -m pytest",
    PYTEST,
    {
      kind: COMMAND_CARD.TEST_RESULTS,
      run: {
        passed: 7,
        failed: 1,
        skipped: 0,
        durationMs: 120,
        failures: [{ name: "tests/test_parser.py::test_reads_jest", error: "assert 1 == 2" }],
      },
    },
  ],
  [
    "go test -v, counting subtests rather than their parent unless it failed alone",
    "go test -v ./...",
    GO,
    {
      kind: COMMAND_CARD.TEST_RESULTS,
      run: {
        passed: 4,
        failed: 2,
        skipped: 1,
        durationMs: 250,
        failures: [
          { name: "TestReadsJest", error: "parser_test.go:12: expected 2, got 1" },
          { name: "TestCleanup", error: "cleanup_test.go:20: leaked a file" },
        ],
      },
    },
  ],
  [
    "git commit",
    'git add -A && git commit -m "feat(ui): rich tool cards"',
    COMMIT,
    {
      kind: COMMAND_CARD.COMMIT,
      commit: {
        hash: "3f9c2ab",
        branch: "luke/feat/agent-tool-cards-trial",
        message: "feat(ui): rich tool cards",
        filesChanged: 3,
        insertions: 120,
        deletions: 4,
      },
    },
  ],
  ["a commit's words from a command that is not git", "cat notes.txt", COMMIT, undefined],
  [
    "output no runner or git wrote",
    "git status",
    "On branch main\nnothing to commit, working tree clean",
    undefined,
  ],
])("reads %s", (_, command, output, card) => {
  expect(commandCard(command, output)).toEqual(card);
});

/** How many characters of a long output a transcript page carries at each end (`part-cut.ts`). */
const END_CHARS = 2048;

/** A run whose output is past a page's bound: two hundred lines before the runner's own words. */
function long(line: (at: number) => string, words: string): string {
  return `${Array.from({ length: 200 }, (_, at) => line(at)).join("\n")}${words}`;
}

it.each<[string, string, string, CommandCard | undefined]>([
  [
    "a long vitest run's two ends, cut from the record eve's shell stores, read as its card",
    "pnpm test",
    JSON.stringify({
      stdout: long((at) => ` ✓ src/rows.test.ts > row ${at} 1ms`, VITEST),
      stderr: "",
      exitCode: 1,
    }),
    VITEST_CARD,
  ],
  [
    "a long go run's two ends read as no card, since they would miscount it",
    "go test -v ./...",
    long((at) => `--- PASS: TestRow${at} (0.00s)`, GO),
    undefined,
  ],
])("%s", (_, command, stored, card) => {
  const view = toolCallView({ tool: "bash", input: { command }, output: undefined });
  expect(cutCallCard(view, stored.slice(0, END_CHARS), stored.slice(-END_CHARS))).toEqual(card);
});
