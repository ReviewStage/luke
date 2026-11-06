/**
 * claude-code-sessions.ts -- a coding agent's sessions on Claude Code: the runner in its Claude Code mode, launched on the account's setup-token.
 *
 * The `claude_code` implementation of `AgentSessions`
 * (`eve-host/eve-sessions.ts`), on the launch machinery every native
 * harness shares (`runner-sessions.ts`). What is Claude Code's own: the
 * runner's config names the image's `claude` and appends our coder
 * instructions to Claude Code's prompt; the plan's token, opened from the
 * account's sealed `claude_setup_token` row, is the launch's credential, or,
 * for an agent its starter's API key pays for, that key opened as
 * `ANTHROPIC_API_KEY`; a plan's is refused in its plan's words where the
 * row is gone, refused, unreadable, or at a limit whose named reset is
 * still ahead, so the agent waits on its plan and never turns to another
 * payer; in a sandbox the credential is held at its firewall, the CLI's
 * variable carrying a placeholder minted for the launch (`launchCredential`),
 * and on a host it is the variable's own; and every message to a running runner
 * goes behind a `model` line with the agent's model, effort, and fast mode
 * as they stand: a fast version runs its base model with Claude Code's own
 * fast mode on, which Anthropic bills to the account's usage credits. The
 * CLI's own session id is the conversation's `native_session`, which the
 * events route records from the runner's `init`, and a relaunch resumes.
 */

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

/** Anthropic's API: the one host the CLI sends its credential to, in either mode (CLI 2.1.304, as its requests were recorded). */
const ANTHROPIC_API = "api.anthropic.com";

/**
 * How the CLI sends each credential: the variable it reads it from, the
 * header it sends it in, named in lower case, and what goes ahead of it
 * there, as CLI 2.1.304's requests were recorded: the setup-token as a
 * bearer, and an API key in Anthropic's own `x-api-key`, each sent whole,
 * whatever its shape, so a placeholder keeps the CLI in its mode.
 */
const CLI_CREDENTIAL = {
  PLAN: { variable: RUNNER_ENV.CLAUDE_TOKEN, header: "authorization", scheme: BEARER_PREFIX },
  API_KEY: { variable: RUNNER_ENV.API_KEY, header: "x-api-key", scheme: "" },
} as const;

type CliCredential = (typeof CLI_CREDENTIAL)[keyof typeof CLI_CREDENTIAL];

/**
 * The credential as a launch hands it. On a host, which has no firewall of
 * ours, the CLI reads it from its variable itself. In a sandbox the
 * variable holds a placeholder minted for the launch, which keeps the CLI
 * in the same mode, and the firewall sets the real value in its place on
 * requests to Anthropic's API that carry the placeholder in the CLI's
 * header, so the credential never enters the sandbox.
 */
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

/** The effort the CLI takes for the agent's own, where it names one of the SDK's. */
function effortOf(effort: string): Effort | undefined {
  return Object.values(EFFORT).find((level) => level === effort);
}

/** Claude Code as the shared launch drives it, for one account. */
function claudeCode(options: RunnerSessionsOptions): RunnerHarness<{ readonly _tag: string }> {
  const { userId } = options;

  /**
   * The account's setup-token's row, where its plan may pay: refused in the
   * plan's words where it is gone, refused, or at a limit whose named reset
   * is still ahead. A launch and every message to a live runner ask it, so a
   * plan another agent's turn found refused stops this agent's too.
   */
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

  /** Who pays for the agent, as recorded as it started; none for an agent from before payers were. */
  const payerOf = (agent: Agent) =>
    Effect.map(readAgentRouting(userId, agent.id), (routing) =>
      Option.getOrUndefined(Option.flatMapNullishOr(routing, (row) => row.payer)),
    );

  /**
   * Where the account's saved credential pays for the agent: its own API key
   * for an agent started on it; for one started on its Mac's login, signed
   * out since, the plan where Settings lets it pay for agents, the account's
   * key otherwise, and the plan's refusal where it keeps neither; the plan
   * for every other.
   */
  const savedPayer = (agent: Agent) =>
    Effect.gen(function* () {
      const payer = yield* payerOf(agent);
      if (payer === AGENT_PAYER.API_KEY) return AGENT_PAYER.API_KEY;
      if (payer !== AGENT_PAYER.MAC_SIGN_IN) return AGENT_PAYER.CLAUDE_SUBSCRIPTION;
      const anthropic = (rows: readonly { readonly provider: string }[]) =>
        rows.some((row) => row.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC);
      // Note that the plan pays only where Settings lets it pay for agents, as Start decides (`providerRuntimeChoice`).
      const plans = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN);
      if (anthropic(plans.filter((row) => row.forAgents))) {
        return AGENT_PAYER.CLAUDE_SUBSCRIPTION;
      }
      // Note that an account that saved neither is refused in the plan's words, as signed out, which its Mac now is.
      return anthropic(yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY))
        ? AGENT_PAYER.API_KEY
        : AGENT_PAYER.CLAUDE_SUBSCRIPTION;
    });

  /** The deployment's ring, which every sealed credential opens under. */
  const keyRing = Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    const ring = environment.providerKeyEncryptionKeys;
    const parsed = ring === undefined ? undefined : parseKeyRing(ring);
    if (parsed === undefined || Result.isFailure(parsed)) {
      return yield* Effect.fail(new LaunchRefused({ reason: "no key ring" }));
    }
    return parsed.success;
  });

  /**
   * The account's Anthropic API key opened, as the CLI's documented
   * `ANTHROPIC_API_KEY` (https://code.claude.com/docs/en/agent-sdk/quickstart),
   * for an agent its starter's key pays for; refused where the key is gone
   * or unreadable, and never turned to the plan.
   */
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

  /** The CLI's credential and the variable it is read from: the account's plan token opened. */
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
        // Note that a host's older runner, bundled before Claude Code's command sandbox was removed, refuses a config without domains.
        allowedDomains: [],
        installedSkills: layout.installedSkills,
      };
      return written;
    });

  // The agent's model, effort, and fast mode as they stand go ahead of every message, which a change since the launch takes effect from.
  // Note that the plan is asked first, so a message to a live runner on a refused or limited plan is refused as a launch would be;
  // an agent on its API key has no plan to ask, and its runner holds the key it launched with.
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
    // Note that Claude Code reads a checkout's skills from `.claude/skills` alone.
    skillRoots: [SKILL_ROOT.CLAUDE],
    ahead,
  };
}

/** The sessions for one account, over the calling fiber's services. */
export const claudeCodeSessions = <Turn extends EveHostTurn = EveHostTurn>(
  options: RunnerSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, RunnerServices> =>
  runnerSessions<{ readonly _tag: string }, Turn>(claudeCode(options), options);
