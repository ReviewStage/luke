import { HarnessAgent, type HarnessAgentResumeSessionState } from "@ai-sdk/harness/agent";
import { createClaudeCode } from "@ai-sdk/harness-claude-code";
import { createCodex } from "@ai-sdk/harness-codex";
import {
  createVercelNetworkSandboxSession,
  resumeVercelNetworkSandboxSession,
} from "@ai-sdk/sandbox-vercel";
import { CODING_AGENT_BRIEF } from "@sidecar/hosted/coding-agent-wire";
import { MODEL_PROVIDER } from "@sidecar/hosted/models-wire";
import { isRecord, isWireString } from "@sidecar/wire";
import { tool } from "ai";
import { Effect, Redacted } from "effect";
import type * as HttpClient from "effect/unstable/http/HttpClient";
import type { SqlClient } from "effect/unstable/sql";
import { z } from "zod/v4";
import type { GitHubApp } from "../../../github/github-app.js";
import type { CodingAgent } from "../../coding-agent-store.js";
import { providerModelOf } from "../../model-catalog.js";
import type { RepositorySandbox } from "../../repository-shell.js";
import type { ConversationTarget } from "../../store/index.js";
import { CODER } from "../bounds.js";
import { checkOutAgentRepository } from "../checkout.js";
import { coderInstructions } from "../instructions.js";
import type { ProviderKeys } from "../model.js";
import { recordPlanEdit } from "../plan-edit.js";
import { CODER_TOOL } from "../tool-set.js";
import { type HarnessConversation, HarnessRefused } from "./harness-sessions.js";
import { CODER_RUNTIME, type HarnessRuntime } from "./runtime-flag.js";

/**
 * harness-production.ts -- SPIKE (do not merge): the harness path over the deployment's own seams, never run in this spike.
 *
 * One Vercel Sandbox per agent, named for its conversation so a later turn
 * resumes the same filesystem (`resumeVercelNetworkSandboxSession`), with
 * the harness's bridge on one exposed port and the snapshot the adapter's
 * template names, so the bridge's install runs once per adapter version
 * rather than once per agent. The agent's repository is checked out on the
 * first turn through the same `checkOutAgentRepository` eve's coder uses,
 * its GitHub token set at the sandbox's firewall as a request
 * transformation, never in the sandbox. The adapter runs on Luke's own
 * provider key (`auth` given explicitly, because the adapters' `auto`
 * picks AI Gateway whenever `VERCEL_OIDC_TOKEN` is set, which it always
 * is on Vercel), brokered the same way: the sandbox sees a placeholder and
 * the firewall swaps the key in on requests to the provider's host.
 * Permission mode is `allow-all` (Claude Code's `bypassPermissions`,
 * Codex's `approval_policy = never` in `danger-full-access`), since the
 * run is unattended and the sandbox is the boundary. The agent's plan
 * notes stay a host tool, run here on the edge's runner as eve's tool
 * runs them.
 */

/** The port the harness's bridge listens on inside the sandbox. */
const BRIDGE_PORT = 4000;

/** The efforts the adapters take, in their own words; the catalog's words for an effort match. */
const HARNESS_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
type HarnessEffort = (typeof HARNESS_EFFORTS)[number];

function harnessEffortOf(effort: string): HarnessEffort | undefined {
  return HARNESS_EFFORTS.find((known) => known === effort);
}

/** The sandbox an agent's turns share, named for its conversation. */
function sandboxNameOf(conversationId: string): string {
  return `luke-coder-${conversationId}`;
}

/** The runner the edge hands down, on which a host tool's effect runs. */
type EdgeRunner = <A, E>(effect: Effect.Effect<A, E, SqlClient.SqlClient>) => Promise<A>;

/** The adapter for the runtime on Luke's own key for its provider, or why there is none. */
function harnessOf(runtime: HarnessRuntime, keys: ProviderKeys, effort: HarnessEffort | undefined) {
  if (runtime === CODER_RUNTIME.CLAUDE_CODE) {
    if (keys.anthropic === undefined) return undefined;
    // The key is revealed here alone, into the adapter that brokers it at the sandbox's firewall.
    return createClaudeCode({
      auth: { ANTHROPIC_API_KEY: Redacted.value(keys.anthropic) },
      thinking: { type: "adaptive", display: "summarized" },
      ...(effort === undefined ? undefined : { effort }),
    });
  }
  if (keys.openAi === undefined) return undefined;
  return createCodex({
    auth: { OPENAI_API_KEY: Redacted.value(keys.openAi) },
    ...(effort === undefined ? undefined : { reasoningEffort: effort }),
  });
}

