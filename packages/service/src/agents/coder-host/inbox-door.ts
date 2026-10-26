/**
 * inbox-door.ts -- the door every runtime's call of a coding agent's thread and channel tools goes through: the agent the conversation is, then the tool.
 *
 * eve's tool files reach it through the coder host (`host.ts`'s `inbox`),
 * and a native harness's runner through Luke's MCP server
 * (`../luke-mcp/tools.ts`), so both run one implementation. It imports no
 * eve runtime, because the web function that serves the MCP server bundles
 * no sandbox.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { readCodingAgentHeaderOfConversation } from "@luke/database/models/coding-agent-store";
import { CHANNEL_TOOL } from "@luke/features/channel-wire";
import { INBOX_TOOL } from "@luke/features/inbox-wire";
import { Effect, Option } from "effect";
import type { UnparsedWireValue } from "../../core.js";
import { logStoreFailure } from "../../http/store-failure.js";
import type { AdmittedConversation } from "../brain-host/conversation.js";
import {
  type ChannelToolResult,
  createAgentChannel,
  INBOX_REFUSAL,
  INBOX_TOOLS,
  type InboxToolResult,
  inboxRejected,
  moveAgentThread,
  postThreadWordsFor,
  postToInbox,
  readOwnInbox,
  updateAgentChannel,
  withdrawAsk,
} from "./inbox.js";
import type { InboxSandboxDoor } from "./inbox-image.js";

/** One call of the agent's thread and channel tools, by the tool's name and the input its runtime held to its schema; a post carries the door to the session's sandbox, where its pictures are read. */
export type InboxCall =
  | {
      readonly tool: typeof INBOX_TOOL.POST;
      readonly input: UnparsedWireValue;
      readonly sandbox: InboxSandboxDoor;
    }
  | {
      readonly tool:
        | typeof INBOX_TOOL.WITHDRAW
        | typeof INBOX_TOOL.READ
        | (typeof CHANNEL_TOOL)[keyof typeof CHANNEL_TOOL];
      readonly input: UnparsedWireValue;
    };

/** What a call of the agent's thread and channel tools answers. */
export type ThreadToolResult = InboxToolResult | ChannelToolResult;

/** Runs one of the agent's thread and channel tools as the admitted conversation's agent: a post, a withdrawal, a read of its own items, a channel made or changed, or a thread moved; a store failure is the tool's own refusal. */
export function runAgentInbox(
  admitted: AdmittedConversation,
  call: InboxCall,
): Effect.Effect<ThreadToolResult, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* readCodingAgentHeaderOfConversation(
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
      case CHANNEL_TOOL.CREATE:
        return yield* createAgentChannel(agent, call.input);
      case CHANNEL_TOOL.UPDATE:
        return yield* updateAgentChannel(agent, call.input);
      case CHANNEL_TOOL.MOVE:
        return yield* moveAgentThread(agent, call.input);
    }
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(inboxRejected(INBOX_REFUSAL.UNAVAILABLE))),
  );
}

/**
 * The words the admitted conversation's agent is shown `post_thread` with,
 * its workspace's open channels among them; the words with none where the
 * conversation is no agent's or the store could not be read.
 */
export function postThreadWords(
  admitted: AdmittedConversation,
): Effect.Effect<string, never, DatabaseServices> {
  return Effect.gen(function* () {
    const found = yield* readCodingAgentHeaderOfConversation(
      admitted.target.userId,
      admitted.target.conversationId,
    );
    if (Option.isNone(found)) return INBOX_TOOLS.POST.description;
    const { organizationId } = found.value;
    return yield* postThreadWordsFor({ userId: admitted.target.userId, organizationId });
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.catch(() => Effect.succeed(INBOX_TOOLS.POST.description)),
  );
}
