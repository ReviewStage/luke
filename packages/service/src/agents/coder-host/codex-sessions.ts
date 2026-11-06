/**
 * codex-sessions.ts -- a coding agent's sessions on Codex: the runner in its Codex mode, launched on the account's ChatGPT sign-in, whose token the runner asks our token route for, or on its OpenAI API key.
 *
 * The `codex` implementation of `AgentSessions`
 * (`sessions/agent-sessions.ts`), on the launch machinery every native
 * harness shares (`runner-sessions.ts`). What is Codex's own:
 *
 * - The runner's config names the image's `codex` and carries our coder
 *   instructions as the thread's `developer_instructions`, with the events
 *   and MCP URLs; the runner itself writes OpenAI's documented ChatGPT-plan
 *   provider into app-server's argv (`@repo/agent-runner`'s `codex.ts`). A
 *   relaunch names the conversation's `native_session`, Codex's thread id
 *   as the events route records it, for `thread/resume`.
 * - The launch's environment carries `CODEX_HOME` where its machine names
 *   one (`MachineLayout`'s `codexHome`): a sandbox's, on its persisted disk
 *   where the image made it, so a thread outlives a stop.
 * - On the plan, the runner asks our token route for the token
 *   (`../native-events/runner-token-app.ts`), so the launch declares no
 *   credential of the plan's and no token travels through a launch's
 *   environment or a host's queue. In a sandbox it signs app-server in on
 *   host-supplied ChatGPT tokens, the token and the workspace it pays from,
 *   and asks again whenever app-server asks it for fresh ones after a 401,
 *   so a turn outlives the hour a token lives; the sign-in that renews the
 *   token stays here. On a host app-server takes its bearer from the
 *   runner's token command as it needs one: as its turn's requests go out,
 *   every few minutes, and after a 401, and sends it to Codex's ChatGPT
 *   backend, which the runner is told to send its requests to
 *   (`planBackendEnv`).
 * - The token is the account's `chatgpt_oauth` row's, renewed first where
 *   less than the token margin is left of it (`refreshChatGptAccess`, under
 *   the row's lock). A launch, and each message, renews it so too before it
 *   goes out, which refuses one the sign-in can no longer pay for and
 *   leaves a fresh token to hand on. A sign-in the account does
 *   not hold, one OpenAI signed out, one the deployment cannot open, or
 *   OpenAI not answering fails the call with that refusal: an agent paid for
 *   by the plan never turns to another payer.
 * - An agent its starter's OpenAI API key pays for is launched with
 *   `OPENAI_API_KEY`, which the runner names as app-server's provider
 *   `env_key` in place of the token command, declared as a fixed credential:
 *   on a Mac the key opened, and in a sandbox a placeholder minted for the
 *   launch, the key swapped in for it at the firewall
 *   (`LAUNCH_SWAP.OPENAI_KEY`). It
 *   never asks the plan, and a key gone or unreadable refuses the launch.
 * - A `model` line with the agent's model and effort as they stand goes
 *   ahead of every message, as on Claude Code.
 * - The runner runs the Codex its machine names (`MachineLayout`'s
 *   `codexExecutable`): the image's in a sandbox, and on a Mac the one its
 *   host checked against the pin, `CODEX_HOME` left at its default under the
 *   agent's own home there; a Mac that checked none runs no Codex agent.
 */

