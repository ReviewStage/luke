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
import { CLAUDE_CODE_TOOL, CODEX_TOOL } from "@repo/features/agent-tools";
import { automationRun } from "@repo/features/model-label";
import { toolPartName } from "@repo/wire/ui-messages";
import { Effect } from "effect";
import type { StoreFailure } from "../http/store-failure.js";
import { AGENT_TOOL } from "./agent-runtime/tools.js";
import { CODER_TOOL_SET, RETIRED_CODER_TOOL } from "./coder-host/tool-set.js";

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

function calledTool(part: {
  readonly type: string;
  readonly toolName?: unknown;
}): string | undefined {
  if (part.type === "dynamic-tool")
    return typeof part.toolName === "string" ? part.toolName : undefined;
  return toolPartName(part.type);
}

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
