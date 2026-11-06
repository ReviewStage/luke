import {
  getSessionMessages,
  type Options,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Context, Layer } from "effect";

export type ClaudeCodeSession = AsyncIterable<SDKMessage> &
  Pick<Query, "interrupt" | "setModel" | "applyFlagSettings" | "close">;

export interface ClaudeCodeShape {
  readonly query: (params: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: Options;
  }) => ClaudeCodeSession;
  readonly sessionChain: (sessionId: string, cwd: string) => Promise<readonly string[]>;
}

export class ClaudeCode extends Context.Service<ClaudeCode, ClaudeCodeShape>()(
  "@repo/agent-runner/ClaudeCode",
) {}

export const claudeCodeLive: Layer.Layer<ClaudeCode> = Layer.succeed(ClaudeCode, {
  query: (params) => query(params),
  sessionChain: async (sessionId, cwd) =>
    (await getSessionMessages(sessionId, { dir: cwd, includeSystemMessages: true })).map(
      (message) => message.uuid,
    ),
});
