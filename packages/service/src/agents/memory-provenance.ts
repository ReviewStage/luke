/**
 * memory-provenance.ts -- whether a coding agent's turn may keep a memory: never one an automation opened, nor one that read the web.
 *
 * What the workspace keeps is meant to be what a member settled, so where a
 * turn's words came from decides whether it may keep anything, whatever the
 * words are (`memory-tools.ts`'s `runAgentRemember`). A turn an automation's
 * run opened, its member's operator's heartbeat among them, since that is an
 * ordinary automation aimed at the operator, has no member behind it: its
 * line is the automation's prompt, and a webhook's or an integration's body
 * may ride in it. A turn that read the web has a page's words in its
 * context, which anyone could have written. Both are read from the store's
 * record of the turn under way, the agent's newest, so every runtime is held
 * to the one rule, eve's and a native harness's alike: the line that opened
 * it, by the sender its row keeps (`MESSAGE_SENDER.AUTOMATION`), or by
 * keeping none on an agent an automation started, and its
 * journal, by the calls of any web read it holds, Luke's own page read,
 * eve's provider-run search, the agent's browser, and Claude Code's and
 * Codex's own. Note that a web read the relay has not yet written, such as
 * one made in the same step as the remember, is not seen, because the
 * journal is what the turn has recorded so far; and that a worker's read is
 * its own conversation's, not the turn's. An agent with no turn under way,
 * as a call replayed after its turn settled, is refused nothing here.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import {
  type CodingAgent,
  lineSendersOf,
  RUNNING_TURN_STATUSES,
} from "@luke/database/models/coding-agent-store";
import {
  latestTurnsOf,
  listRecentMessages,
  listTurnOpeners,
  readMessageByClientId,
} from "@luke/database/models/message-reads";
import { MESSAGE_SENDER } from "@luke/database/storage-vocabulary";
import { CLAUDE_CODE_TOOL, CODEX_TOOL } from "@luke/features/agent-tools";
import { toolPartName } from "@luke/wire/ui-messages";
import { Effect } from "effect";
import { MESSAGE_ROLE } from "../core.js";
import type { StoreFailure } from "../http/store-failure.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { CODER_TOOL_SET, RETIRED_CODER_TOOL } from "./coder-host/tool-set.js";

/** Why a turn may keep no memory, in words the model can act on. */
export const MEMORY_PROVENANCE_REFUSAL = {
  AUTOMATION:
    "Not remembered: an automation opened this turn, a heartbeat among them, so no member " +
    "settled what it holds. Keep a fact on a turn a member's own words open, if it still matters then.",
  WEB_READ:
    "Not remembered: this turn read the web, and a page's words are no settled fact of the " +
    "team's. Keep a fact on a later turn, from what a member said or the code shows.",
  UNREADABLE:
    "Not remembered: where this turn's words came from could not be read. Carry on without it.",
} as const;

/** How many of the conversation's newest messages are read for its newest line: it, and the journals a few turns queued behind it wrote. */
const NEWEST_LINES_READ = 8;

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
 * kept none. Note that the second is the first line of an eve agent an
 * automation started, because eve's session takes it as it opens and the
 * relay writes it with no sender (`coder-host/start.ts`), while every line
 * a member sends keeps theirs.
 */
const automationLine = (agent: CodingAgent, messageId: string) =>
  Effect.map(
    lineSendersOf({ userId: agent.userId, conversationId: agent.conversationId }, [messageId]),
    (senders) => {
      const sent = senders.get(messageId);
      return sent === undefined
        ? agent.automationOrigin !== null
        : sent.kind === MESSAGE_SENDER.AUTOMATION;
    },
  );

/** Whether the turn's opening line was an automation's run. */
const openedByAutomation = (agent: CodingAgent, turnId: string) =>
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
const readTheWeb = (agent: CodingAgent, turnId: string) =>
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
  agent: CodingAgent,
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

/**
 * Whether the newest line of the agent's conversation, the one a turn opens
 * on as it starts, is an automation's run, as above: what holds an
 * operator's flush back to a turn that may keep what it is told to
 * (`coder-host/host.ts`'s `turnMessage`). None among the newest messages, or
 * a page that does not read, is no automation's.
 */
export function newestLineIsAutomation(
  agent: CodingAgent,
): Effect.Effect<boolean, StoreFailure, DatabaseServices> {
  return Effect.gen(function* () {
    const read = yield* listRecentMessages(
      agent.userId,
      agent.conversationId,
      CODER_TOOL_SET,
      NEWEST_LINES_READ,
    );
    const line = read.ok
      ? read.value.findLast((record) => record.message.role === MESSAGE_ROLE.USER)
      : undefined;
    return line === undefined ? false : yield* automationLine(agent, line.id);
  });
}
