/**
 * codex-sessions.ts -- a coding agent's sessions on Codex: the runner in its Codex mode, launched on the account's ChatGPT sign-in, whose token the runner asks Luke's token route for.
 *
 * The `codex` implementation of `AgentSessions`
 * (`brain-host/eve-sessions.ts`), on the launch machinery every native
 * harness shares (`runner-sessions.ts`). What is Codex's own:
 *
 * - The runner's config names the image's `codex` and carries Luke's coder
 *   instructions as the thread's `developer_instructions`, with the events
 *   and MCP URLs; the runner itself writes OpenAI's documented ChatGPT-plan
 *   provider into app-server's argv (`@luke/agent-runner`'s `codex.ts`). A
 *   relaunch names the conversation's `native_session`, Codex's thread id
 *   as the events route records it, for `thread/resume`.
 * - The launch's environment carries `CODEX_HOME`, on the sandbox's
 *   persisted disk where the image made it, so a thread outlives a stop.
 * - On the plan, the config names Luke's token route
 *   (`../native-events/runner-token-app.ts`), and app-server asks it for the
 *   token through the runner's token command as it needs one: as its turn's
 *   requests go out, every few minutes, and after a 401, so a turn outlives
 *   the hour a token lives. No token travels to the runner at all.
 * - The token is the account's `chatgpt_oauth` row's, renewed first where
 *   less than the token margin is left of it (`refreshChatGptAccess`, under
 *   the row's lock). A launch, and each message, renews it so too before it
 *   goes out, which refuses one the sign-in can no longer pay for and
 *   leaves the route a fresh token to hand on. A sign-in the account does
 *   not hold, one OpenAI signed out, one the deployment cannot open, or
 *   OpenAI not answering fails the call with that refusal: an agent paid for
 *   by the plan never turns to another payer.
 * - An agent its starter's OpenAI API key pays for is launched with that key
 *   opened as `OPENAI_API_KEY`, which the runner names as app-server's
 *   provider `env_key` in place of the token command; it never asks the
 *   plan, and a key gone or unreadable refuses the launch.
 * - A `model` line with the agent's model and effort as they stand goes
 *   ahead of every message, as on Claude Code.
 */

import { CODEX_PIN } from "@luke/agent-runner/pins";
import {
  CODEX_EFFORT,
  type CodexConfig,
  type CodexEffort,
  INPUT_LINE,
  type InputLine,
  RUNNER_ENV,
  RUNNER_HARNESS,
} from "@luke/agent-runner/protocol";
import { type CodingAgent, readCodingAgentRouting } from "@luke/database/models/coding-agent-store";
import { openProviderKey, parseKeyRing } from "@luke/database/models/provider-key-seal";
import { listProviderKeyRows } from "@luke/database/models/provider-key-store";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { CODING_AGENT_PAYER } from "@luke/features/coding-agent-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { Duration, Effect, Option, Redacted, Result } from "effect";
import { CHATGPT_ACCESS, refreshChatGptAccess } from "../../accounts/chatgpt-credentials.js";
import { HostedEnvironment } from "../../environment.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import type { BrainHostTurn } from "../brain-host/bounds.js";
import { PLAN_REFUSAL, type PlanRefusal } from "../brain-host/eve-sessions.js";
import { SKILL_ROOT } from "../repository-skills.js";
import { CODER } from "./bounds.js";
import { NATIVE_SESSION_PREFIX } from "./native-runtime.js";
import { NATIVE_SKILLS_PATH } from "./native-skills.js";
import {
  LaunchRefused,
  type RunnerHarness,
  type RunnerServices,
  type RunnerSessionsOptions,
  runnerSessions,
} from "./runner-sessions.js";
import type { NativeSessions } from "./runtime-sessions.js";

export interface CodexSessionsOptions extends RunnerSessionsOptions {
  /** Luke's token route, which the runner asks for the plan's token mid-turn (`RUNNER_TOKEN_PATH`). */
  readonly tokenUrl: string;
}

