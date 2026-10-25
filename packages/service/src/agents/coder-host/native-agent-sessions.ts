/**
 * native-agent-sessions.ts -- the native harnesses a web function launches and writes to, as the service the router reads (`runtime-sessions.ts`).
 *
 * Composed by the web functions that ship the runner's bundle
 * (`apps/web/server/native-agents.ts`): each harness's sessions acting for
 * an account, over the function's own services. A launch's runner posts
 * its events to the events route and calls Luke's tools at the MCP server,
 * both under the deployment's own origin; numbers its events from one past
 * the last the store applied of its conversation (`readNativeSequence`);
 * asks the token route for the plan's token, on Codex; is handed each
 * integration its starter's conversation is handed, as an MCP server of its
 * own beside Luke's (`../luke-mcp/app.ts`);
 * and runs under Luke's coder instructions, worded for the harness, which
 * names the tools it owns by its own names (`instructions.ts`): Claude
 * Code's appended to its prompt, Codex's as its `developer_instructions`.
 */

import { type CodingAgent, hasRepository } from "@luke/database/models/coding-agent-store";
import { readNativeSequence } from "@luke/database/models/native-projection-store";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { Effect, Layer, Option } from "effect";
import { logStoreFailure } from "../../http/store-failure.js";
import {
  type ConnectionDoorServices,
  nativeAgentConnections,
} from "../../integrations/connection-door.js";
import { deploymentEveOrigin } from "../brain-host/eve-origin.js";
import { LUKE_MCP_PATH, lukeIntegrationMcpUrl } from "../luke-mcp/app.js";
import type { AgentMachine } from "../machine/agent-machine.js";
import { type SandboxRunner, vercelMachineLayer } from "../machine/vercel-machine.js";
import { memoryOnFor } from "../memory-tools.js";
import { RUNNER_EVENTS_PATH } from "../native-events/runner-events-app.js";
import { RUNNER_TOKEN_PATH } from "../native-events/runner-token-app.js";
import { deploymentOidcToken } from "../vercel-sandbox-api.js";
import { workspaceStepOf } from "../written-mentions.js";
import { agentCiReadable, agentCoAuthor } from "./checkout.js";
import { claudeCodeSessions } from "./claude-code-sessions.js";
import { codexSessions } from "./codex-sessions.js";
import { agentCoderInstructions, CODER_HARNESS, type CoderHarness } from "./instructions.js";
import type { RunnerServices, RunnerSessionsOptions } from "./runner-sessions.js";
import { NativeAgentSessions } from "./runtime-sessions.js";

export interface NativeAgentSessionsOptions {
  /** Runs one effect on the function's runtime, which the checkout reaches the agent's machine through. */
  readonly run: SandboxRunner;
  /** The deployment's own origin, which the runner reaches Luke at; none opens no harness. */
  readonly origin?: () => string | undefined;
}

/**
 * Luke's coder instructions for an agent on the harness given, composed on
 * what its row names as an eve session's are (`host.ts`'s `prompt`): whether
 * its token reads the repository's CI, the co-author trailer where it writes
 * as its developer, the workspace its links are written under, and whether
 * its starter turned Chat on; each read that fails reads as eve's does.
 */
const nativeCoderInstructions = (userId: string, agent: CodingAgent, harness: CoderHarness) =>
  Effect.gen(function* () {
    const target = { userId, conversationId: agent.conversationId };
    const ciReadable = hasRepository(agent) ? yield* agentCiReadable(target, agent) : false;
    const coAuthor = hasRepository(agent) ? yield* agentCoAuthor(target, agent) : undefined;
    const workspace = yield* workspaceStepOf(userId, agent.organizationId).pipe(
      Effect.tapError(logStoreFailure),
      Effect.orElseSucceed(() => agent.organizationId),
    );
    const memoryOn = yield* memoryOnFor(userId);
    return agentCoderInstructions(agent, {
      ciReadable,
      coAuthor,
      workspace,
      memoryOn,
      harness,
    });
  });

/** The integrations an agent is handed as its launch starts, each an MCP server of its own at Luke, read as its starter's conversation reads them. */
const nativeIntegrations = (userId: string, agent: CodingAgent, origin: string) =>
  Effect.map(
    nativeAgentConnections({
      caller: userId,
      target: { userId, conversationId: agent.conversationId },
      runtimeSessionId: undefined,
      timeZone: undefined,
    }),
    (names) => names.map((name) => ({ name, url: lukeIntegrationMcpUrl(origin, name) })),
  );

/** The native harnesses over the function's services, as above, each agent's runner on Vercel Sandbox (`vercel-machine.ts`). */
export function nativeAgentSessionsLayer(
  options: NativeAgentSessionsOptions,
): Layer.Layer<
  NativeAgentSessions,
  never,
  Exclude<RunnerServices, AgentMachine> | ConnectionDoorServices
> {
  return Layer.effect(
    NativeAgentSessions,
    Effect.gen(function* () {
      const context = yield* Effect.context<RunnerServices | ConnectionDoorServices>();
      const originOf = options.origin ?? deploymentEveOrigin;
      /** What every harness's sessions are handed, for the account given and worded for the harness. */
      const optionsFor = (
        account: string,
        origin: string,
        harness: CoderHarness,
      ): RunnerSessionsOptions => ({
        userId: account,
        eventsUrl: new URL(RUNNER_EVENTS_PATH, origin).href,
        mcpUrl: new URL(LUKE_MCP_PATH, origin).href,
        integrations: (agent) =>
          nativeIntegrations(account, agent, origin).pipe(Effect.provideContext(context)),
        instructions: (agent) =>
          nativeCoderInstructions(account, agent, harness).pipe(Effect.provideContext(context)),
        // One past the last event the store applied, so a relaunch goes on numbering where the last launch stopped.
        nextSequence: (conversationId) =>
          readNativeSequence({ userId: account, conversationId }).pipe(
            Effect.map(Option.match({ onNone: () => 0, onSome: (last) => last + 1 })),
            Effect.provideContext(context),
          ),
      });
      return {
        sessions: (runtime, account) => {
          const origin = originOf();
          if (origin === undefined) return Option.none();
          if (runtime === CONVERSATION_RUNTIME.CODEX) {
            return Option.some(
              codexSessions({
                ...optionsFor(account, origin, CODER_HARNESS.CODEX),
                tokenUrl: new URL(RUNNER_TOKEN_PATH, origin).href,
              }).pipe(Effect.provideContext(context)),
            );
          }
          return Option.some(
            claudeCodeSessions(optionsFor(account, origin, CODER_HARNESS.CLAUDE_CODE)).pipe(
              Effect.provideContext(context),
            ),
          );
        },
      };
    }),
  ).pipe(Layer.provide(vercelMachineLayer({ readToken: deploymentOidcToken, run: options.run })));
}