import {
  CODEX_EFFORT,
  CODEX_PLAN_BACKEND,
  type CodexConfig,
  type CodexEffort,
  INPUT_LINE,
  type InputLine,
  RUNNER_ENV,
  RUNNER_HARNESS,
} from "@repo/agent-runner/protocol";
import { type Agent, readAgentRouting } from "@repo/database/models/agent-store";
import { PROVIDER_KEY_UNREADABLE, parseKeyRing } from "@repo/database/models/provider-key-seal";
import { listProviderKeyRows } from "@repo/database/models/provider-key-store";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { AGENT_PAYER } from "@repo/features/agent-wire";
import { MODEL_PROVIDER, MODEL_SPEED } from "@repo/features/models-wire";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { Duration, Effect, Option, type Redacted, Result } from "effect";
import {
  CHATGPT_ACCESS,
  type ChatGptPlanIdentity,
  refreshChatGptAccess,
} from "../../accounts/chatgpt-credentials.js";
import { ownApiKeyOf } from "../../accounts/own-api-key.js";
import { HostedEnvironment } from "../../environment.js";
import { SERVER_AGENT_HARNESS } from "../../events/server-events.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import {
  LaunchRefused,
  type MachineLayout,
  type RunnerCredential,
} from "../machine/agent-machine.js";
import { SKILL_ROOT } from "../repository-skills.js";
import { LAUNCH_SWAP, type PlaceholderSwap } from "../sandbox-firewall.js";
import {
  KEY_REFUSAL,
  PLAN_REFUSAL,
  type PlanRefusal,
  type SessionTurn,
} from "../sessions/agent-sessions.js";
import { NATIVE_SESSION_PREFIX } from "./native-runtime.js";
import {
  type HarnessLaunch,
  type RunnerHarness,
  type RunnerServices,
  type RunnerSessionsOptions,
  runnerSessions,
} from "./runner-sessions.js";
import type { NativeSessions } from "./runtime-sessions.js";

export interface CodexSessionsOptions extends RunnerSessionsOptions {
  /** Our token route, which the runner asks for the plan's token, mid-turn included (`RUNNER_TOKEN_PATH`). */
  readonly tokenUrl: string;
}

const CODEX_HOME_ENV = "CODEX_HOME";

/**
 * How much of an access token must be left for a launch, a message, or the
 * token route to go on with it, or it is renewed first: most of the hour
 * one lives, so every turn starts on a nearly fresh token, and every token
 * app-server is handed outlasts the five minutes a host's keeps one by far.
 */
export const CODEX_TOKEN_MARGIN = Duration.minutes(45);

/**
 * The header Codex sends an API key in, named in lower case as the firewall
 * matches it, and the scheme ahead of the key there.
 */
const BEARER_HEADER = "authorization";
const BEARER_SCHEME = "Bearer ";

/** Where a credential is swapped in at a sandbox's firewall: a host, and the paths under it where only some carry it. */
type SwapTarget = Pick<PlaceholderSwap, "domain" | "path">;

/** OpenAI's API as Codex reaches it from a sandbox: the one host it sends an API key to. */
const OPENAI_API: SwapTarget = { domain: "api.openai.com" };

/**
 * What tells a host's runner which backend the plan's launch sends its
 * requests to: Codex's ChatGPT backend, and the workspace it pays from,
 * where its ID token named one; a sandbox's runner, signed in on
 * host-supplied tokens, reads neither. Note that these sit in the launch's
 * environment, which its fingerprint digests, so a warm runner whose plan
 * was connected again under another workspace is relaunched.
 */
function planBackendEnv(plan: ChatGptPlanIdentity): Readonly<Record<string, string>> {
  return {
    [RUNNER_ENV.CODEX_PLAN_BACKEND]: CODEX_PLAN_BACKEND.CHATGPT,
    ...(plan.chatgptAccountId === undefined
      ? undefined
      : { [RUNNER_ENV.CHATGPT_ACCOUNT_ID]: plan.chatgptAccountId }),
  };
}

/** The account's OpenAI API key as a launch declares it: sent to OpenAI's API, fixed for the launch. */
function apiKeyCredential(key: Redacted.Redacted<string>): RunnerCredential {
  return {
    variable: RUNNER_ENV.OPENAI_API_KEY,
    value: key,
    target: OPENAI_API,
    header: BEARER_HEADER,
    scheme: BEARER_SCHEME,
    slot: LAUNCH_SWAP.OPENAI_KEY,
  };
}

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

