import {
  CODE_PATH_MAX_CHARS,
  type CodeRef,
  codeRefSchema,
  codeWindow,
  SHOWN_CODE_BOUNDS,
  type ShownCode,
  shownCodeSchema,
} from "@sidecar/hosted/plan-wire";
import { describeWire } from "@sidecar/wire/effect";
import { Data, Effect, Result, Schema } from "effect";
import {
  ACTION_RESULT_STATUS,
  type StoredToolPart,
  TOOL_PART_STATE,
  type UnparsedWireValue,
  type WireRecord,
} from "../core.js";
import {
  checkedOutSandbox,
  REPOSITORY_REFUSAL,
  REPOSITORY_SANDBOX_CONTRACT,
  type RepositoryCall,
  type RepositoryRefusal,
  type RepositoryShellServices,
  runInSandbox,
} from "./repository-shell.js";

/**
 * show-code.ts -- the planning model's `show_code` tool: code of the plan's repository put on the developer's screen as Luke talks about it.
 *
 * The call reads the lines itself: from the planning session's sandbox, on
 * the same checkout of the plan's repository `run_in_repository` reads
 * (`repository-shell.ts`), a window of the file around the lines pointed at,
 * cut to `SHOWN_CODE_BOUNDS`. The lines are the call's answer, so the store
 * journals them with the call, the voice's follow reads them off the journal
 * mid-turn (`projectTurnEvents`), and the voice service holds them until
 * Luke next starts to speak, then sends them to the developer's Mac, which
 * draws them. Nothing on the Mac reads a file. A read that fails answers
 * `rejected` and says why, so nothing unread is ever described as shown.
 */

/** Why a call showed nothing, in words the model can act on. */
export const SHOW_CODE_REFUSAL = {
  UNREADABLE:
    "Not shown: name a path, and both lines or neither, the first no later than the last and at most 200 apart.",
  SECRET: "Not shown: that file holds secrets, such as a `.env`, and is never put on screen.",
  MISSING: "Not shown: no such file in the repository.",
  NOT_TEXT: "Not shown: that file is too large to show, or is not text.",
  READ_FAILED: "Not shown: the file could not be read just now. The call may be made again.",
} as const;

/** The verb `show_code` puts ahead of a reason the checkout could not be reached. */
const NOT_SHOWN = "Not shown: ";

/** Why the file could not be shown once the checkout stood, as the reason the model reads. */
class ShowCodeRefusal extends Data.TaggedError("ShowCodeRefusal")<{ readonly reason: string }> {}

/** The largest file read at all; a larger one is said to be too large. */
const MAX_FILE_BYTES = 1024 * 1024;

/** How many of a file's first bytes are read to tell text from binary. */
const TEXT_PROBE_BYTES = 8192;

/** A file kept secret, refused wherever it sits in the checkout. */
const SECRET_FILE = /(^|\/)\.env[^/]*$/u;

/** What the file probe answers with its exit code, beside the line count it prints. */
const PROBE_EXIT = {
  /** The path names no regular file inside the checkout: absent, a directory, or a link that leaves it. */
  MISSING: 3,
  /** The file is larger than the screen draws, or holds bytes text never does. */
  NOT_TEXT: 4,
} as const;

const { PATH: SANDBOX_PATH, VARIABLE: SANDBOX_VARIABLE } = REPOSITORY_SANDBOX_CONTRACT;

/**
 * Whether the file can be shown, and how many lines it has, counted as the
 * screen counts them: one more than its newlines. The path is resolved with
 * every link followed and must land inside the checkout root, and nothing
 * of it is spliced into shell text: the script reads it from its variable.
 */
const FILE_PROBE_SCRIPT = [
  'root="$(realpath -- .)"',
  `target="$(realpath -e -- "$${SANDBOX_VARIABLE.FILE}" 2>/dev/null)" || exit ${PROBE_EXIT.MISSING}`,
  `case "$target" in "$root"/*) ;; *) exit ${PROBE_EXIT.MISSING} ;; esac`,
  `[ -f "$target" ] || exit ${PROBE_EXIT.MISSING}`,
  `[ "$(wc -c < "$target")" -le ${MAX_FILE_BYTES} ] || exit ${PROBE_EXIT.NOT_TEXT}`,
  `[ "$(head -c ${TEXT_PROBE_BYTES} -- "$target" | tr -d '\\000' | wc -c)" -eq "$(head -c ${TEXT_PROBE_BYTES} -- "$target" | wc -c)" ] || exit ${PROBE_EXIT.NOT_TEXT}`,
  'echo $(( $(wc -l < "$target") + 1 ))',
].join("\n");

