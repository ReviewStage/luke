import {
  CODE_PATH_MAX_CHARS,
  type CodeRef,
  codeNoteSchema,
  codeRefSchema,
  codeWindow,
  commitShaSchema,
  isSecretFile,
  SHOWN_CODE_BOUNDS,
  type ShownCode,
  shownCodeSchema,
} from "@luke/features/task-wire";
import { describeWire } from "@luke/wire/effect";
import { Data, Effect, Result, Schema } from "effect";
import { AGENT_TOOL } from "../agents/agent-runtime/tools.js";
import {
  checkedOutSandbox,
  REPOSITORY_REFUSAL,
  REPOSITORY_SANDBOX_CONTRACT,
  type RepositoryCall,
  type RepositoryRefusal,
  type RepositoryShellServices,
  runInSandbox,
} from "../agents/repository-shell.js";
import {
  ACTION_RESULT_STATUS,
  type StoredToolPart,
  TOOL_PART_STATE,
  type UnparsedWireValue,
  type WireRecord,
} from "../core.js";
import {
  SHOWN_FILE_BOUNDS,
  SHOWN_FILE_REFUSAL,
  type ShownFileFacts,
  type ShownFileRefusal,
  shownFileRefusal,
  shownLines,
} from "./shown-file.js";

/**
 * show-code.ts -- the brain's `show_code` tool: code of the task's repository put on the developer's screen as Luke talks about it.
 *
 * The call reads the lines itself: from the brain session's sandbox, on
 * the same checkout of the task's repository `run_in_repository` reads
 * (`repository-shell.ts`), a window of the file around the lines pointed at,
 * cut to `SHOWN_CODE_BOUNDS`. The model writes a note beside them, a
 * sentence or two on what the lines do for the task and what to notice, so
 * the Code tab reads as a walkthrough rather than bare code. The lines and
 * the note are the call's answer, so the store journals them with the
 * call, the voice's follow reads them off the journal mid-turn
 * (`projectTurnEvents`), and the voice service holds them until Luke next
 * starts to speak, then sends them to the developer's Mac, which draws
 * them. Nothing on the Mac reads a file. A read that fails answers
 * `rejected` and says why, so nothing unread is ever described as shown.
 */

/** Why a call showed nothing, in words the model can act on. */
export const SHOW_CODE_REFUSAL = {
  UNREADABLE:
    "Not shown: name a path, and both lines or neither, the first no later than the last and at most 200 apart.",
  NO_NOTE: `Not shown: write a note of one or two sentences, at most ${SHOWN_CODE_BOUNDS.NOTE_CHARS} characters, on what these lines do and what to notice.`,
  SECRET: "Not shown: that file holds secrets, such as a `.env`, and is never put on screen.",
  MISSING: "Not shown: no such file in the repository.",
  NOT_TEXT: "Not shown: that file is too large to show, or is not text.",
  READ_FAILED: "Not shown: the file could not be read just now. The call may be made again.",
} as const;

/** The verb `show_code` puts ahead of a reason the checkout could not be reached. */
const NOT_SHOWN = "Not shown: ";

/** Why the file could not be shown once the checkout stood, as the reason the model reads. */
class ShowCodeRefusal extends Data.TaggedError("ShowCodeRefusal")<{ readonly reason: string }> {}

const { PATH: SANDBOX_PATH, VARIABLE: SANDBOX_VARIABLE } = REPOSITORY_SANDBOX_CONTRACT;

/**
 * The file's facts, as `shown-file.ts` decides on them, printed on one line:
 * whether it is a regular file inside the checkout, its bytes, whether a
 * NUL stands among its first bytes, how many lines it has, counted as the
 * screen counts them, one more than its newlines, and the commit the
 * checkout stands at, which the File tab reads the file at. The path is
 * resolved with every link followed and must land inside the checkout root, and
 * nothing of it is spliced into shell text: the script reads it from its
 * variable. A file that is no regular file inside the checkout prints
 * nothing else, and a file past the size bound is not counted.
 */
const FILE_PROBE_SCRIPT = [
  'root="$(realpath -- .)"',
  `target="$(realpath -e -- "$${SANDBOX_VARIABLE.FILE}" 2>/dev/null)" || { echo 0 0 0 0; exit 0; }`,
  'case "$target" in "$root"/*) ;; *) echo 0 0 0 0; exit 0 ;; esac',
  '[ -f "$target" ] || { echo 0 0 0 0; exit 0; }',
  'bytes="$(wc -c < "$target")"',
  `if [ "$(head -c ${SHOWN_FILE_BOUNDS.TEXT_PROBE_BYTES} -- "$target" | tr -d '\\000' | wc -c)" -eq "$(head -c ${SHOWN_FILE_BOUNDS.TEXT_PROBE_BYTES} -- "$target" | wc -c)" ]; then binary=0; else binary=1; fi`,
  `if [ "$bytes" -le ${SHOWN_FILE_BOUNDS.MAX_FILE_BYTES} ]; then lines=$(( $(wc -l < "$target") + 1 )); else lines=0; fi`,
  'echo 1 "$bytes" "$binary" "$lines" "$(git rev-parse HEAD 2>/dev/null)"',
].join("\n");