/**
 * The service tiers the agent's model runs on, as the runner takes them: a
 * fast version on `fast`, and an Ultrafast one on `ultrafast` with `fast`
 * beside it, so a runner from before Ultrafast runs the fast tier rather
 * than the standard one. The runner asks for neither on the plan.
 */
function speedKeysOf(agent: Agent): { readonly fast: boolean; readonly ultrafast?: true } {
  const speed = providerModelOf(agent.model)?.speed;
  if (speed === MODEL_SPEED.ULTRAFAST) return { fast: true, ultrafast: true };
  return { fast: speed === MODEL_SPEED.FAST };
}

/** The model Codex is asked for: the agent's own, where it is one of OpenAI's. */
function codexModelOf(agent: Agent): string | undefined {
  const model = providerModelOf(agent.model);
  return model?.provider === MODEL_PROVIDER.OPENAI ? model.modelId : undefined;
}

/**
 * Where Codex keeps its threads: the home its machine names, as a sandbox
 * does on its persisted disk; else its default under the agent's own home,
 * as on a Mac (`@repo/host`'s `local-agent-box.ts`), which the launch leaves
 * alone.
 */
function homeOf(layout: Pick<MachineLayout, "codexHome">): Readonly<Record<string, string>> {
  return layout.codexHome === undefined ? {} : { [CODEX_HOME_ENV]: layout.codexHome };
}

