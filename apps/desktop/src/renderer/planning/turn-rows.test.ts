import assert from "node:assert/strict";
import { test } from "vitest";
import { ROW_PART, type RowReading, TURN_ROW, type TurnRow, turnRows } from "./turn-rows";

/** A block as a tab hands it to the fold: what it is to the fold, its name, and whether it still moves. */
interface Block {
  readonly part: (typeof ROW_PART)[keyof typeof ROW_PART];
  readonly name: string;
  readonly running?: boolean;
}

const READING: RowReading<Block> = {
  key: (block) => block.name,
  part: (block) => block.part,
  running: (block) => block.running === true,
};

const call = (name: string): Block => ({ part: ROW_PART.CALL, name });
const thought = (name: string): Block => ({ part: ROW_PART.NOTE, name });
const words = (name: string): Block => ({ part: ROW_PART.WORDS, name });
const subagent = (name: string, running = false): Block => ({
  part: ROW_PART.SUBAGENT,
  name,
  running,
});

/** A turn's rows as a reader scans them: each block by name, each group's line, what it holds, and whether it is open and running, each fold's line and what it holds. */
function scanned(rows: readonly TurnRow<Block>[]): unknown[] {
  return rows.map((row) => {
    if (row.kind === TURN_ROW.BLOCK) return row.block.name;
    if (row.kind === TURN_ROW.GROUP) {
      return [
        row.summary,
        row.blocks.map((block) => block.name),
        { open: row.open, running: row.running },
      ];
    }
    return [row.summary, scanned(row.rows)];
  });
}

/** The rows of a turn of `blocks`, moving or finished. */
function rowsOf(blocks: readonly Block[], moving: boolean, said = false) {
  return scanned(
    turnRows(blocks, READING, { key: "turn", moving, done: !moving, grouped: true, said }),
  );
}

test("a thought between two calls joins their group, whose line counts the calls alone", () => {
  assert.deepEqual(
    rowsOf([call("ls"), thought("Read the one file."), call("cat"), words("One file.")], true),
    [
      ["2 tools called", ["ls", "Read the one file.", "cat"], { open: false, running: false }],
      "One file.",
    ],
  );
});

test("a thought just before a call is one group with it, and the open group at a moving turn's end shows the thought that follows its call", () => {
  assert.deepEqual(rowsOf([thought("Find the invites."), call("ls"), words("Looking.")], true), [
    ["1 tool called", ["Find the invites.", "ls"], { open: false, running: false }],
    "Looking.",
  ]);
  assert.deepEqual(rowsOf([words("Looking."), call("ls"), thought("Now the routes.")], true), [
    "Looking.",
    ["1 tool called", ["ls", "Now the routes."], { open: true, running: false }],
  ]);
});

test("a turn that only thought and answered has no group, moving or finished", () => {
  const blocks = [thought("They said hello."), words("Hello."), thought("Nothing to look up.")];
  assert.deepEqual(rowsOf(blocks, true), ["They said hello.", "Hello.", "Nothing to look up."]);
  assert.deepEqual(rowsOf([...blocks, words("What are we building?")], false), [
    "They said hello.",
    "Hello.",
    "Nothing to look up.",
    "What are we building?",
  ]);
});

test("a subagent between two calls joins their group, whose line counts it apart from the calls", () => {
  assert.deepEqual(
    rowsOf([call("ls"), subagent("Compare the queues."), call("cat"), words("Done.")], true),
    [
      [
        "2 tools called, 1 subagent",
        ["ls", "Compare the queues.", "cat"],
        { open: false, running: false },
      ],
      "Done.",
    ],
  );
  assert.deepEqual(
    rowsOf(
      [subagent("Read the routes."), subagent("Read the store."), words("Both are back.")],
      true,
    ),
    [
      ["2 subagents", ["Read the routes.", "Read the store."], { open: false, running: false }],
      "Both are back.",
    ],
  );
});

test("a group holding a subagent still at work is running, and stays open at a moving turn's end until the turn moves on", () => {
  const working = [call("ls"), subagent("Compare the queues.", true)];
  assert.deepEqual(rowsOf(working, true), [
    ["1 tool called, 1 subagent", ["ls", "Compare the queues."], { open: true, running: true }],
  ]);
  assert.deepEqual(rowsOf([...working, words("The worker is on it.")], true), [
    ["1 tool called, 1 subagent", ["ls", "Compare the queues."], { open: false, running: true }],
    "The worker is on it.",
  ]);
});

test("a finished turn folds everything ahead of its last words under the same line as before, thoughts and subagents inside it on rows of their own", () => {
  assert.deepEqual(
    rowsOf(
      [
        thought("Find the invites."),
        call("ls"),
        subagent("Compare the queues."),
        thought("Read it."),
        call("cat"),
        words("Seven days."),
      ],
      false,
    ),
    [
      [
        "2 tool calls, 1 subagent",
        ["Find the invites.", "ls", "Compare the queues.", "Read it.", "cat"],
      ],
      "Seven days.",
    ],
  );
});

test("a finished turn whose words were said aloud folds all of its work under that same line, and while it moves it groups as any turn does", () => {
  const blocks = [
    thought("Find the invites."),
    call("ls"),
    subagent("Compare the queues."),
    thought("Read it."),
    call("cat"),
  ];
  assert.deepEqual(rowsOf(blocks, false, true), [
    [
      "2 tool calls, 1 subagent",
      ["Find the invites.", "ls", "Compare the queues.", "Read it.", "cat"],
    ],
  ]);
  assert.deepEqual(rowsOf(blocks, true, true), [
    [
      "2 tools called, 1 subagent",
      ["Find the invites.", "ls", "Compare the queues.", "Read it.", "cat"],
      { open: true, running: false },
    ],
  ]);
});
