import { RETIRED_TOOL } from "@luke/features/agent-tools";
import { isSecretFile, type ShownCode, shownCodeSchema } from "@luke/features/task-wire";
import { Result, Schema } from "effect";
import { ACTION_RESULT_STATUS, type StoredToolPart, TOOL_PART_STATE } from "../core.js";

/**
 * show-code.ts -- the code an agent's `show_code` call put on the developer's screen, as its journaled answer is read back.
 *
 * No agent is offered `show_code` now (`@luke/features/agent-tools`'s
 * `RETIRED_TOOL`), but a call journaled while it was offered still carries
 * its lines and note in its answer. On a call, the voice's follow reads them
 * off the turn's journal mid-turn (`projectTurnEvents`); off a call the Code
 * tab reads every answered call of a conversation (`task-work-store.ts`'s
 * `shownCodeIn`). Nothing on the Mac reads a file.
 */

/** The name a journaled `show_code` call is stored under. */
export const SHOW_CODE_TOOL_NAME = RETIRED_TOOL.SHOW_CODE;

/** The call's answer as the journal holds it: the lines shown, under the status the model read. */
const SHOW_CODE_ANSWER = Schema.Struct({
  status: Schema.Literal(ACTION_RESULT_STATUS.ACCEPTED),
  code: shownCodeSchema,
});

// Note that a journaled call's output is the stored row's, which the AI SDK types as unknown.
const readShownCode = Schema.decodeUnknownResult(SHOW_CODE_ANSWER);

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