/** Codex as the shared launch drives it, for one account. */
function codex(options: CodexSessionsOptions): RunnerHarness<{ readonly _tag: string }> {
  const { userId, tokenUrl } = options;

  /**
   * The account's sign-in asked whether it still pays, its access token
   * renewed first where it is due, answering the plan it pays from; the
   * runner asks the route for the token, so none is handed here.
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
    return access.plan;
  });

  /** Who pays for the agent, as recorded as it started; none for an agent from before payers were. */
  const payerOf = (agent: Agent) =>
    Effect.map(readAgentRouting(userId, agent.id), (routing) =>
      Option.getOrUndefined(Option.flatMapNullishOr(routing, (row) => row.payer)),
    );

  /**
   * Where the account's saved credential pays for the agent: its own API key
   * for an agent started on it; for one started on its Mac's sign-in, signed
   * out since, the plan where the account keeps a ChatGPT sign-in, its key
   * where it keeps only that, and the plan's refusal where it keeps neither;
   * the plan for every other.
   */
  const savedPayer = (agent: Agent) =>
    Effect.gen(function* () {
      const payer = yield* payerOf(agent);
      if (payer === AGENT_PAYER.API_KEY) return AGENT_PAYER.API_KEY;
      if (payer !== AGENT_PAYER.MAC_SIGN_IN) return AGENT_PAYER.CHATGPT_SUBSCRIPTION;
      const openai = (rows: readonly { readonly provider: string }[]) =>
        rows.some((row) => row.provider === PROVIDER_KEY_PROVIDER.OPENAI);
      if (openai(yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.CHATGPT_OAUTH))) {
        return AGENT_PAYER.CHATGPT_SUBSCRIPTION;
      }
      // Note that an account that saved neither is refused in the plan's words, as signed out, which its Mac now is.
      return openai(yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY))
        ? AGENT_PAYER.API_KEY
        : AGENT_PAYER.CHATGPT_SUBSCRIPTION;
    });

  /** Whether the agent's saved credential is its starter's own OpenAI API key rather than the plan. */
  const onApiKey = (agent: Agent) =>
    Effect.map(savedPayer(agent), (payer) => payer === AGENT_PAYER.API_KEY);

  /**
   * The account's OpenAI API key opened, declared as `OPENAI_API_KEY`, which
   * the runner names as app-server's provider `env_key` in place of the
   * plan's token command; a Preview's stand-in where the key is gone or
   * unreadable (`accounts/own-api-key.ts`); refused where neither is, and
   * never turned to the plan.
   */
  const apiKeyEnv = (layout: Pick<MachineLayout, "codexHome">) =>
    Effect.gen(function* () {
      const environment = yield* HostedEnvironment;
      const key = yield* ownApiKeyOf(userId, PROVIDER_KEY_PROVIDER.OPENAI, environment);
      if (key === undefined) {
        return yield* new LaunchRefused({ reason: "no API key", keyRefusal: KEY_REFUSAL.MISSING });
      }
      if (key === PROVIDER_KEY_UNREADABLE) {
        return yield* new LaunchRefused({
          reason: "API key unreadable",
          keyRefusal: KEY_REFUSAL.UNREADABLE,
        });
      }
      const launch: HarnessLaunch = { env: homeOf(layout), credentials: [apiKeyCredential(key)] };
      return launch;
    });

  /**
   * The plan asked, and the runner told the backend it pays through; the
   * runner asks our route for the plan's tokens, so no credential of the
   * plan's is declared here.
   */
  const planEnv = (layout: Pick<MachineLayout, "codexHome">) =>
    Effect.map(
      standingPlan,
      (plan): HarnessLaunch => ({ env: { ...homeOf(layout), ...planBackendEnv(plan) } }),
    );

  /**
   * The credential a launch starts with, chosen here alone: the account's
   * saved credential (`savedPayer`), its key, which the agent's machine
   * hands over as it decides, or the plan's token, asked of our route over
   * HTTPS.
   */
  const launch = (agent: Agent, layout: MachineLayout) =>
    Effect.gen(function* () {
      return yield* (yield* onApiKey(agent)) ? apiKeyEnv(layout) : planEnv(layout);
    });

  const config = (
    agent: Agent,
    layout: MachineLayout,
    resume: string | undefined,
    firstSequence: number,
    rewindBefore: string | undefined,
  ) =>
    Effect.gen(function* () {
      const model = codexModelOf(agent);
      if (model === undefined) return yield* new LaunchRefused({ reason: "model" });
      // Note that a Mac runs only the Codex it checked against the pin, and one that checked none runs no Codex agent.
      if (layout.codexExecutable === undefined) {
        return yield* new LaunchRefused({ reason: "no codex" });
      }
      const effort = effortOf(agent.effort);
      const speed = speedKeysOf(agent);
      const written: CodexConfig = {
        harness: RUNNER_HARNESS.CODEX,
        cwd: layout.checkoutPath,
        executable: layout.codexExecutable,
        model,
        ...(effort === undefined ? undefined : { effort }),
        ...(speed.fast ? speed : undefined),
        developerInstructions: yield* options.instructions(agent, layout),
        ...(resume === undefined ? undefined : { threadId: resume }),
        ...(rewindBefore === undefined ? undefined : { rewindBefore }),
        firstSequence,
        eventsUrl: options.eventsUrl,
        mcpUrl: options.mcpUrl,
        integrations: yield* options.integrations(agent),
        tokenUrl,
        installedSkills: layout.installedSkills,
      };
      return written;
    });

  // The agent's model and effort as they stand, once the plan is asked, as a launch asks it.
  const ahead = (agent: Agent) => {
    const model = codexModelOf(agent);
    const effort = effortOf(agent.effort);
    const choice: InputLine = {
      type: INPUT_LINE.MODEL,
      ...(model === undefined ? undefined : { model, ...speedKeysOf(agent) }),
      ...(effort === undefined ? undefined : { effort }),
    };
    // Note that an agent on its API key has no plan to ask, and its runner holds what it launched with.
    const asked = Effect.gen(function* () {
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
export const codexSessions = <Turn extends SessionTurn = SessionTurn>(
  options: CodexSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, RunnerServices> =>
  runnerSessions<{ readonly _tag: string }, Turn>(codex(options), options);