/** The window's lines, first to last, as the file holds them. */
const FILE_WINDOW_SCRIPT = `sed -n "$\{${SANDBOX_VARIABLE.FIRST_LINE}},$\{${SANDBOX_VARIABLE.LAST_LINE}}p" < "$${SANDBOX_VARIABLE.FILE}"`;

const lineNumber = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));

const SHOW_CODE_INPUT = Schema.Struct({
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
});

// Note that the wire's own reference is what is read, so a range out of order or too long is no reference at all.
const readShownRef = Schema.decodeUnknownResult(codeRefSchema);

/** The call's answer as the journal holds it: the lines shown, under the status the model read. */
const SHOW_CODE_ANSWER = Schema.Struct({
  status: Schema.Literal(ACTION_RESULT_STATUS.ACCEPTED),
  code: shownCodeSchema,
});

// Note that a journaled call's output is the stored row's, which the AI SDK types as unknown.
const readShownCode = Schema.decodeUnknownResult(SHOW_CODE_ANSWER);

/** The tool as a planning model is offered it: its name, its words, and its input schema. */
export const SHOW_CODE_TOOL = {
  name: "show_code",
  description:
    "Put lines of a file in the plan's repository on the developer's screen, lit, as Luke starts " +
    "saying your next words. Call it just before the queue_question or the return that talks " +
    "about those lines, with the lines you found through run_in_repository. Point at the few " +
    "lines that matter, at most 200. Answers `accepted` with the lines as shown, or `rejected` " +
    "and why nothing was shown.",
  inputSchema: SHOW_CODE_INPUT,
} as const;

/**
 * The code a journaled call put on screen, or nothing for a call still
 * running, refused, or whose answer does not read; code is told once its
 * lines are on the journal.
 */
export function shownCodeOf(part: StoredToolPart): ShownCode | undefined {
  if (part.state !== TOOL_PART_STATE.OUTPUT_AVAILABLE) return undefined;
  return Result.getOrUndefined(readShownCode(part.output))?.code;
}

function rejected(reason: string): WireRecord {
  return { status: ACTION_RESULT_STATUS.REJECTED, reason };
}

/** The refusal a probe's exit code stands for. */
function probeRefusal(exitCode: number): string {
  switch (exitCode) {
    case PROBE_EXIT.MISSING:
      return SHOW_CODE_REFUSAL.MISSING;
    case PROBE_EXIT.NOT_TEXT:
      return SHOW_CODE_REFUSAL.NOT_TEXT;
    default:
      return SHOW_CODE_REFUSAL.READ_FAILED;
  }
}

/** The window's lines as the file holds them, each cut to the bound, and never more than the window asked for. */
function windowLines(stdout: string, count: number): string[] {
  const lines = stdout.split(/\r?\n/u).slice(0, count);
  return lines.map((line) => line.slice(0, SHOWN_CODE_BOUNDS.MAX_LINE_CHARS));
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
  if (probed.exitCode !== 0) {
    return yield* new ShowCodeRefusal({ reason: probeRefusal(probed.exitCode) });
  }
  const lineCount = Number.parseInt(probed.stdout.trim(), 10);
  if (!Number.isInteger(lineCount) || lineCount < 1)
    return yield* new ShowCodeRefusal({ reason: SHOW_CODE_REFUSAL.READ_FAILED });
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
    firstLine: window.first,
    lineCount,
    lines: windowLines(read.stdout, window.last - window.first + 1),
  };
});

/**
 * One call of `show_code`: the lines read from the plan's checkout and
 * answered as shown, or `rejected` and why. A reason the checkout could not
 * be reached is the repository's own, worded as nothing shown.
 */
export function runShowCode(
  call: RepositoryCall,
  input: UnparsedWireValue,
): Effect.Effect<WireRecord, never, RepositoryShellServices> {
  const shown = Effect.gen(function* () {
    const read = readShownRef(input);
    if (Result.isFailure(read)) return rejected(SHOW_CODE_REFUSAL.UNREADABLE);
    const ref = read.success;
    if (SECRET_FILE.test(ref.path)) return rejected(SHOW_CODE_REFUSAL.SECRET);
    const code = yield* readLines(call, ref);
    return { status: ACTION_RESULT_STATUS.ACCEPTED, code } satisfies WireRecord;
  });
  return shown.pipe(
    Effect.catchTag("ShowCodeRefusal", (refusal) => Effect.succeed(rejected(refusal.reason))),
    Effect.catchTag("RepositoryRefusal", (refusal) =>
      Effect.succeed(rejected(`${NOT_SHOWN}${refusal.reason}`)),
    ),
  );
}
