/**
 * inbox-door.ts -- the door every runtime's call of a coding agent's thread tools goes through: the agent the conversation is, then the tool.
 *
 * A native harness's runner reaches it through our MCP server
 * (`../tool-catalog/catalog.ts`). It imports no
 * sandbox, because the web function that serves the MCP server bundles
 * none.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { readAgentHeaderOfConversation } from "@repo/database/models/agent-store";
import { INBOX_TOOL } from "@repo/features/inbox-wire";
import { Effect, Option } from "effect";
import type { UnparsedWireValue } from "../../core.js";
import { logStoreFailure } from "../../http/store-failure.js";
import type { AdmittedConversation } from "../sessions/admitted-conversation.js";
import {
  INBOX_REFUSAL,
  type InboxToolResult,
  inboxRejected,
  postToInbox,
  readOwnInbox,
  withdrawAsk,
} from "./inbox.js";
import type { InboxSandboxDoor } from "./inbox-image.js";

/** One call of the agent's thread tools, by the tool's name and the input its runtime held to its schema; a post carries the door to the session's sandbox, where its pictures are read. */
export type InboxCall =
  | {
      readonly tool: typeof INBOX_TOOL.POST;
      readonly input: UnparsedWireValue;
      readonly sandbox: InboxSandboxDoor;
    }
  | {
      readonly tool: typeof INBOX_TOOL.WITHDRAW | typeof INBOX_TOOL.READ;
      readonly input: UnparsedWireValue;
    };

/** Runs one of the agent's thread tools as the admitted conversation's agent: a post, a withdrawal, or a read of its own items; a store failure is the tool's own refusal. */
export function runAgentInbox(
  admitted: AdmittedConversation,
  call: InboxCall,
): Effect.Effect<InboxToolResult, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* readAgentHeaderOfConversation(
      admitted.target.userId,
      admitted.target.conversationId,
    );
    if (Option.isNone(found)) return inboxRejected(INBOX_REFUSAL.NO_AGENT);
    const { id: agentId, taskId, organizationId } = found.value;
    const agent = { userId: admitted.target.userId, taskId, agentId, organizationId };
    switch (call.tool) {
      case INBOX_TOOL.POST:
        return yield* postToInbox(agent, call.input, call.sandbox);
      case INBOX_TOOL.WITHDRAW:
        return yield* withdrawAsk(agent, call.input);
      case INBOX_TOOL.READ:
        return yield* readOwnInbox(agent);
    }
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}
