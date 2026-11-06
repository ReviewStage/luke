import { CLAUDE_EXECUTABLE } from "@repo/agent-runner/pins";
import {
  type ClaudeCodeConfig,
  EFFORT,
  type Effort,
  INPUT_LINE,
  RUNNER_ENV,
  RUNNER_HARNESS,
} from "@repo/agent-runner/protocol";
import { type Agent, readAgentRouting } from "@repo/database/models/agent-store";
import { openProviderKey, parseKeyRing } from "@repo/database/models/provider-key-seal";
import { listProviderKeyRows } from "@repo/database/models/provider-key-store";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { AGENT_MACHINE, AGENT_PAYER } from "@repo/features/agent-wire";
import { MODEL_SPEED } from "@repo/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  planLimitResetsAt,
} from "@repo/features/provider-key-wire";
import { Clock, Effect, Option, Redacted, Result } from "effect";
import { HostedEnvironment } from "../../environment.js";
import { SERVER_AGENT_HARNESS } from "../../events/server-events.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import type { EveHostTurn } from "../eve-host/bounds.js";
import { KEY_REFUSAL, PLAN_REFUSAL } from "../eve-host/eve-sessions.js";
import { LaunchRefused, type MachineLayout } from "../machine/agent-machine.js";
import { SKILL_ROOT } from "../repository-skills.js";
import { LAUNCH_SWAP, newPlaceholder, placeholderSwap } from "../sandbox-firewall.js";
import { BEARER_PREFIX } from "../workspace-mcp/bearer.js";
import { NATIVE_SESSION_PREFIX } from "./native-runtime.js";
import {
  type HarnessLaunch,
  type RunnerHarness,
  type RunnerServices,
  type RunnerSessionsOptions,
  runnerSessions,
} from "./runner-sessions.js";
import type { NativeSessions } from "./runtime-sessions.js";

const ANTHROPIC_API = "api.anthropic.com";

const CLI_CREDENTIAL = {
  PLAN: { variable: RUNNER_ENV.CLAUDE_TOKEN, header: "authorization", scheme: BEARER_PREFIX },
  API_KEY: { variable: RUNNER_ENV.API_KEY, header: "x-api-key", scheme: "" },
} as const;

type CliCredential = (typeof CLI_CREDENTIAL)[keyof typeof CLI_CREDENTIAL];

function launchCredential(
  agent: Agent,
  sent: CliCredential,
  credential: Redacted.Redacted,
): HarnessLaunch {
  if (agent.machine === AGENT_MACHINE.DEVICE) {
    return { env: { [sent.variable]: Redacted.value(credential) } };
  }
  const placeholder = newPlaceholder();
  const header = (value: Redacted.Redacted) =>
    Redacted.make(`${sent.scheme}${Redacted.value(value)}`);
  return {
    env: {},
    held: {
      env: { [sent.variable]: Redacted.value(placeholder) },
      kind: LAUNCH_SWAP.CLAUDE,
      entry: placeholderSwap({
        domain: ANTHROPIC_API,
        header: sent.header,
        placeholder: header(placeholder),
        value: header(credential),
      }),
      fingerprint: credential,
    },
  };
}

function effortOf(effort: string): Effort | undefined {
  return Object.values(EFFORT).find((level) => level === effort);
}

