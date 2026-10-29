import { expect, it } from "vitest";
import { COMMAND_CARD, type CommandCard, commandCard } from "./command-card-model.js";

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
FAIL
FAIL	example.com/parser	0.25s
FAIL`;

const COMMIT = `[luke/feat/agent-tool-cards-trial 3f9c2ab] feat(ui): rich tool cards
 3 files changed, 120 insertions(+), 4 deletions(-)
 create mode 100644 packages/ui/src/components/commit-card/commit-card.tsx`;

it.each<[string, string, string, CommandCard | undefined]>([
  [
    "vitest",
    "pnpm exec vitest run src/parser.test.ts",
    VITEST,
    {
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
    },
  ],
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
    "go test -v, counting subtests rather than their parent",
    "go test -v ./...",
    GO,
    {
      kind: COMMAND_CARD.TEST_RESULTS,
      run: {
        passed: 3,
        failed: 1,
        skipped: 1,
        durationMs: 250,
        failures: [{ name: "TestReadsJest", error: "parser_test.go:12: expected 2, got 1" }],
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