const readCommit = Schema.decodeUnknownResult(commitShaSchema);

/** The probe's line read back: the facts it found, the line count, and the commit where it named one, or nothing where it does not read. */
function probedFacts(
  path: string,
  stdout: string,
): { facts: ShownFileFacts; lineCount: number; commit: string | undefined } | undefined {
  const words = stdout.trim().split(/\s+/u);
  const fields = words.slice(0, 4).map((field) => Number.parseInt(field, 10));
  const [regular, bytes, binary, lineCount] = fields;
  if (words.length < 4 || words.length > 5) return undefined;
  if (fields.some((field) => !Number.isInteger(field))) return undefined;
  if (
    regular === undefined ||
    bytes === undefined ||
    binary === undefined ||
    lineCount === undefined
  ) {
    return undefined;
  }
  // Note that the lines are shown even where git names no commit, and the File tab then reads the default branch.
  const commit = Result.getOrUndefined(readCommit(words[4]));
  return {
    facts: { path, regular: regular === 1, bytes, binary: binary === 1 },
    lineCount,
    commit,
  };
}

/** The words the model reads for each reason the shared rule refuses a file. */
const REFUSAL_WORDS = {
  [SHOWN_FILE_REFUSAL.SECRET]: SHOW_CODE_REFUSAL.SECRET,
  [SHOWN_FILE_REFUSAL.MISSING]: SHOW_CODE_REFUSAL.MISSING,
  [SHOWN_FILE_REFUSAL.NOT_TEXT]: SHOW_CODE_REFUSAL.NOT_TEXT,
} as const satisfies Record<ShownFileRefusal, string>;

/** The window's lines, first to last, as the file holds them. */
const FILE_WINDOW_SCRIPT = `sed -n "$\{${SANDBOX_VARIABLE.FIRST_LINE}},$\{${SANDBOX_VARIABLE.LAST_LINE}}p" < "$${SANDBOX_VARIABLE.FILE}"`;

const lineNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const SHOW_CODE_PLACE = {
  path: describeWire(
    Schema.String.check(Schema.isNonEmpty(), Schema.isMaxLength(CODE_PATH_MAX_CHARS)),
    'The file, relative to the repository\'s root, such as "src/members/invite.ts".',
  ),
  startLine: Schema.optionalKey(
    describeWire(lineNumber, "The first line you are talking about, counted from 1."),
  ),
  endLine: Schema.optionalKey(
    describeWire(
      lineNumber,
      "The last line you are talking about; the same as startLine for one line. Leave both out to show the file from its top.",
    ),
  ),
};

const SHOW_CODE_NOTE = describeWire(
  codeNoteSchema,
  "One or two plain sentences, shown above the lines, for the developer reading the plan later: what this code does for the plan, and what to notice in it. No headings, and never a secret.",
);

const SHOW_CODE_INPUT = Schema.Struct({ ...SHOW_CODE_PLACE, note: SHOW_CODE_NOTE });

/**
 * A call as its stored row is read back. Note that the note is optional
 * here, because calls journaled before notes were asked for carry none,
 * and a row its tool's schema refuses refuses the conversation's whole page.
 */
const SHOW_CODE_ROW_INPUT = Schema.Struct({
  ...SHOW_CODE_PLACE,
  note: Schema.optionalKey(SHOW_CODE_NOTE),
});

const readNote = Schema.decodeUnknownResult(Schema.Struct({ note: codeNoteSchema }));

// Note that the wire's own reference is what is read, so a range out of order or too long is no reference at all.
const readShownRef = Schema.decodeUnknownResult(codeRefSchema);

/** The call's answer as the journal holds it: the lines shown, under the status the model read. */
const SHOW_CODE_ANSWER = Schema.Struct({
  status: Schema.Literal(ACTION_RESULT_STATUS.ACCEPTED),
  code: shownCodeSchema,
});

// Note that a journaled call's output is the stored row's, which the AI SDK types as unknown.
const readShownCode = Schema.decodeUnknownResult(SHOW_CODE_ANSWER);

/** The tool as the brain is offered it: its name, its words, and its input schema. */
export const SHOW_CODE_TOOL = {
  name: AGENT_TOOL.SHOW_CODE,
  description:
    "Put lines of a file in the task's repository on the developer's screen, lit, as Luke starts " +
    "saying your next words. Call it just before the queue_question or the return that talks " +
    "about those lines, with the lines you found through run_in_repository. Point at the few " +
    "lines that matter, at most 200, and say in the note why you are showing them. Answers " +
    "`accepted` with the lines as shown, or `rejected` and why nothing was shown.",
  inputSchema: SHOW_CODE_INPUT,
  storedInputSchema: SHOW_CODE_ROW_INPUT,
} as const;

