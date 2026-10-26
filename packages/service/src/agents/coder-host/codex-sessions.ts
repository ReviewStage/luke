/**
 * codex-sessions.ts -- a coding agent's sessions on Codex: the runner in its Codex mode, launched on the account's ChatGPT sign-in, whose token the runner asks Luke's token route for, or on a local agent's Mac's own Codex sign-in.
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
 * - A local agent runs the Codex its Mac checked against the pin, in its
 *   folder there, its commands under Codex's own sandbox writing that
 *   folder (`@luke/agent-runner`'s `codex.ts`), and `CODEX_HOME` left as
 *   the developer's. Where its Mac said Codex holds a sign-in of its own,
 *   the launch hands it nothing of the account's and Codex runs and
 *   refreshes that sign-in itself; otherwise it runs on the account's saved
 *   credential as a cloud agent does, the plan's token asked of the route
 *   over HTTPS, so no token ever travels through the Mac's queue.
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
import { macDeviceLayout } from "@luke/database/models/mac-device-store";
import { openProviderKey, parseKeyRing } from "@luke/database/models/provider-key-seal";
import { listProviderKeyRows } from "@luke/database/models/provider-key-store";
import { CONVERSATION_RUNTIME } from "@luke/database/storage-vocabulary";
import { CODING_AGENT_MACHINE, CODING_AGENT_PAYER } from "@luke/features/coding-agent-wire";
import type { MacSignedIn } from "@luke/features/mac-agent-wire";
import { MODEL_PROVIDER } from "@luke/features/models-wire";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@luke/features/provider-key-wire";
import { Duration, Effect, Option, Redacted, Result } from "effect";
import { CHATGPT_ACCESS, refreshChatGptAccess } from "../../accounts/chatgpt-credentials.js";
import { HostedEnvironment } from "../../environment.js";
import { SERVER_AGENT_HARNESS } from "../../events/server-events.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import type { BrainHostTurn } from "../brain-host/bounds.js";
import { KEY_REFUSAL, PLAN_REFUSAL, type PlanRefusal } from "../brain-host/eve-sessions.js";
import { LaunchRefused, type MachineLayout } from "../machine/agent-machine.js";
import { SKILL_ROOT } from "../repository-skills.js";
import { NATIVE_SESSION_PREFIX } from "./native-runtime.js";
import {
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

/** A launch on its Mac's own Codex sign-in: nothing of the account's in its environment, and `CODEX_HOME` left as the developer's. */
const MAC_LOGIN: { readonly env: Readonly<Record<string, string>> } = { env: {} };

/**
 * Whether a local agent runs on its Mac's own Codex sign-in, by what the Mac
 * said of it: the one rule the launch's environment and its config are both
 * written by.
 */
function onMacLoginOf(agent: CodingAgent, signedIn: MacSignedIn): boolean {
  return agent.machine === CODING_AGENT_MACHINE.MAC && signedIn.codex === true;
}

/**
 * Where Codex keeps its threads: in a sandbox, the home the image made on its
 * persisted disk; on a Mac, the developer's own default, which the launch
 * leaves alone, since Codex's own sign-in is kept there
 * (https://learn.chatgpt.com/docs/auth).
 */
