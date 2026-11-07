/**
 * memory-provenance.ts -- whether a coding agent's turn may keep a memory: never one an automation opened, nor one that read the web.
 *
 * What the workspace keeps is meant to be what a member settled, so where a
 * turn's words came from decides whether it may keep anything, whatever the
 * words are (`memory-tools.ts`'s `runAgentRemember`). A turn an automation's
 * run opened has no member behind it: its
 * line is the automation's prompt, and a webhook's or an integration's body
 * may ride in it. A turn that read the web has a page's words in its
 * context, which anyone could have written. Both are read from the store's
 * record of the turn under way, the agent's newest, so every runtime is held
 * to the one rule alike: the line that opened
 * it, by the sender its row keeps (`MESSAGE_SENDER.AUTOMATION`), or by
 * keeping none on an agent an automation started, and its
 * journal, by the calls of any web read it holds, our own page read,
 * the retired runtime's provider-run search, the agent's browser, and Claude Code's and
 * Codex's own. Note that a web read the relay has not yet written, such as
 * one made in the same step as the remember, is not seen, because the
 * journal is what the turn has recorded so far; and that a worker's read is
 * its own conversation's, not the turn's. An agent with no turn under way,
 * as a call replayed after its turn settled, is refused nothing here.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import {
  type Agent,
  lineSendersOf,
  RUNNING_TURN_STATUSES,
} from "@repo/database/models/agent-store";
import {
  latestTurnsOf,
  listTurnOpeners,
  readMessageByClientId,
} from "@repo/database/models/message-reads";
import { MESSAGE_SENDER } from "@repo/database/storage-vocabulary";
import { AGENT_TOOL, CLAUDE_CODE_TOOL, CODEX_TOOL } from "@repo/features/agent-tools";
import { automationRun } from "@repo/features/model-label";
import { toolPartName } from "@repo/wire/ui-messages";
import { Effect } from "effect";
import type { StoreFailure } from "../http/store-failure.js";
import { CODER_TOOL_SET, RETIRED_CODER_TOOL } from "./coder-host/tool-set.js";

/** Why a turn may keep no memory, in words the model can act on. */
export const MEMORY_PROVENANCE_REFUSAL = {
  AUTOMATION:
    "Not remembered: an automation opened this turn, so no member " +
    "settled what it holds. Keep a fact on a turn a member's own words open, if it still matters then.",
  WEB_READ:
    "Not remembered: this turn read the web, and a page's words are no settled fact of the " +
    "team's. Keep a fact on a later turn, from what a member said or the code shows.",
  UNREADABLE:
    "Not remembered: where this turn's words came from could not be read. Carry on without it.",
} as const;

/** Every tool that reads the public web, under each name a journal stores a call of it. */
const WEB_READS: ReadonlySet<string> = new Set([
  AGENT_TOOL.READ_WEB_PAGE,
  AGENT_TOOL.WEB_SEARCH,
  AGENT_TOOL.BROWSER,
  RETIRED_CODER_TOOL.WEB_FETCH,
  RETIRED_CODER_TOOL.SEARCH_WEB,
  CLAUDE_CODE_TOOL.WEB_FETCH,
  CLAUDE_CODE_TOOL.WEB_SEARCH,
  CODEX_TOOL.WEB_SEARCH,
]);

/** The tool a journal's part calls, a dynamic tool's by its own name; none for a part that calls none. */
function calledTool(part: {
  readonly type: string;
  readonly toolName?: unknown;
}): string | undefined {
  if (part.type === "dynamic-tool")
    return typeof part.toolName === "string" ? part.toolName : undefined;
  return toolPartName(part.type);
}

/**
 * Whether a line of the agent's conversation is an automation's run: by the
 * sender its row keeps, or, on an agent an automation started, a line that
 * kept none. Note that the second is the first line of an agent from
 * before the native harnesses that an automation started, because the
 * retired runtime's session took it as it opened and its relay wrote it
 * with no sender (`coder-host/start.ts`), while every line
 * a member sends keeps theirs.
 */
const automationLine = (agent: Agent, messageId: string) =>
  Effect.map(
    lineSendersOf({ userId: agent.userId, conversationId: agent.conversationId }, [messageId]),
    (senders) => {
      const sent = senders.get(messageId);
      return sent === undefined
        ? automationRun(agent) !== undefined
        : sent.kind === MESSAGE_SENDER.AUTOMATION;
    },
  );

/** Whether the turn's opening line was an automation's run. */
const openedByAutomation = (agent: Agent, turnId: string) =>
  Effect.gen(function* () {
    const openers = yield* listTurnOpeners(agent.userId, agent.conversationId, CODER_TOOL_SET, [
      turnId,
    ]);
    if (!openers.ok) return undefined;
    const opener = openers.value[0];
    if (opener === undefined) return false;
    return yield* automationLine(agent, opener.id);
  });

/** Whether the turn's journal, which shares the turn's id as its key, holds a call of a web read. */
const readTheWeb = (agent: Agent, turnId: string) =>
  Effect.map(
    readMessageByClientId(agent.userId, agent.conversationId, CODER_TOOL_SET, turnId),
    (journal) => {
      if (!journal.ok) return undefined;
      return journal.value.some((record) =>
        record.message.parts.some((part) => WEB_READS.has(calledTool(part) ?? "")),
      );
    },
  );

/**
 * Why the agent's turn under way may keep no memory, or nothing where it
 * may, as above; a record that does not read refuses, since nothing then
 * says the turn's words were a member's.
 */
export function rememberRefusal(
  agent: Agent,
): Effect.Effect<string | undefined, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const turn = (yield* latestTurnsOf(agent.userId, [agent.conversationId])).get(
      agent.conversationId,
    );
    if (turn === undefined || !RUNNING_TURN_STATUSES.has(turn.status)) return undefined;
    const [automation, web] = yield* Effect.all(
      [openedByAutomation(agent, turn.id), readTheWeb(agent, turn.id)],
      { concurrency: "unbounded" },
    );
    if (automation === true) return MEMORY_PROVENANCE_REFUSAL.AUTOMATION;
    if (web === true) return MEMORY_PROVENANCE_REFUSAL.WEB_READ;
    if (automation === undefined || web === undefined) return MEMORY_PROVENANCE_REFUSAL.UNREADABLE;
    return undefined;
  });
}
