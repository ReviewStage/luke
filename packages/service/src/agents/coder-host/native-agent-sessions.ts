/**
 * native-agent-sessions.ts -- the native harnesses a web function launches and writes to, as the service the router reads (`runtime-sessions.ts`).
 *
 * Composed by the web functions that ship the runner's bundle
 * (`apps/web/server/native-agents.ts`): each harness's sessions acting for
 * an account, over the function's own services. A launch's runner posts
 * its events to the events route and calls Luke's tools at the MCP server,
 * both under the deployment's own origin; numbers its events from one past
 * the last the store applied of its conversation (`readNativeSequence`);
 * asks the token route for the plan's token, on Codex;
 * and runs under Luke's coder instructions, worded for the harness, which
 * names the tools it owns by its own names (`instructions.ts`): Claude
 * Code's appended to its prompt, Codex's as its `developer_instructions`.
 * Each message line opens with what eve's turn opens with
 * (`turn-opening.ts`): the turn's own message, what the session has handed
 * kept on the agent's row as eve keeps it in its session's state, and the
 * conversation so far where the harness's session opens afresh, a snapshot
 * expired or a sandbox retired, so the agent goes on knowing what was said.
 */

import { chatEnabledFor } from "@luke/database/models/account-store";
import {
  type CodingAgent,
  hasRepository,
  readNativeTurnHanded,
  recordNativeTurnHanded,
} from "@luke/database/models/coding-agent-store";
import { readNativeSequence } from "@luke/database/models/native-projection-store";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { CODING_AGENT_BRIEF } from "@luke/features/coding-agent-wire";
import { GITHUB_ACCESS } from "@luke/features/github-repositories-wire";
import { encodeMention, MENTION_KIND } from "@luke/features/mention-link";
import { Clock, Effect, Layer, Option } from "effect";
import { logStoreFailure } from "../../http/store-failure.js";
import { deploymentEveOrigin } from "../brain-host/eve-origin.js";
import type { EveMessage } from "../brain-host/eve-sessions.js";
import { LUKE_MCP_PATH } from "../luke-mcp/app.js";
import { RUNNER_EVENTS_PATH } from "../native-events/runner-events-app.js";
import { RUNNER_TOKEN_PATH } from "../native-events/runner-token-app.js";
import { workspaceStepOf } from "../written-mentions.js";
import { agentCiReadable, agentCoAuthor } from "./checkout.js";
import { claudeCodeSessions } from "./claude-code-sessions.js";
import { codexSessions } from "./codex-sessions.js";
import { CODER_HARNESS, type CoderHarness, coderInstructions } from "./instructions.js";
import type { RunnerServices, RunnerSessionsOptions, SandboxRunner } from "./runner-sessions.js";
import { NativeAgentSessions } from "./runtime-sessions.js";
import { composeTurnMessage, conversationSeed } from "./turn-opening.js";

export interface NativeAgentSessionsOptions {
  /** Runs one effect on the function's runtime, which the checkout reaches the sandbox through. */
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
    const chatOn = yield* chatEnabledFor(userId).pipe(
      Effect.tapError(logStoreFailure),
      Effect.orElseSucceed(() => false),
    );
    const taskLink =
      agent.taskId === null
        ? null
        : encodeMention(
            { kind: MENTION_KIND.TASK, taskId: agent.taskId },
            { workspace, repository: null },
          );
    return coderInstructions(
      agent.repository,
      agent.prompt === null ? CODING_AGENT_BRIEF.PLAN : CODING_AGENT_BRIEF.PROMPT,
      ciReadable,
      taskLink,
      coAuthor,
      chatOn,
      agent.startBranch,
      agent.githubAccess === GITHUB_ACCESS.TOKEN,
      harness,
      agent.kind,
    );
  });

/**
 * What a native agent's message line opens with, as eve's turn opens
 * (`turn-opening.ts`), read as the account the sessions act for: on a
 * session opened afresh, the conversation so far and a turn's message
 * composed as a new session's first, from nothing handed; otherwise a turn's
 * message from what the session was handed before, which this one's replaces
 * on the agent's row. The turn has no store id yet, since the events route
 * queues it once the runner takes the line, so the previous turn is the
 * conversation's newest. A read or a write that fails is logged and hands
 * nothing, so the message still goes.
 */
const nativeOpening = (account: string, agent: CodingAgent, message: EveMessage, fresh: boolean) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    const target = { userId: account, conversationId: agent.conversationId };
    const handed = fresh ? {} : yield* readNativeTurnHanded(account, agent.id);
    const turn = yield* composeTurnMessage(
      { caller: account, target, timeZone: message.timeZone },
      agent,
      { kind: message.turn, turnId: undefined },
      handed,
      now,
    );
    yield* recordNativeTurnHanded(account, agent.id, turn.handed);
    const seed = fresh ? yield* conversationSeed(target, now) : undefined;
    const parts = [seed, turn.text].filter((part) => part !== undefined && part !== "");
    return parts.length === 0 ? undefined : parts.join("\n\n");
  }).pipe(
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed(() => undefined),
  );

/** The native harnesses over the function's services, as above. */
export function nativeAgentSessionsLayer(
  options: NativeAgentSessionsOptions,
): Layer.Layer<NativeAgentSessions, never, RunnerServices> {
  return Layer.effect(
    NativeAgentSessions,
    Effect.gen(function* () {
      const context = yield* Effect.context<RunnerServices>();
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
        instructions: (agent) =>
          nativeCoderInstructions(account, agent, harness).pipe(Effect.provideContext(context)),
        opening: (agent, message, fresh) =>
          nativeOpening(account, agent, message, fresh).pipe(Effect.provideContext(context)),
        // One past the last event the store applied, so a relaunch goes on numbering where the last launch stopped.
        nextSequence: (conversationId) =>
          readNativeSequence({ userId: account, conversationId }).pipe(
            Effect.map(Option.match({ onNone: () => 0, onSome: (last) => last + 1 })),
            Effect.provideContext(context),
          ),
        run: options.run,
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
  );
}