/**
 * The agent's checkout as the shared clone reaches a sandbox: its commands,
 * and its firewall told the clone's GitHub rule as a request
 * transformation. Note that the rule is not withdrawn after the clone,
 * because the session's own `git push` and `gh` need it standing, which is
 * what eve's coder sets again after its clone.
 */
function repositorySandboxOf(
  sandbox: Awaited<ReturnType<typeof createVercelNetworkSandboxSession>>,
): RepositorySandbox {
  return {
    run: (options) => sandbox.run(options),
    setNetworkPolicy: async (policy) => {
      const allow = isRecord(policy) ? policy.allow : undefined;
      if (!isRecord(allow) || sandbox.addRequestTransformations === undefined) return;
      for (const [host, rules] of Object.entries(allow)) {
        if (!Array.isArray(rules)) continue;
        for (const rule of rules) {
          const headers =
            isRecord(rule) && Array.isArray(rule.transform) ? rule.transform[0] : undefined;
          const authorization =
            isRecord(headers) &&
            isRecord(headers.headers) &&
            isWireString(headers.headers.authorization)
              ? headers.headers.authorization
              : undefined;
          if (authorization === undefined) continue;
          await sandbox.addRequestTransformations([
            { match: { host }, transform: { headers: { authorization } } },
          ]);
        }
      }
    },
  };
}

/** The agent's harness session, opened or resumed in its sandbox, its repository checked out on the first turn. */
export const openProductionConversation =
  (runtime: HarnessRuntime, keys: () => ProviderKeys, run: EdgeRunner) =>
  (
    target: ConversationTarget,
    agent: CodingAgent,
    parkedState: unknown,
  ): Effect.Effect<
    HarnessConversation,
    HarnessRefused,
    SqlClient.SqlClient | HttpClient.HttpClient | GitHubApp
  > =>
    Effect.gen(function* () {
      const named = providerModelOf(agent.model);
      const provider =
        runtime === CODER_RUNTIME.CLAUDE_CODE ? MODEL_PROVIDER.ANTHROPIC : MODEL_PROVIDER.OPENAI;
      if (named === undefined || named.provider !== provider) {
        return yield* new HarnessRefused({ reason: `${runtime} does not run ${agent.model}` });
      }
      const harness = harnessOf(runtime, keys(), harnessEffortOf(agent.effort));
      if (harness === undefined) return yield* new HarnessRefused({ reason: "no provider key" });
      const brief = agent.task === null ? CODING_AGENT_BRIEF.PLAN : CODING_AGENT_BRIEF.TASK;
      const harnessAgent = new HarnessAgent({
        harness,
        id: "luke-coder",
        model: named.modelId,
        instructions: coderInstructions(agent.repository, brief),
        permissionMode: "allow-all",
        sandboxConfig: { workDir: CODER.CHECKOUT_PATH },
        tools: {
          [CODER_TOOL.EDIT_PLAN]: tool({
            description: "Take notes on the plan this agent was handed.",
            inputSchema: z.object({ notes: z.array(z.json()) }),
            execute: (input) =>
              run(
                recordPlanEdit(
                  { userId: target.userId, planId: agent.planId },
                  { agentId: agent.id },
                  input,
                  0,
                ),
              ),
          }),
        },
      });
      const resumed = parkedState !== undefined;
      const sandbox = yield* Effect.tryPromise({
        try: async () => {
          if (resumed) {
            return resumeVercelNetworkSandboxSession({
              sandboxId: sandboxNameOf(target.conversationId),
            });
          }
          const template = await harnessAgent.getSandboxTemplate();
          return createVercelNetworkSandboxSession({
            sandboxId: sandboxNameOf(target.conversationId),
            runtime: "node24",
            ports: [BRIDGE_PORT],
            timeout: CODER.SANDBOX_TIMEOUT_MS,
            ...(template === undefined ? undefined : { template }),
          });
        },
        catch: () => new HarnessRefused({ reason: "the sandbox could not be opened" }),
      });
      const repository = repositorySandboxOf(sandbox);
      if (!resumed) {
        yield* checkOutAgentRepository(target, agent, repository).pipe(
          Effect.mapError((failure) => new HarnessRefused({ reason: failure.reason })),
        );
      }
      const session = yield* Effect.tryPromise({
        try: () =>
          harnessAgent.createSession({
            sessionId: target.conversationId,
            sandboxSession: sandbox,
            ...(resumed
              ? { resumeFrom: parkedState as HarnessAgentResumeSessionState }
              : undefined),
          }),
        catch: () => new HarnessRefused({ reason: "the harness session could not be opened" }),
      });
      return {
        modelId: named.modelId,
        sandbox: repository,
        turn: async (prompt, abortSignal) =>
          (await harnessAgent.stream({ session, prompt, abortSignal })).fullStream,
        park: async () => {
          const state = await session.stop();
          await sandbox.stop();
          return state;
        },
      };
    });
