/**
 * claude-code.ts -- the one door to the Agent SDK: `query()` in streaming input mode, and the session handle the runner drives it through.
 *
 * The handle is the part of the SDK's `Query` the runner uses, so a test
 * hands a scripted session where production hands the CLI.
 */

import {
  type Options,
  type Query,
  query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import { Context, Layer } from "effect";

/**
 * A running session of the CLI, as the runner drives it: its messages, and
 * the control requests the runner sends. `close` ends the CLI process and
 * whatever it still had running.
 */
export type ClaudeCodeSession = AsyncIterable<SDKMessage> &
  Pick<Query, "interrupt" | "setModel" | "applyFlagSettings" | "close">;

export interface ClaudeCodeShape {
  readonly query: (params: {
    readonly prompt: AsyncIterable<SDKUserMessage>;
    readonly options: Options;
  }) => ClaudeCodeSession;
}

export class ClaudeCode extends Context.Service<ClaudeCode, ClaudeCodeShape>()(
  "@luke/agent-runner/ClaudeCode",
) {}

/** The CLI itself, through the pinned SDK. */
export const claudeCodeLive: Layer.Layer<ClaudeCode> = Layer.succeed(ClaudeCode, {
  query: (params) => query(params),
});