function claudeCode(options: RunnerSessionsOptions): RunnerHarness<{ readonly _tag: string }> {
  const { userId } = options;

  const standingPlan = Effect.gen(function* () {
    const rows = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN);
    const row = rows.find((each) => each.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC);
    if (row === undefined) {
      return yield* new LaunchRefused({
        reason: "no setup-token",
        planRefusal: PLAN_REFUSAL.SIGNED_OUT,
      });
    }
    if (row.status === PROVIDER_KEY_STATUS.INVALID) {
      return yield* new LaunchRefused({
        reason: "setup-token refused",
        planRefusal: PLAN_REFUSAL.SIGNED_OUT,
      });
    }
    const planResetsAt = planLimitResetsAt(row, yield* Clock.currentTimeMillis);
    if (planResetsAt !== undefined) {
      return yield* new LaunchRefused({
        reason: "plan limit reached",
        planRefusal: PLAN_REFUSAL.LIMIT_REACHED,
        planResetsAt,
      });
    }
    return row;
  });

  const payerOf = (agent: Agent) =>
    Effect.map(readAgentRouting(userId, agent.id), (routing) =>
      Option.getOrUndefined(Option.flatMapNullishOr(routing, (row) => row.payer)),
    );

  const savedPayer = (agent: Agent) =>
    Effect.gen(function* () {
      const payer = yield* payerOf(agent);
      if (payer === AGENT_PAYER.API_KEY) return AGENT_PAYER.API_KEY;
      if (payer !== AGENT_PAYER.MAC_SIGN_IN) return AGENT_PAYER.CLAUDE_SUBSCRIPTION;
      const anthropic = (rows: readonly { readonly provider: string }[]) =>
        rows.some((row) => row.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC);
      const plans = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN);
      if (anthropic(plans.filter((row) => row.forAgents))) {
        return AGENT_PAYER.CLAUDE_SUBSCRIPTION;
      }
      return anthropic(yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY))
        ? AGENT_PAYER.API_KEY
        : AGENT_PAYER.CLAUDE_SUBSCRIPTION;
    });

  const keyRing = Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    const ring = environment.providerKeyEncryptionKeys;
    const parsed = ring === undefined ? undefined : parseKeyRing(ring);
    if (parsed === undefined || Result.isFailure(parsed)) {
      return yield* Effect.fail(new LaunchRefused({ reason: "no key ring" }));
    }
    return parsed.success;
  });

  const apiKeyCredential = (agent: Agent) =>
    Effect.gen(function* () {
      const ring = yield* keyRing;
      const rows = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY);
      const row = rows.find((each) => each.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC);
      if (row === undefined) {
        return yield* new LaunchRefused({ reason: "no API key", keyRefusal: KEY_REFUSAL.MISSING });
      }
      const opened = openProviderKey(
        ring,
        { userId, provider: PROVIDER_KEY_PROVIDER.ANTHROPIC, kind: PROVIDER_KEY_KIND.API_KEY },
        row,
      );
      if (Result.isFailure(opened)) {
        return yield* new LaunchRefused({
          reason: "API key unreadable",
          keyRefusal: KEY_REFUSAL.UNREADABLE,
        });
      }
      return launchCredential(agent, CLI_CREDENTIAL.API_KEY, opened.success);
    });

  const planCredential = (agent: Agent) =>
    Effect.gen(function* () {
      const ring = yield* keyRing;
      const row = yield* standingPlan;
      const opened = openProviderKey(
        ring,
        {
          userId,
          provider: PROVIDER_KEY_PROVIDER.ANTHROPIC,
          kind: PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
        },
        row,
      );
      if (Result.isFailure(opened)) {
        return yield* new LaunchRefused({
          reason: "setup-token unreadable",
          planRefusal: PLAN_REFUSAL.UNREADABLE,
        });
      }
      return launchCredential(agent, CLI_CREDENTIAL.PLAN, opened.success);
    });

  const config = (
    agent: Agent,
    layout: MachineLayout,
    resume: string | undefined,
    firstSequence: number,
    rewindBefore: string | undefined,
  ) =>
    Effect.gen(function* () {
      const model = providerModelOf(agent.model);
      if (model === undefined) return yield* Effect.fail(new LaunchRefused({ reason: "model" }));
      const effort = effortOf(agent.effort);
      const written: ClaudeCodeConfig = {
        harness: RUNNER_HARNESS.CLAUDE_CODE,
        cwd: layout.checkoutPath,
        executable: layout.claudeExecutable ?? CLAUDE_EXECUTABLE,
        model: model.modelId,
        ...(effort === undefined ? undefined : { effort }),
        ...(model.speed === MODEL_SPEED.FAST ? { fast: true } : undefined),
        append: yield* options.instructions(agent, layout),
        ...(resume === undefined ? undefined : { resume }),
        ...(rewindBefore === undefined ? undefined : { rewindBefore }),
        firstSequence,
        eventsUrl: options.eventsUrl,
        mcpUrl: options.mcpUrl,
        integrations: yield* options.integrations(agent),
        allowedDomains: [],
        installedSkills: layout.installedSkills,
      };
      return written;
    });

  const ahead = (agent: Agent) => {
    const effort = effortOf(agent.effort);
    const model = providerModelOf(agent.model);
    const asked = Effect.gen(function* () {
      if ((yield* savedPayer(agent)) === AGENT_PAYER.API_KEY) return;
      yield* standingPlan;
    });
    return Effect.as(asked, {
      lines: [
        {
          type: INPUT_LINE.MODEL,
          ...(model === undefined
            ? undefined
            : { model: model.modelId, fast: model.speed === MODEL_SPEED.FAST }),
          ...(effort === undefined ? undefined : { effort }),
        },
      ],
    });
  };

  return {
    name: "Claude Code",
    runtime: SERVER_AGENT_HARNESS.CLAUDE_CODE,
    sessionPrefix: NATIVE_SESSION_PREFIX[CONVERSATION_RUNTIME.CLAUDE_CODE],
    launch: (agent) =>
      Effect.gen(function* () {
        return yield* (yield* savedPayer(agent)) === AGENT_PAYER.API_KEY
          ? apiKeyCredential(agent)
          : planCredential(agent);
      }),
    config,
    skillRoots: [SKILL_ROOT.CLAUDE],
    ahead,
  };
}

export const claudeCodeSessions = <Turn extends EveHostTurn = EveHostTurn>(
  options: RunnerSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, RunnerServices> =>
  runnerSessions<{ readonly _tag: string }, Turn>(claudeCode(options), options);
