import { CODEX_PIN } from "@repo/agent-runner/pins";
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
import { type Agent, readAgent, readAgentRouting } from "@repo/database/models/agent-store";
import {
  type FirewallOwner,
  type KeyRing,
  openProviderKey,
  parseKeyRing,
} from "@repo/database/models/provider-key-seal";
import { listProviderKeyRows } from "@repo/database/models/provider-key-store";
import { recordedRuntimeSession } from "@repo/database/models/recorded-session";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import { AGENT_MACHINE, AGENT_PAYER } from "@repo/features/agent-wire";
import { MODEL_PROVIDER, MODEL_SPEED } from "@repo/features/models-wire";
import { PROVIDER_KEY_KIND, PROVIDER_KEY_PROVIDER } from "@repo/features/provider-key-wire";
import { Duration, Effect, Option, Redacted, Result } from "effect";
import {
  CHATGPT_ACCESS,
  type ChatGptPlanIdentity,
  refreshChatGptAccess,
} from "../../accounts/chatgpt-credentials.js";
import { HostedEnvironment } from "../../environment.js";
import { SERVER_AGENT_HARNESS } from "../../events/server-events.js";
import { providerModelOf } from "../../providers/model-catalog.js";
import type { EveHostTurn } from "../eve-host/bounds.js";
import { KEY_REFUSAL, PLAN_REFUSAL, type PlanRefusal } from "../eve-host/eve-sessions.js";
import { LaunchRefused, type MachineLayout } from "../machine/agent-machine.js";
import { SKILL_ROOT } from "../repository-skills.js";
import {
  type FirewallSession,
  LAUNCH_SWAP,
  type LaunchSwapKind,
  newPlaceholder,
  type PlaceholderSwap,
  placeholderSwap,
  renewedSwap,
  sandboxFirewall,
} from "../sandbox-firewall.js";
import type { VercelSandboxApi } from "../vercel-sandbox-api.js";
import { firewallSourcesOfAgent } from "./checkout.js";
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
  readonly tokenUrl: string;
}

const CODEX_PATH = { EXECUTABLE: CODEX_PIN.LINK, HOME: CODEX_PIN.HOME } as const;

const CODEX_HOME_ENV = "CODEX_HOME";

export const CODEX_TOKEN_MARGIN = Duration.minutes(45);

const BEARER_HEADER = "authorization";

type SwapTarget = Pick<PlaceholderSwap, "domain" | "path">;

const OPENAI_API: SwapTarget = { domain: "api.openai.com" };

const PLAN_TARGET: SwapTarget = {
  domain: "chatgpt.com",
  path: { startsWith: "/backend-api/codex/" },
};

function planBackendEnv(plan: ChatGptPlanIdentity): Readonly<Record<string, string>> {
  return {
    [RUNNER_ENV.CODEX_PLAN_BACKEND]: CODEX_PLAN_BACKEND.CHATGPT,
    ...(plan.chatgptAccountId === undefined
      ? undefined
      : { [RUNNER_ENV.CHATGPT_ACCOUNT_ID]: plan.chatgptAccountId }),
  };
}

function bearerOf(token: string): Redacted.Redacted {
  return Redacted.make(`Bearer ${token}`);
}

function heldAtFirewall(
  kind: LaunchSwapKind,
  target: SwapTarget,
  variable: string,
  credential: Redacted.Redacted<string>,
  fingerprint?: Redacted.Redacted,
): NonNullable<HarnessLaunch["held"]> {
  const placeholder = Redacted.value(newPlaceholder());
  const entry = placeholderSwap({
    ...target,
    header: BEARER_HEADER,
    placeholder: bearerOf(placeholder),
    value: bearerOf(Redacted.value(credential)),
  });
  return {
    env: { [variable]: placeholder },
    kind,
    entry,
    ...(fingerprint === undefined ? undefined : { fingerprint }),
  };
}

