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
const subagent = (name: string): Block => ({ part: ROW_PART.SUBAGENT, name });

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