/**
 * The code a journaled call put on screen, or nothing for a call still
 * running, refused, or whose answer does not read; code is told once its
 * lines are on the journal. Only an accepted answer reads, so what the
 * checkout refused (a path that leaves it, a missing, binary, or oversized
 * file) is never shown. Note that the secret rule is held to again here,
 * because a task's work is read back from its journal for as long as the
 * journal stands, under whatever rule this build keeps.
 */
export function shownCodeOf(part: StoredToolPart): ShownCode | undefined {
  if (part.state !== TOOL_PART_STATE.OUTPUT_AVAILABLE) return undefined;
  const code = Result.getOrUndefined(readShownCode(part.output))?.code;
  return code === undefined || isSecretFile(code.ref.path) ? undefined : code;
}

function rejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** The lines read from the checkout for `ref`, or the refusal that stopped the read. */
const readLines = /* @__PURE__ */ Effect.fn("web/showCodeRead")(function* (
  call: RepositoryCall,
  ref: CodeRef,
): Effect.fn.Return<ShownCode, RepositoryRefusal | ShowCodeRefusal, RepositoryShellServices> {
  const { sandbox, repository } = yield* checkedOutSandbox(call);
  const probed = yield* runInSandbox(
    sandbox,
    {
      command: FILE_PROBE_SCRIPT,
      workingDirectory: SANDBOX_PATH.CHECKOUT,
      env: { [SANDBOX_VARIABLE.FILE]: ref.path },
    },
    REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE,
  );
  const probedFile = probed.exitCode === 0 ? probedFacts(ref.path, probed.stdout) : undefined;
  if (probedFile === undefined) {
    return yield* new ShowCodeRefusal({ reason: SHOW_CODE_REFUSAL.READ_FAILED });
  }
  const refusal = shownFileRefusal(probedFile.facts);
  if (refusal !== undefined) return yield* new ShowCodeRefusal({ reason: REFUSAL_WORDS[refusal] });
  const { lineCount, commit } = probedFile;
  if (lineCount < 1) return yield* new ShowCodeRefusal({ reason: SHOW_CODE_REFUSAL.READ_FAILED });
  const window = codeWindow(ref, lineCount);
  const read = yield* runInSandbox(
    sandbox,
    {
      command: FILE_WINDOW_SCRIPT,
      workingDirectory: SANDBOX_PATH.CHECKOUT,
      env: {
        [SANDBOX_VARIABLE.FILE]: ref.path,
        [SANDBOX_VARIABLE.FIRST_LINE]: String(window.first),
        [SANDBOX_VARIABLE.LAST_LINE]: String(window.last),
      },
    },
    REPOSITORY_REFUSAL.SANDBOX_UNAVAILABLE,
  );
  if (read.exitCode !== 0) {
    return yield* new ShowCodeRefusal({ reason: SHOW_CODE_REFUSAL.READ_FAILED });
  }
  return {
    ref,
    repository,
    ...(commit === undefined ? undefined : { commit }),
    firstLine: window.first,
    lineCount,
    lines: shownLines(read.stdout, window.last - window.first + 1),
  };
});

/**
 * One call of `show_code`: the lines read from the task's checkout and
 * answered as shown with the model's note, or `rejected` and why. A reason
 * the checkout could not be reached is the repository's own, worded as
 * nothing shown.
 */
export function runShowCode(
  call: RepositoryCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, RepositoryShellServices> {
  const shown = Effect.gen(function* () {
    const read = readShownRef(input);
    if (Result.isFailure(read)) return rejected(SHOW_CODE_REFUSAL.UNREADABLE);
    const ref = read.success;
    if (isSecretFile(ref.path)) return rejected(SHOW_CODE_REFUSAL.SECRET);
    // Note that a note of blanks alone is no note, because the card would draw it empty.
    const note = Result.getOrUndefined(readNote(input))?.note.trim();
    if (note === undefined || note === "") return rejected(SHOW_CODE_REFUSAL.NO_NOTE);
    const code = yield* readLines(call, ref);
    return { status: ACTION_RESULT_STATUS.ACCEPTED, code: { ...code, note } } satisfies WireRecord;
  });
  return shown.pipe(
    Effect.catchTag("ShowCodeRefusal", (refusal) => Effect.succeed(rejected(refusal.reason))),
    Effect.catchTag("RepositoryRefusal", (refusal) =>
      Effect.succeed(rejected(`${NOT_SHOWN}${refusal.reason}`)),
    ),
  );
}
