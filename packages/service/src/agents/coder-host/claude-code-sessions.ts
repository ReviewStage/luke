/**
 * claude-code-sessions.ts -- a coding agent's sessions on Claude Code: the runner in its Claude Code mode, launched on the account's setup-token.
 *
 * The `claude_code` implementation of `AgentSessions`
 * (`brain-host/eve-sessions.ts`), on the launch machinery every native
 * harness shares (`runner-sessions.ts`). What is Claude Code's own: the
 * runner's config names the image's `claude` and appends Luke's coder
 * instructions to Claude Code's prompt; the plan's token, opened from the
 * account's sealed `claude_setup_token` row, is the launch's credential, or,
 * for an agent its starter's API key pays for, that key opened as
 * `ANTHROPIC_API_KEY`; a plan's is refused in its plan's words where the
 * row is gone, refused, unreadable, or at a limit whose named reset is
 * still ahead, so the agent waits on its plan and never turns to another
 * payer; and every message to a running runner
 * goes behind a `model` line with the agent's model, effort, and fast mode
 * as they stand: a fast version runs its base model with Claude Code's own
 * fast mode on, which Anthropic bills to the account's usage credits. The
 * CLI's own session id is the conversation's `native_session`, which the
 * events route records from the runner's `init`, and a relaunch resumes.
 */

import { CLAUDE_EXECUTABLE } from "@luke/agent-runner/pins";
import {
  type ClaudeCodeConfig,
  EFFORT,
  type Effort,
  INPUT_LINE,
  RUNNER_ENV,
  RUNNER_HARNESS,
} from "@luke/agent-runner/protocol";
import { type CodingAgent, readCodingAgentRouting } from "@luke/database/models/coding-agent-store";
import { openProviderKey, parseKeyRing } from "@luke/database/models/provider-key-seal";
import { listProviderKeyRows } from "@luke/database/models/provider-key-store";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { CODING_AGENT_PAYER } from "@luke/features/coding-agent-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  planLimitResetsAt,
} from "@luke/features/provider-key-wire";
import { Clock, Effect, Option, Redacted, Result } from "effect";
import { HostedEnvironment } from "../../environment.js";
import { SERVER_AGENT_HARNESS } from "../../events/server-events.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import type { BrainHostTurn } from "../brain-host/bounds.js";
import { KEY_REFUSAL, PLAN_REFUSAL } from "../brain-host/eve-sessions.js";
import { LaunchRefused } from "../machine/agent-machine.js";
import { SKILL_ROOT } from "../repository-skills.js";
import { CODER } from "./bounds.js";
import { NATIVE_SESSION_PREFIX } from "./native-runtime.js";
import { NATIVE_SKILLS_PATH } from "./native-skills.js";
import {
  type RunnerHarness,
  type RunnerServices,
  type RunnerSessionsOptions,
  runnerSessions,
} from "./runner-sessions.js";
import type { NativeSessions } from "./runtime-sessions.js";

/** The hosts a command the agent runs may reach through Claude Code's command sandbox: GitHub and the package registries. */
const ALLOWED_DOMAINS = [
  "github.com",
  "*.github.com",
  "*.githubusercontent.com",
  "registry.npmjs.org",
  "*.npmjs.org",
  "pypi.org",
  "files.pythonhosted.org",
] as const;

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

  /** Whether the agent was started on its starter's own Anthropic API key rather than the plan, as recorded as it started. */
  const onApiKey = (agent: CodingAgent) =>
    Effect.map(readCodingAgentRouting(userId, agent.id), (routing) =>
      Option.exists(routing, (row) => row.payer === CODING_AGENT_PAYER.API_KEY),
    );

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
  const apiKeyCredential = Effect.gen(function* () {
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
    const env: Readonly<Record<string, string>> = {
      [RUNNER_ENV.API_KEY]: Redacted.value(opened.success),
    };
    return { env };
  });

  /** The CLI's credential and the variable it is read from: the account's plan token opened. */
  const planCredential = Effect.gen(function* () {
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
    const env: Readonly<Record<string, string>> = {
      [RUNNER_ENV.CLAUDE_TOKEN]: Redacted.value(opened.success),
    };
    return { env };
  });

  const config = (
    agent: CodingAgent,
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
        cwd: CODER.CHECKOUT_PATH,
        executable: CLAUDE_EXECUTABLE,
        model: model.modelId,
        ...(effort === undefined ? undefined : { effort }),
        ...(model.fast ? { fast: true } : undefined),
        append: yield* options.instructions(agent),
        ...(resume === undefined ? undefined : { resume }),
        ...(rewindBefore === undefined ? undefined : { rewindBefore }),
        firstSequence,
        eventsUrl: options.eventsUrl,
        mcpUrl: options.mcpUrl,
        integrations: yield* options.integrations(agent),
        allowedDomains: [...ALLOWED_DOMAINS],
        installedSkills: NATIVE_SKILLS_PATH.INSTALLED,
        // The runner stays warm past the agent's turn, for the sweep to retire (`retireWarmRunner`).
        warm: true,
      };
      return written;
    });

  // The agent's model, effort, and fast mode as they stand go ahead of every message, which a change since the launch takes effect from.
  // Note that the plan is asked first, so a message to a live runner on a refused or limited plan is refused as a launch would be;
  // an agent on its API key has no plan to ask, and its runner holds the key it launched with.
  const ahead = (agent: CodingAgent) => {
    const effort = effortOf(agent.effort);
    const model = providerModelOf(agent.model);
    const asked = Effect.flatMap(onApiKey(agent), (keyed) =>
      keyed ? Effect.void : Effect.asVoid(standingPlan),
    );
    return Effect.as(asked, {
      lines: [
        {
          type: INPUT_LINE.MODEL,
          ...(model === undefined ? undefined : { model: model.modelId, fast: model.fast }),
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
      Effect.flatMap(onApiKey(agent), (keyed) => (keyed ? apiKeyCredential : planCredential)),
    config,
    // Note that Claude Code reads a checkout's skills from `.claude/skills` alone.
    skillRoots: [SKILL_ROOT.CLAUDE],
    ahead,
  };
}

/** The sessions for one account, over the calling fiber's services. */
export const claudeCodeSessions = <Turn extends BrainHostTurn = BrainHostTurn>(
  options: RunnerSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, RunnerServices> =>
  runnerSessions<{ readonly _tag: string }, Turn>(claudeCode(options), options);