const REFUSAL_OF_ACCESS = {
  [CHATGPT_ACCESS.NONE]: PLAN_REFUSAL.NONE,
  [CHATGPT_ACCESS.SIGNED_OUT]: PLAN_REFUSAL.SIGNED_OUT,
  [CHATGPT_ACCESS.UNREADABLE]: PLAN_REFUSAL.UNREADABLE,
  [CHATGPT_ACCESS.UNREACHABLE]: PLAN_REFUSAL.UNREACHABLE,
  [CHATGPT_ACCESS.LIMIT_REACHED]: PLAN_REFUSAL.LIMIT_REACHED,
  [CHATGPT_ACCESS.INELIGIBLE]: PLAN_REFUSAL.INELIGIBLE,
} as const satisfies Record<string, PlanRefusal>;

function effortOf(effort: string): CodexEffort | undefined {
  return Object.values(CODEX_EFFORT).find((level) => level === effort);
}

function speedKeysOf(agent: Agent): { readonly fast: boolean; readonly ultrafast?: true } {
  const speed = providerModelOf(agent.model)?.speed;
  if (speed === MODEL_SPEED.ULTRAFAST) return { fast: true, ultrafast: true };
  return { fast: speed === MODEL_SPEED.FAST };
}

function codexModelOf(agent: Agent): string | undefined {
  const model = providerModelOf(agent.model);
  return model?.provider === MODEL_PROVIDER.OPENAI ? model.modelId : undefined;
}

function homeOf(agent: Agent): Readonly<Record<string, string>> {
  return agent.machine === AGENT_MACHINE.DEVICE ? {} : { [CODEX_HOME_ENV]: CODEX_PATH.HOME };
}

