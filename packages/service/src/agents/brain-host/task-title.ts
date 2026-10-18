import type { DatabaseServices, QueryError } from "@luke/database/core/query";
import { nameUntitledTask, type StoredTask } from "@luke/database/models/task-store";
import type { ConversationTarget } from "@luke/database/models/writer";
import { UNTITLED_TASK_NAME } from "@luke/features/task-wire";
import type { LanguageModel } from "ai";
import { Effect, Option, type Schema } from "effect";
import { HOSTED_TOOL_SET } from "../../tasks/brain-tool-set.js";
import { titleOfConversation } from "../coder-host/title.js";

/**
 * task-title.ts -- an untitled task's name, generated from its conversation with Luke as each of its first turns completes.
 *
 * The same call that names a coding agent (`coder-host/title.ts`), over the
 * task's conversation under the brain's tools: as one of its first turns
 * completes, a task still Untitled is named from the developer's first and
 * latest words and Luke's latest answer, and named once
 * (`task-store.ts`'s `nameUntitledTask`), as its first agent's title would
 * name it. A task a member named, or the model already did, asks
 * nothing; a call that answers nothing writes nothing, and the next turn
 * asks again.
 */

/**
 * The task's name generated and filled where it is still Untitled: `caller`
 * is the member the turn ran for, whom the task is reached as, and `target`
 * the conversation its rows are read under.
 */
export function titleTask(
  model: LanguageModel,
  caller: string,
  target: ConversationTarget,
  task: StoredTask,
): Effect.Effect<void, QueryError | Schema.SchemaError, DatabaseServices> {
  return Effect.gen(function* () {
    if (task.task.name !== UNTITLED_TASK_NAME) return;
    const title = yield* titleOfConversation(model, target, HOSTED_TOOL_SET);
    if (Option.isNone(title)) return;
    yield* nameUntitledTask(caller, task.task.id, title.value);
  });
}
