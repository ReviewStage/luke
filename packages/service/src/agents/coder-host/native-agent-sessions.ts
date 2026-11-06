import { readAgentRepositories } from "@repo/database/models/agent-repositories";
import { type Agent, hasRepository } from "@repo/database/models/agent-store";
import { readNativeSequence } from "@repo/database/models/native-projection-store";
import { readTaskHeader } from "@repo/database/models/task-store";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { Effect, Layer, Option } from "effect";
import { deploymentOrigin } from "../../deployment-origin.js";
import { logStoreFailure } from "../../http/store-failure.js";
import {
  type ConnectionDoorServices,
  nativeAgentConnections,
} from "../../integrations/connection-door.js";
import type { AgentMachine, MachineLayout } from "../machine/agent-machine.js";
import { agentMachinesLayer } from "../machine/agent-machines.js";
import type { SandboxRunner } from "../machine/vercel-machine.js";
import { memoryOnFor } from "../memory-tools.js";
import { RUNNER_EVENTS_PATH } from "../native-events/runner-events-app.js";
import { RUNNER_LINES_PATH } from "../native-events/runner-lines-app.js";
import { RUNNER_TOKEN_PATH } from "../native-events/runner-token-app.js";
import { descriptionsOnFor } from "../descriptions-on.js";
import { extraCheckoutPaths } from "../repository-sandbox-contract.js";
import { deploymentOidcToken } from "../vercel-sandbox-api.js";
import { WORKSPACE_MCP_PATH, workspaceIntegrationMcpUrl } from "../workspace-mcp/app.js";
import { workspaceStepOf } from "../written-mentions.js";
import { agentAuthorship, agentCiReadable } from "./checkout.js";
import { claudeCodeSessions } from "./claude-code-sessions.js";
import { codexSessions } from "./codex-sessions.js";
import {
  agentCoderInstructions,
  CODER_HARNESS,
  type CoderHarness,
  type ExtraCheckout,
} from "./instructions.js";
import type { RunnerServices, RunnerSessionsOptions } from "./runner-sessions.js";
import { NativeAgentSessions } from "./runtime-sessions.js";

export interface NativeAgentSessionsOptions {
  readonly run: SandboxRunner;
  readonly origin?: () => string | undefined;
}

const agentTaskNumber = (userId: string, agent: Agent) =>
  agent.taskId === null
    ? Effect.succeed(undefined)
    : readTaskHeader(userId, agent.taskId).pipe(
        Effect.map((header) => Option.getOrUndefined(header)?.number),
        Effect.tapError(logStoreFailure),
        Effect.orElseSucceed(() => undefined),
      );

const agentExtraCheckouts = (userId: string, agent: Agent) =>
  readAgentRepositories(userId, agent.id).pipe(
    Effect.map(([, ...extras]): readonly ExtraCheckout[] => {
      const paths = extraCheckoutPaths(extras.map((extra) => extra.repository));
      return extras.map((extra, index) => ({
        repository: extra.repository,
        path: paths[index] ?? extra.repository,
        branch: extra.baseBranch,
      }));
    }),
    Effect.tapError(logStoreFailure),
    Effect.orElseSucceed((): readonly ExtraCheckout[] => []),
  );

const nativeCoderInstructions = (
  userId: string,
  agent: Agent,
  harness: CoderHarness,
  place: Pick<MachineLayout, "checkoutPath" | "installedSkills" | "sharedFiles">,
) =>
  Effect.gen(function* () {
    const target = { userId, conversationId: agent.conversationId };
    const ciReadable = hasRepository(agent) ? yield* agentCiReadable(target, agent) : false;
    const authorship = hasRepository(agent) ? yield* agentAuthorship(target, agent) : undefined;
    const workspace = yield* workspaceStepOf(userId, agent.organizationId).pipe(
      Effect.tapError(logStoreFailure),
      Effect.orElseSucceed(() => agent.organizationId),
    );
    const taskNumber = yield* agentTaskNumber(userId, agent);
    const memoryOn = yield* memoryOnFor(userId);
    const descriptionsOn = yield* descriptionsOnFor(userId, agent.kind);
    const extraRepositories = hasRepository(agent) ? yield* agentExtraCheckouts(userId, agent) : [];
    return agentCoderInstructions(agent, {
      ciReadable,
      authorship,
      workspace,
      taskNumber,
      memoryOn,
      descriptionsOn,
      harness,
      place,
      ...(extraRepositories.length === 0 ? undefined : { extraRepositories }),
    });
  });

const nativeIntegrations = (userId: string, agent: Agent, origin: string) =>
  Effect.map(
    nativeAgentConnections({
      caller: userId,
      target: { userId, conversationId: agent.conversationId },
      runtimeSessionId: undefined,
      timeZone: undefined,
    }),
    (names) => names.map((name) => ({ name, url: workspaceIntegrationMcpUrl(origin, name) })),
  );

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
      const originOf = options.origin ?? deploymentOrigin;
      const optionsFor = (
        account: string,
        origin: string,
        harness: CoderHarness,
      ): RunnerSessionsOptions => ({
        userId: account,
        eventsUrl: new URL(RUNNER_EVENTS_PATH, origin).href,
        linesUrl: new URL(RUNNER_LINES_PATH, origin).href,
        mcpUrl: new URL(WORKSPACE_MCP_PATH, origin).href,
        integrations: (agent) =>
          nativeIntegrations(account, agent, origin).pipe(Effect.provideContext(context)),
        instructions: (agent, place) =>
          nativeCoderInstructions(account, agent, harness, place).pipe(
            Effect.provideContext(context),
          ),
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
  ).pipe(Layer.provide(agentMachinesLayer({ readToken: deploymentOidcToken, run: options.run })));
}