/** Where the image keeps Codex (`agent-runtime/sandbox-image.ts`'s `INSTALL_CODEX`): the binary, and the `CODEX_HOME` it made for `agent`. */
const CODEX_PATH = { EXECUTABLE: CODEX_PIN.LINK, HOME: CODEX_PIN.HOME } as const;

/** The variable Codex reads its home from. */
const CODEX_HOME_ENV = "CODEX_HOME";

/**
 * How much of an access token must be left for a launch, a message, or the
 * token route to go on with it, or it is renewed first: most of the hour
 * one lives, so every turn starts on a nearly fresh token, and every token
 * app-server is handed outlasts the five minutes it keeps one by far.
 */
export const CODEX_TOKEN_MARGIN = Duration.minutes(45);

/** The plan's refusal for each way the sign-in can fail to answer a token. */
const REFUSAL_OF_ACCESS = {
  [CHATGPT_ACCESS.NONE]: PLAN_REFUSAL.NONE,
  [CHATGPT_ACCESS.SIGNED_OUT]: PLAN_REFUSAL.SIGNED_OUT,
  [CHATGPT_ACCESS.UNREADABLE]: PLAN_REFUSAL.UNREADABLE,
  [CHATGPT_ACCESS.UNREACHABLE]: PLAN_REFUSAL.UNREACHABLE,
  [CHATGPT_ACCESS.LIMIT_REACHED]: PLAN_REFUSAL.LIMIT_REACHED,
  [CHATGPT_ACCESS.INELIGIBLE]: PLAN_REFUSAL.INELIGIBLE,
} as const satisfies Record<string, PlanRefusal>;

/** The effort Codex takes for the agent's own, where it names one of Codex's. */
function effortOf(effort: string): CodexEffort | undefined {
  return Object.values(CODEX_EFFORT).find((level) => level === effort);
}

/** The model Codex is asked for: the agent's own, where it is one of OpenAI's. */
function codexModelOf(agent: CodingAgent): string | undefined {
  const model = providerModelOf(agent.model);
  return model?.provider === MODEL_PROVIDER.OPENAI ? model.modelId : undefined;
}