function codex(options: CodexSessionsOptions): RunnerHarness<{ readonly _tag: string }> {
  const { userId, tokenUrl } = options;

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
    return { token: access.accessToken, plan: access.plan };
  });

  const payerOf = (agent: Agent) =>
    Effect.map(readAgentRouting(userId, agent.id), (routing) =>
      Option.getOrUndefined(Option.flatMapNullishOr(routing, (row) => row.payer)),
    );

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
      return openai(yield* listProviderKeyRows(userId, PROVIDER_KEY_KIND.API_KEY))
        ? AGENT_PAYER.API_KEY
        : AGENT_PAYER.CHATGPT_SUBSCRIPTION;
    });

  const onApiKey = (agent: Agent) =>
    Effect.map(savedPayer(agent), (payer) => payer === AGENT_PAYER.API_KEY);

  const apiKeyEnv = (agent: Agent) =>
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
      const key = opened.success;
      const launch: HarnessLaunch =
        agent.machine === AGENT_MACHINE.DEVICE
          ? { env: { ...homeOf(agent), [RUNNER_ENV.OPENAI_API_KEY]: Redacted.value(key) } }
          : {
              env: homeOf(agent),
              held: heldAtFirewall(
                LAUNCH_SWAP.OPENAI_KEY,
                OPENAI_API,
                RUNNER_ENV.OPENAI_API_KEY,
                key,
                key,
              ),
            };
      return launch;
    });

  const planEnv = (agent: Agent) =>
    Effect.map(standingPlan, ({ token, plan }): HarnessLaunch => {
      const env = { ...homeOf(agent), ...planBackendEnv(plan) };
      return agent.machine === AGENT_MACHINE.DEVICE
        ? { env }
        : {
            env,
            held: heldAtFirewall(
              LAUNCH_SWAP.OPENAI_PLAN,
              PLAN_TARGET,
              RUNNER_ENV.CODEX_TOKEN,
              token,
            ),
          };
    });

  const launch = (agent: Agent) =>
    Effect.gen(function* () {
      return yield* (yield* onApiKey(agent)) ? apiKeyEnv(agent) : planEnv(agent);
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
      const local = agent.machine === AGENT_MACHINE.DEVICE;
      if (local && layout.codexExecutable === undefined) {
        return yield* new LaunchRefused({ reason: "no codex" });
      }
      const effort = effortOf(agent.effort);
      const speed = speedKeysOf(agent);
      const written: CodexConfig = {
        harness: RUNNER_HARNESS.CODEX,
        cwd: layout.checkoutPath,
        executable: layout.codexExecutable ?? CODEX_PATH.EXECUTABLE,
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

  const ahead = (agent: Agent) => {
    const model = codexModelOf(agent);
    const effort = effortOf(agent.effort);
    const choice: InputLine = {
      type: INPUT_LINE.MODEL,
      ...(model === undefined ? undefined : { model, ...speedKeysOf(agent) }),
      ...(effort === undefined ? undefined : { effort }),
    };
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
    skillRoots: [SKILL_ROOT.AGENTS],
    ahead,
  };
}

export const PLAN_RENEWAL = {
  RENEWED: "renewed",
  LEFT: "left",
  UNANSWERED: "unanswered",
} as const;

const launchSession = (api: VercelSandboxApi, owner: FirewallOwner, agentId: string | undefined) =>
  Effect.gen(function* () {
    if (agentId === undefined) return undefined;
    const agent = yield* readAgent(owner.userId, agentId);
    if (Option.isNone(agent)) return undefined;
    const runtime = yield* recordedRuntimeSession({
      userId: owner.userId,
      conversationId: agent.value.conversationId,
    });
    if (runtime === undefined) return undefined;
    const sandboxes = yield* api.listTagged(runtime);
    const sandbox = sandboxes.find((each) => each.currentSessionId === owner.sandboxSessionId);
    if (sandbox === undefined) return undefined;
    return { ...owner, name: sandbox.name } satisfies FirewallSession;
  });

export const renewPlanSwap = (api: VercelSandboxApi, owner: FirewallOwner, ring: KeyRing) =>
  Effect.gen(function* () {
    const firewall = sandboxFirewall(api);
    const launch = yield* firewall.launchOf(owner);
    const standing = launch?.swaps.get(LAUNCH_SWAP.OPENAI_PLAN);
    if (launch === undefined || standing === undefined) return PLAN_RENEWAL.LEFT;
    const next = yield* Effect.gen(function* () {
      const access = yield* refreshChatGptAccess(owner.userId, ring, CODEX_TOKEN_MARGIN);
      if (access.outcome !== CHATGPT_ACCESS.READY) {
        yield* Effect.logWarning(
          `a Codex plan's swap was not renewed: ChatGPT sign-in ${access.outcome}`,
        );
        return PLAN_RENEWAL.UNANSWERED;
      }
      if (!Redacted.value(standing.rules).every(([swapped]) => swapped === PLAN_TARGET.domain)) {
        yield* Effect.logWarning(
          "a Codex plan's swap was not renewed: it stands on another host than the plan's",
        );
        return PLAN_RENEWAL.LEFT;
      }
      const entry = renewedSwap(standing, bearerOf(Redacted.value(access.accessToken)));
      if (entry === undefined) return PLAN_RENEWAL.LEFT;
      const session = yield* launchSession(api, owner, launch.agentId);
      if (session === undefined) return PLAN_RENEWAL.LEFT;
      return {
        session,
        entry,
        sources: yield* firewallSourcesOfAgent(owner.userId, launch.agentId),
      };
    }).pipe(
      Effect.catch((failure) =>
        Effect.as(
          Effect.logWarning(`a Codex plan's swap was not renewed: ${failure._tag}`),
          PLAN_RENEWAL.UNANSWERED,
        ),
      ),
    );
    if (typeof next === "string") return next;
    yield* firewall.renew(next.session, launch, LAUNCH_SWAP.OPENAI_PLAN, next.entry, next.sources);
    return PLAN_RENEWAL.RENEWED;
  });

export const codexSessions = <Turn extends EveHostTurn = EveHostTurn>(
  options: CodexSessionsOptions,
): Effect.Effect<NativeSessions<Turn>, never, RunnerServices> =>
  runnerSessions<{ readonly _tag: string }, Turn>(codex(options), options);
