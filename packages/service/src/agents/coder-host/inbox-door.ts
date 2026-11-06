import type { DatabaseServices } from "@repo/database/core/query";
import { readAgentHeaderOfConversation } from "@repo/database/models/agent-store";
import { INBOX_TOOL } from "@repo/features/inbox-wire";
import { Effect, Option } from "effect";
import type { UnparsedWireValue } from "../../core.js";
import { logStoreFailure } from "../../http/store-failure.js";
import type { AdmittedConversation } from "../eve-host/conversation.js";
import {
  INBOX_REFUSAL,
  type InboxToolResult,
  inboxRejected,
  postToInbox,
  readOwnInbox,
  withdrawAsk,
} from "./inbox.js";
import type { InboxSandboxDoor } from "./inbox-image.js";

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