/** Codex as the shared launch drives it, for one account. */
function codex(options: CodexSessionsOptions): RunnerHarness<{ readonly _tag: string }> {
  const { userId, tokenUrl } = options;

  /**
   * The account's sign-in asked whether it still pays, its access token
   * renewed first where it is due, so the route has a fresh one to hand on.
   * Note that the runner asks the route for the token, so none is handed to it.
   */
  const standingPlan = Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    const ring = environment.providerKeyEncryptionKeys;
    const parsed = ring === undefined ? undefined : parseKeyRing(ring);
    if (parsed === undefined || Result.isFailure(parsed)) {
      return yield* new LaunchRefused({
        reason: "no key ring",
        planRefusal: PLAN_REFUSAL.UNREADABLE,
      });
    }
    const access = yield* refreshChatGptAccess(userId, parsed.success, CODEX_TOKEN_MARGIN);
    if (access.outcome !== CHATGPT_ACCESS.READY) {
      return yield* new LaunchRefused({
        reason: `ChatGPT sign-in ${access.outcome}`,
        planRefusal: REFUSAL_OF_ACCESS[access.outcome],
        ...(access.outcome === CHATGPT_ACCESS.LIMIT_REACHED
          ? { planResetsAt: access.limitResetsAt }
          : undefined),
      });
    }
  });

  /** Whether the agent was started on its starter's own OpenAI API key rather than the plan, as recorded as it started. */
  const onApiKey = (agent: CodingAgent) =>
    Effect.map(readCodingAgentRouting(userId, agent.id), (routing) =>
      Option.exists(routing, (row) => row.payer === CODING_AGENT_PAYER.API_KEY),
    );

  /**
   * The account's OpenAI API key opened, as `OPENAI_API_KEY`, which the
   * runner names as app-server's provider `env_key` in place of the plan's
   * token command; refused where the key is gone or unreadable, and never
   * turned to the plan.
   */
  const apiKeyEnv = Effect.gen(function* () {
    const environment = yield* HostedEnvironment;
    const ring = environment.providerKeyEncryptionKeys;
    const parsed = ring === undefined ? undefined : parseKeyRing(ring);
    if (parsed === undefined || Result.isFailure(parsed)) {
      return yield* new LaunchRefused({ reason: "no key ring" });
    }
    const rows = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY);
    const row = rows.find((each) => each.provider === PROVIDER_KEY_PROVIDER.OPENAI);
    if (row === undefined) return yield* new LaunchRefused({ reason: "no API key" });
    const opened = openProviderKey(
      parsed.success,
      { userId, provider: PROVIDER_KEY_PROVIDER.OPENAI, kind: PROVIDER_KEY_KIND.API_KEY },
      row,
    );
    if (Result.isFailure(opened)) return yield* new LaunchRefused({ reason: "API key unreadable" });
    const env: Readonly<Record<string, string>> = {
      [CODEX_HOME_ENV]: CODEX_PATH.HOME,
      [RUNNER_ENV.OPENAI_API_KEY]: Redacted.value(opened.success),
    };
    return { env };
  });

  const planLaunch: Readonly<Record<string, string>> = { [CODEX_HOME_ENV]: CODEX_PATH.HOME };
  const planEnv = Effect.as(standingPlan, { env: planLaunch });

  const launch = (agent: CodingAgent) =>
    Effect.flatMap(onApiKey(agent), (keyed) => (keyed ? apiKeyEnv : planEnv));

  const config = (
    agent: CodingAgent,
    resume: string | undefined,
    firstSequence: number,
    rewindBefore: string | undefined,
  ) =>
    Effect.gen(function* () {
      const model = codexModelOf(agent);
      if (model === undefined) return yield* new LaunchRefused({ reason: "model" });
      const effort = effortOf(agent.effort);
      const written: CodexConfig = {
        harness: RUNNER_HARNESS.CODEX,
        cwd: CODER.CHECKOUT_PATH,
        executable: CODEX_PATH.EXECUTABLE,
        model,
        ...(effort === undefined ? undefined : { effort }),
        ...(providerModelOf(agent.model)?.fast === true ? { fast: true } : undefined),
        developerInstructions: yield* options.instructions(agent),
        ...(resume === undefined ? undefined : { threadId: resume }),
        ...(rewindBefore === undefined ? undefined : { rewindBefore }),
        firstSequence,
        eventsUrl: options.eventsUrl,
        mcpUrl: options.mcpUrl,
        integrations: yield* options.integrations(agent),
        tokenUrl,
        installedSkills: NATIVE_SKILLS_PATH.INSTALLED,
      };
      return written;
    });

  // The agent's model and effort as they stand, once the plan is asked, as a launch asks it.
  const ahead = (agent: CodingAgent) => {
    const model = codexModelOf(agent);
    const effort = effortOf(agent.effort);
    const choice: InputLine = {
      type: INPUT_LINE.MODEL,
      ...(model === undefined
        ? undefined
        : { model, fast: providerModelOf(agent.model)?.fast === true }),
      ...(effort === undefined ? undefined : { effort }),
    };
    // Note that an agent on its API key has no plan to ask, and its runner holds the key it launched with.
    const asked = Effect.flatMap(onApiKey(agent), (keyed) => (keyed ? Effect.void : standingPlan));
    return Effect.as(asked, { lines: [choice] });
  };

  return {
    name: "Codex",
    sessionPrefix: NATIVE_SESSION_PREFIX[CONVERSATION_RUNTIME.CODEX],
    launch,
    config,
    // Note that Codex reads a checkout's skills from `.agents/skills` alone.
    skillRoots: [SKILL_ROOT.AGENTS],
    ahead,
  };
}

/** The sessions for one account, over the calling fiber's services. */
export const codexSessions = <Turn extends BrainHostTurn = BrainHostTurn>(
  options: CodexSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, RunnerServices> =>
  runnerSessions<{ readonly _tag: string }, Turn>(codex(options), options);
