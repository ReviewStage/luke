/**
 * claude-code-sessions.ts -- a coding agent's sessions on Claude Code: the runner in its Claude Code mode, launched on the account's setup-token.
 *
 * The `claude_code` implementation of `AgentSessions`
 * (`brain-host/eve-sessions.ts`), on the launch machinery every native
 * harness shares (`runner-sessions.ts`). What is Claude Code's own: the
 * runner's config names the image's `claude` and appends Luke's coder
 * instructions to Claude Code's prompt; the plan's token, opened from the
 * account's sealed `claude_setup_token` row, or an Anthropic API key in test
 * mode, is the launch's credential, refused in its plan's words where the
 * row is gone, refused, unreadable, or at a limit whose named reset is
 * still ahead, so the agent waits on its plan and never turns to another
 * payer; and every message to a running runner
 * goes behind a `model` line with the agent's model, effort, and fast mode
 * as they stand: a fast version runs its base model with Claude Code's own
 * fast mode on, which Anthropic bills to the account's usage credits. The
 * CLI's own session id is the conversation's `native_session`, which the
 * events route records from the runner's `init`, and a relaunch resumes.
 */

import {
  type ClaudeCodeConfig,
  EFFORT,
  type Effort,
  INPUT_LINE,
  RUNNER_ENV,
  RUNNER_HARNESS,
} from "@luke/agent-runner/protocol";
import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import { openProviderKey, parseKeyRing } from "@luke/database/models/provider-key-seal";
import { listProviderKeyRows } from "@luke/database/models/provider-key-store";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
  planLimitResetsAt,
} from "@luke/features/provider-key-wire";
import { Clock, Effect, Redacted, Result } from "effect";
import { HostedEnvironment } from "../../environment.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import type { BrainHostTurn } from "../brain-host/bounds.js";
import { PLAN_REFUSAL } from "../brain-host/eve-sessions.js";
import { CODER } from "./bounds.js";
import { NATIVE_SESSION_PREFIX } from "./native-runtime.js";
import {
  LaunchRefused,
  type RunnerHarness,
  type RunnerServices,
  type RunnerSessionsOptions,
  runnerSessions,
} from "./runner-sessions.js";
import type { NativeSessions } from "./runtime-sessions.js";

export { RUNNER_ENDED, runnerBearerDigest, runnerEnded } from "./runner-sessions.js";

/** What the sessions reach. */
export type ClaudeCodeServices = RunnerServices;

export interface ClaudeCodeSessionsOptions extends RunnerSessionsOptions {
  /** An Anthropic API key the CLI runs on in place of the account's plan: test mode alone. */
  readonly testApiKey?: Redacted.Redacted | undefined;
}

/** The image's `claude`, the binary the bundled SDK cannot find on its own (`agent-runtime/sandbox.ts`). */
const CLAUDE_EXECUTABLE =
  "/opt/luke/claude-agent-sdk/node_modules/@anthropic-ai/claude-agent-sdk-linux-x64/claude";

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
function claudeCode(options: ClaudeCodeSessionsOptions): RunnerHarness<{ readonly _tag: string }> {
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

  /** The CLI's credential and the variable it is read from: the test key, or the account's plan token opened. */
  const credential = Effect.gen(function* () {
    if (options.testApiKey !== undefined) {
      return { env: { [RUNNER_ENV.API_KEY]: Redacted.value(options.testApiKey) } };
    }
    const environment = yield* HostedEnvironment;
    const ring = environment.providerKeyEncryptionKeys;
    const parsed = ring === undefined ? undefined : parseKeyRing(ring);
    if (parsed === undefined || Result.isFailure(parsed)) {
      return yield* Effect.fail(new LaunchRefused({ reason: "no key ring" }));
    }
    const row = yield* standingPlan;
    const opened = openProviderKey(
      parsed.success,
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
    return { env: { [RUNNER_ENV.CLAUDE_TOKEN]: Redacted.value(opened.success) } };
  });

  const config = (agent: CodingAgent, resume: string | undefined, firstSequence: number) =>
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
        firstSequence,
        eventsUrl: options.eventsUrl,
        mcpUrl: options.mcpUrl,
        allowedDomains: [...ALLOWED_DOMAINS],
      };
      return written;
    });

  // The agent's model, effort, and fast mode as they stand go ahead of every message, which a change since the launch takes effect from.
  // Note that the plan is asked first, so a message to a live runner on a refused or limited plan is refused as a launch would be.
  const ahead = (agent: CodingAgent) => {
    const effort = effortOf(agent.effort);
    const model = providerModelOf(agent.model);
    const asked = options.testApiKey === undefined ? Effect.asVoid(standingPlan) : Effect.void;
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
    sessionPrefix: NATIVE_SESSION_PREFIX[CONVERSATION_RUNTIME.CLAUDE_CODE],
    launch: () => credential,
    config,
    ahead,
  };
}

/** The sessions for one account, over the calling fiber's services. */
export const claudeCodeSessions = <Turn extends BrainHostTurn = BrainHostTurn>(
  options: ClaudeCodeSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, ClaudeCodeServices> =>
  runnerSessions<{ readonly _tag: string }, Turn>(claudeCode(options), options);
