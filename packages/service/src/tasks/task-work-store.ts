import { listCodingAgentLines } from "@luke/database/models/coding-agent-store";
import { listJournalsCalling, type StoredMessageRecord } from "@luke/database/models/message-reads";
import { readTaskHeader, type TaskStoreEffect } from "@luke/database/models/task-store";
import type { TaskShownCode } from "@luke/features/tasks-view";
import { Effect, Option } from "effect";
import { CODER_TOOL_SET } from "../agents/coder-host/tool-set.js";
import { isStoredToolPart, storedToolName } from "../core.js";
import { SHOW_CODE_TOOL, shownCodeOf } from "./show-code.js";

/**
 * task-work-store.ts -- every code the task's agents showed on it.
 *
 * The code is every answered `show_code` call of each agent on the task,
 * archived ones included, read from that agent's own conversation under the
 * member who started it, typed turns and spoken ones alike, each
 * named by its agent, by the same rule that puts a call's code on screen
 * (`show-code.ts`), so nothing the call refused, and no secret file, is read
 * back. The task is read under the account first, so a task of a workspace
 * the account is not in reads as no task, exactly as in `task-store.ts`.
 * Nothing is written here.
 */

/** How many agents' journals are read at once: under the web pool's five connections, so one read leaves room for the rest of its instance. */
const JOURNAL_READ_CONCURRENCY = 3;

/** Every code the journals' answered `show_code` calls put on screen, in the order the calls were made, the journals oldest first, each under the agent named. */
function shownCodeIn(journals: readonly StoredMessageRecord[], agentId: string): TaskShownCode[] {
  return journals.flatMap((journal) =>
    journal.message.parts.filter(isStoredToolPart).flatMap((part) => {
      const code = storedToolName(part) === SHOW_CODE_TOOL.name ? shownCodeOf(part) : undefined;
      return code === undefined
        ? []
        : [
            {
              callId: part.toolCallId,
              turnId: journal.clientId,
              shownAt: journal.createdAt.getTime(),
              agentId,
              code,
            },
          ];
    }),
  );
}

/**
 * Every code the task's agents showed, archived agents' included, oldest
 * first, each read from the agent's own conversation under the member who
 * started it; an agent whose journals do not read shows none. The agents are
 * listed under the account, so a task the account does not reach has none.
 * Note that the sort is stable, so the calls of one turn keep their order.
 */
const agentsShownCode = Effect.fnUntraced(function* (userId: string, taskId: string) {
  const agents = yield* listCodingAgentLines(userId, taskId, { includeArchived: true });
  const read = yield* Effect.forEach(
    agents,
    (agent) =>
      Effect.map(
        listJournalsCalling(
          agent.userId,
          agent.conversationId,
          CODER_TOOL_SET,
          SHOW_CODE_TOOL.name,
        ),
        (journals) => (journals.ok ? shownCodeIn(journals.value, agent.id) : []),
      ),
    { concurrency: JOURNAL_READ_CONCURRENCY },
  );
  return read.flat().sort((one, other) => one.shownAt - other.shownAt);
});

/** Every code shown on the task, oldest first, as the Code tab draws it: every agent's on the task; nothing where the account reaches no such task. */
export function readTaskCode(
  userId: string,
  taskId: string,
): TaskStoreEffect<Option.Option<{ readonly code: readonly TaskShownCode[] }>> {
  return Effect.gen(function* () {
    const task = yield* readTaskHeader(userId, taskId);
    if (Option.isNone(task)) return Option.none();
    return Option.some({ code: yield* agentsShownCode(userId, taskId) });
  });
}
