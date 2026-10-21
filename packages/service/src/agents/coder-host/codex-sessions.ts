/**
 * codex-sessions.ts -- a coding agent's sessions on Codex: the runner in its Codex mode, launched on the account's ChatGPT sign-in, and handed each renewed access token.
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
 *   persisted disk where the image made it, so a thread outlives a stop,
 *   and the plan's access token as `ACCESS_TOKEN`, the provider's `env_key`.
 * - The token is the account's `chatgpt_oauth` row's, renewed first where
 *   less than the launch margin is left of it (`refreshChatGptAccess`, under
 *   the row's lock). A sign-in the account does not hold, one OpenAI signed
 *   out, one the deployment cannot open, or OpenAI not answering fails the
 *   call with that refusal: an agent paid for by the plan never turns to
 *   another payer. An OpenAI API key stands in for it in test mode.
 * - The token lives an hour, so each message to a running runner reads the
 *   account's token again, renewed where it is due, and where it is another
 *   than the one the runner holds, a `token` line goes ahead of the message:
 *   the runner restarts app-server with it and resumes the thread before
 *   its next turn. Which token the runner holds is kept as its expiry, in a
 *   tag, never the token. A `model` line with the agent's model and effort
 *   as they stand goes ahead of every message, as on Claude Code.
 *
 * The token travels in the command's environment and on stdin alone, never
 * in argv, the config line, a tag, or a log.
 */

import {
  CODEX_EFFORT,
  type CodexConfig,
  type CodexEffort,
  INPUT_LINE,
  type InputLine,
  RUNNER_ENV,
  RUNNER_HARNESS,
} from "@luke/agent-runner/protocol";
import type { CodingAgent } from "@luke/database/models/coding-agent-store";
import { parseKeyRing } from "@luke/database/models/provider-key-seal";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { Duration, Effect, Redacted, Result } from "effect";
import { CHATGPT_ACCESS, refreshChatGptAccess } from "../../accounts/chatgpt-credentials.js";
import { HostedEnvironment } from "../../environment.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import type { BrainHostTurn } from "../brain-host/bounds.js";
import { PLAN_REFUSAL, type PlanRefusal } from "../brain-host/eve-sessions.js";
import { CODER } from "./bounds.js";
import { NATIVE_SESSION_PREFIX } from "./native-runtime.js";
import {
  AGENT_USER,
  LaunchRefused,
  type RunnerHarness,
  type RunnerServices,
  type RunnerSessionsOptions,
  runnerSessions,
} from "./runner-sessions.js";
import type { NativeSessions } from "./runtime-sessions.js";

/** What the sessions reach: the shared launch's services, OpenAI's token endpoint among them. */
export type CodexServices = RunnerServices;

export interface CodexSessionsOptions extends RunnerSessionsOptions {
  /** An OpenAI API key Codex runs on in place of the account's plan: test mode alone. */
  readonly testApiKey?: Redacted.Redacted | undefined;
}

/** Where the image keeps Codex (`agent-runtime/sandbox.ts`'s `INSTALL_CODEX`): the binary, and the `CODEX_HOME` it made for `agent`. */
const CODEX_PATH = {
  EXECUTABLE: "/usr/local/bin/codex",
  HOME: `/home/${AGENT_USER}/.codex`,
} as const;

/** The variable Codex reads its home from. */
const CODEX_HOME_ENV = "CODEX_HOME";

/**
 * How much of an access token must be left for a launch or a message to go
 * out on it, or it is renewed first: room for the turn it starts to begin,
 * past the store's own margin.
 */
const LAUNCH_MARGIN = Duration.minutes(15);

/** The plan's refusal for each way the sign-in can fail to answer a token. */
const REFUSAL_OF_ACCESS = {
  [CHATGPT_ACCESS.NONE]: PLAN_REFUSAL.NONE,
  [CHATGPT_ACCESS.SIGNED_OUT]: PLAN_REFUSAL.SIGNED_OUT,
  [CHATGPT_ACCESS.UNREADABLE]: PLAN_REFUSAL.UNREADABLE,
  [CHATGPT_ACCESS.UNREACHABLE]: PLAN_REFUSAL.UNREACHABLE,
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

/** A token as the runner holds it: its secret, and the stamp that tells it apart, its expiry. */
interface HeldToken {
  readonly accessToken: string;
  readonly stamp: string | undefined;
}

/** Codex as the shared launch drives it, for one account. */
function codex(options: CodexSessionsOptions): RunnerHarness<{ readonly _tag: string }> {
  const { userId } = options;

  /** The token Codex runs on: the test key, or the account's access token, renewed first where it is due. */
  const token = Effect.gen(function* () {
    if (options.testApiKey !== undefined) {
      const held: HeldToken = { accessToken: Redacted.value(options.testApiKey), stamp: undefined };
      return held;
    }
    const environment = yield* HostedEnvironment;
    const ring = environment.providerKeyEncryptionKeys;
    const parsed = ring === undefined ? undefined : parseKeyRing(ring);
    if (parsed === undefined || Result.isFailure(parsed)) {
      return yield* new LaunchRefused({
        reason: "no key ring",
        planRefusal: PLAN_REFUSAL.UNREADABLE,
      });
    }
    const access = yield* refreshChatGptAccess(userId, parsed.success, LAUNCH_MARGIN);
    if (access.outcome !== CHATGPT_ACCESS.READY) {
      return yield* new LaunchRefused({
        reason: `ChatGPT sign-in ${access.outcome}`,
        planRefusal: REFUSAL_OF_ACCESS[access.outcome],
      });
    }
    const held: HeldToken = {
      accessToken: Redacted.value(access.accessToken),
      stamp: String(access.expiresAt.getTime()),
    };
    return held;
  });

  const launch = () =>
    Effect.map(token, (held) => ({
      env: { [RUNNER_ENV.CODEX_TOKEN]: held.accessToken, [CODEX_HOME_ENV]: CODEX_PATH.HOME },
      stamp: held.stamp,
    }));

  const config = (agent: CodingAgent, resume: string | undefined, firstSequence: number) =>
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
        developerInstructions: yield* options.instructions(agent),
        ...(resume === undefined ? undefined : { threadId: resume }),
        firstSequence,
        eventsUrl: options.eventsUrl,
        mcpUrl: options.mcpUrl,
      };
      return written;
    });

  // A renewed token goes first, so the turn the message starts runs on it; then the agent's model and effort as they stand.
  const ahead = (agent: CodingAgent, stamp: string | undefined) =>
    Effect.map(token, (held) => {
      const model = codexModelOf(agent);
      const effort = effortOf(agent.effort);
      const choice: InputLine = {
        type: INPUT_LINE.MODEL,
        ...(model === undefined ? undefined : { model }),
        ...(effort === undefined ? undefined : { effort }),
      };
      const renewed: readonly InputLine[] =
        held.stamp === stamp ? [] : [{ type: INPUT_LINE.TOKEN, accessToken: held.accessToken }];
      return { lines: [...renewed, choice], stamp: held.stamp };
    });

  return {
    name: "Codex",
    sessionPrefix: NATIVE_SESSION_PREFIX[CONVERSATION_RUNTIME.CODEX],
    launch,
    config,
    ahead,
  };
}

/** The sessions for one account, over the calling fiber's services. */
export const codexSessions = <Turn extends BrainHostTurn = BrainHostTurn>(
  options: CodexSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, CodexServices> =>
  runnerSessions<{ readonly _tag: string }, Turn>(codex(options), options);