function homeOf(agent: CodingAgent): Readonly<Record<string, string>> {
  return agent.machine === CODING_AGENT_MACHINE.MAC ? {} : { [CODEX_HOME_ENV]: CODEX_PATH.HOME };
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

  /** Who pays for the agent, as recorded as it started; none for an agent from before payers were. */
  const payerOf = (agent: CodingAgent) =>
    Effect.map(readCodingAgentRouting(userId, agent.id), (routing) =>
      Option.getOrUndefined(Option.flatMapNullishOr(routing, (row) => row.payer)),
    );

  /**
   * Whether the agent runs on its starter's Mac and that Mac last said Codex
   * there holds a sign-in of its own (`mac_device.signed_in`), as `config`
   * reads it off the layout too (`onMacLoginOf`).
   */
  const onMacLogin = (agent: CodingAgent) =>
    agent.machine !== CODING_AGENT_MACHINE.MAC || agent.deviceId == null
      ? Effect.succeed(false)
      : Effect.map(macDeviceLayout(userId, agent.deviceId), (device) =>
          Option.exists(device, (standing) => onMacLoginOf(agent, standing.signedIn)),
        );

  /**
   * Where the account's saved credential pays for the agent: its own API key
   * for an agent started on it; for one started on its Mac's sign-in, signed
   * out since, the plan where the account keeps a ChatGPT sign-in, its key
   * where it keeps only that, and the plan's refusal where it keeps neither;
   * the plan for every other.
   */
  const savedPayer = (agent: CodingAgent) =>
    Effect.gen(function* () {
      const payer = yield* payerOf(agent);
      if (payer === CODING_AGENT_PAYER.API_KEY) return CODING_AGENT_PAYER.API_KEY;
      if (payer !== CODING_AGENT_PAYER.MAC_SIGN_IN) return CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION;
      const openai = (rows: readonly { readonly provider: string }[]) =>
        rows.some((row) => row.provider === PROVIDER_KEY_PROVIDER.OPENAI);
      if (openai(yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH))) {
        return CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION;
      }
      // Note that an account that saved neither is refused in the plan's words, as signed out, which its Mac now is.
      return openai(yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY))
        ? CODING_AGENT_PAYER.API_KEY
        : CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION;
    });

  /** Whether the agent's saved credential is its starter's own OpenAI API key rather than the plan. */
  const onApiKey = (agent: CodingAgent) =>
    Effect.map(savedPayer(agent), (payer) => payer === CODING_AGENT_PAYER.API_KEY);

  /**
   * The account's OpenAI API key opened, as `OPENAI_API_KEY`, which the
   * runner names as app-server's provider `env_key` in place of the plan's
   * token command; refused where the key is gone or unreadable, and never
   * turned to the plan.
   */
  const apiKeyEnv = (agent: CodingAgent) =>
    Effect.gen(function* () {
      const environment = yield* HostedEnvironment;
      const ring = environment.providerKeyEncryptionKeys;
      const parsed = ring === undefined ? undefined : parseKeyRing(ring);
      if (parsed === undefined || Result.isFailure(parsed)) {
        return yield* new LaunchRefused({ reason: "no key ring" });
      }
      const rows = yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY);
      const row = rows.find((each) => each.provider === PROVIDER_KEY_PROVIDER.OPENAI);
      if (row === undefined) {
        return yield* new LaunchRefused({ reason: "no API key", keyRefusal: KEY_REFUSAL.MISSING });
      }
      const opened = openProviderKey(
        parsed.success,
        { userId, provider: PROVIDER_KEY_PROVIDER.OPENAI, kind: PROVIDER_KEY_KIND.API_KEY },
        row,
      );
      if (Result.isFailure(opened)) {
        return yield* new LaunchRefused({
          reason: "API key unreadable",
          keyRefusal: KEY_REFUSAL.UNREADABLE,
        });
      }
      const env: Readonly<Record<string, string>> = {
        ...homeOf(agent),
        [RUNNER_ENV.OPENAI_API_KEY]: Redacted.value(opened.success),
      };
      return { env };
    });

  const planEnv = (agent: CodingAgent) => Effect.as(standingPlan, { env: homeOf(agent) });

  /**
   * The credential a launch starts with, chosen here alone: on a Mac whose
   * Codex holds a sign-in of its own, that sign-in, with nothing of the
   * account's in the environment, so no token is ever handed to the Mac;
   * otherwise the account's saved credential (`savedPayer`), its key in the
   * environment or the plan's token asked of Luke's route over HTTPS.
   */
  const launch = (agent: CodingAgent) =>
    Effect.gen(function* () {
      if (yield* onMacLogin(agent)) return MAC_LOGIN;
      return yield* (yield* onApiKey(agent)) ? apiKeyEnv(agent) : planEnv(agent);
    });

  const config = (
    agent: CodingAgent,
    layout: MachineLayout,
    resume: string | undefined,
    firstSequence: number,
    rewindBefore: string | undefined,
  ) =>
    Effect.gen(function* () {
      const model = codexModelOf(agent);
      if (model === undefined) return yield* new LaunchRefused({ reason: "model" });
      const local = agent.machine === CODING_AGENT_MACHINE.MAC;
      // Note that a Mac runs only the Codex it checked against the pin, and one that checked none runs no Codex agent.
      if (local && layout.codexExecutable === undefined) {
        return yield* new LaunchRefused({ reason: "no codex" });
      }
      const effort = effortOf(agent.effort);
      const written: CodexConfig = {
        harness: RUNNER_HARNESS.CODEX,
        cwd: layout.checkoutPath,
        executable: layout.codexExecutable ?? CODEX_PATH.EXECUTABLE,
        model,
        ...(effort === undefined ? undefined : { effort }),
        ...(providerModelOf(agent.model)?.fast === true ? { fast: true } : undefined),
        developerInstructions: yield* options.instructions(agent, layout),
        ...(resume === undefined ? undefined : { threadId: resume }),
        ...(rewindBefore === undefined ? undefined : { rewindBefore }),
        firstSequence,
        eventsUrl: options.eventsUrl,
        mcpUrl: options.mcpUrl,
        integrations: yield* options.integrations(agent),
        tokenUrl,
        installedSkills: layout.installedSkills,
        ...(layout.writableRoots.length === 0
          ? undefined
          : { writableRoots: layout.writableRoots }),
        ...(onMacLoginOf(agent, layout.signedIn) ? { ownLogin: true } : undefined),
        // The runner stays warm past the agent's turn, for the sweep to retire (`retireWarmRunner`).
        warm: true,
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
    // Note that an agent on its Mac's sign-in or its API key has no plan to ask, and its runner holds what it launched with.
    const asked = Effect.gen(function* () {
      if (yield* onMacLogin(agent)) return;
      if (yield* onApiKey(agent)) return;
      yield* standingPlan;
    });
    return Effect.as(asked, { lines: [choice] });
  };

  return {
    name: "Codex",
    runtime: SERVER_AGENT_HARNESS.CODEX,
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
