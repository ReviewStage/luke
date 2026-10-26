/**
 * agent-runtime-choice.ts -- the runtime a new coding agent runs on and who pays for it, decided once as it starts.
 *
 * An agent runs on a native harness when, and only when, that provider's
 * plan pays for it. The plan is offered to every account that connected it:
 *
 * - Claude Code, paid for by the account's Claude plan, on any Claude model,
 *   a fast version running with Claude Code's own fast mode on, where the
 *   account keeps a Claude setup-token and this function reaches a harness
 *   (`NativeAgentSessions`: a web function's own, or the eve app's relay to
 *   one, so a Start from an eve agent decides as the panel's does).
 * - Codex, paid for by the account's ChatGPT plan, on the same terms for a
 *   GPT model; Codex runs no fast mode on the plan, so an account whose
 *   ChatGPT plan pays is offered no GPT fast version (`accountFastOffer`), where the account
 *   keeps a ChatGPT sign-in (`chatgpt_oauth`)
 *   that OpenAI has not signed out and the deployment can still open.
 *
 * Settings' choice for that harness decides: the plan where its row's
 * `forAgents` is on (Subscription) and the plan is offered, the account's
 * own API key for the model's provider otherwise: where this function
 * reaches a harness, on Claude Code, as its documented `ANTHROPIC_API_KEY`,
 * for a Claude model, and on Codex, as its provider's `env_key`, for a GPT
 * model; on eve where it reaches none. Luke's own key
 * pays for no coding agent: an account with neither is refused by name
 * (`AgentCredentialMissing`, which names the provider), and connects one in
 * Settings › Agents. A brand-new account starts no coding agent until it
 * connects a subscription or saves an API key.
 *
 * The choice is written on the agent as it is made and never changes: a
 * plan that later runs out or is disconnected pauses the agent, and never
 * moves it to another payer.
 *
 * Where the agent runs is chosen beside it (`agentMachineChoice`): a Vercel
 * Sandbox, or, where the Start names one of the starter's Macs, that Mac, on
 * the same runtime and payer a cloud agent would run on. Its Macs are offered
 * (`macOffers`) only to an account with the `local-agents` experiment on,
 * each that beat within `THIS_MAC.FRESH`, and the agent is pinned to the one
 * the Start named, once it is checked to be among them. A local agent runs
 * Claude Code, or Codex on a Mac that registered a Codex it checked; one on
 * Codex on a Mac with none, or on no harness at all, is refused by name. A
 * local agent whose Mac is signed in to the model's harness itself, Claude
 * Code for a Claude model or Codex for a GPT model, runs on that login
 * (`localAgentRuntimeChoice`), whatever the account saved in Luke, and that
 * Mac offers the harness's models whether or not the account could pay for
 * them.
 */

import type { DatabaseServices } from "@luke/database/core/query";
import { accountExperimentOn } from "@luke/database/models/account-store";
import { type MacDevice, macDevicesSeenSince } from "@luke/database/models/mac-device-store";
import { openProviderKey, parseKeyRing } from "@luke/database/models/provider-key-seal";
import {
  listAccountProviderKeyRows,
  type ProviderKeyRow,
} from "@luke/database/models/provider-key-store";
import { CONVERSATION_RUNTIME, type ConversationRuntime } from "@luke/database/storage-vocabulary";
import {
  CODING_AGENT_MACHINE,
  CODING_AGENT_PAYER,
  type CodingAgentMachine,
  type CodingAgentPayer,
  LOCAL_AGENT_REFUSAL,
  type LocalAgentRefusal,
  MAC_PRESENCE,
} from "@luke/features/coding-agent-wire";
import { type MacOffer, MODEL_PROVIDER, type ModelProvider } from "@luke/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@luke/features/provider-key-wire";
import { EXPERIMENT } from "@luke/settings";
import { Clock, Data, Duration, Effect, Option, type Redacted, Result } from "effect";
import { HostedEnvironment } from "../../environment.js";
import type { StoreFailure } from "../../http/store-failure.js";
import { type AccountFastOffer, providerModelOf } from "../../providers/model-catalog.js";
import { NativeAgentSessions } from "./runtime-sessions.js";

/** No credential of the account's pays for a coding agent on the provider's models: neither its subscription, selected in Settings, nor its API key. */
export class AgentCredentialMissing extends Data.TaggedError("AgentCredentialMissing")<{
  readonly provider: ModelProvider;
}> {}

/** A Start on This Mac that cannot run there, and why. */
export class LocalAgentRefused extends Data.TaggedError("LocalAgentRefused")<{
  readonly reason: LocalAgentRefusal;
}> {}

export const THIS_MAC = {
  /** How lately a Mac must have beaten for Start to offer it: one beat, and room for the next to arrive. */
  FRESH: Duration.millis(MAC_PRESENCE.FRESH_MS),
} as const;

/** Where a new agent runs: its machine, and the Mac a local agent is pinned to. */
export interface AgentMachineChoice {
  readonly machine: CodingAgentMachine;
  readonly deviceId: string | undefined;
}

const IN_A_SANDBOX: AgentMachineChoice = {
  machine: CODING_AGENT_MACHINE.VERCEL,
  deviceId: undefined,
};

/** What a new agent runs on, and who pays for it. The type keeps no payer readable for a row from before payers were recorded; a new agent always names one. */
export interface AgentRuntimeChoice {
  readonly runtime: ConversationRuntime;
  readonly payer: CodingAgentPayer | undefined;
}

const ON_API_KEY: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.EVE,
  payer: CODING_AGENT_PAYER.API_KEY,
};

const ON_CLAUDE_CODE: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  payer: CODING_AGENT_PAYER.CLAUDE_SUBSCRIPTION,
};

/** Claude Code on the account's own Anthropic API key, the CLI's documented `ANTHROPIC_API_KEY`. */
const ON_CLAUDE_CODE_API_KEY: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  payer: CODING_AGENT_PAYER.API_KEY,
};

/** Codex on the account's own OpenAI API key, through its provider's documented `env_key`. */
const ON_CODEX_API_KEY: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CODEX,
  payer: CODING_AGENT_PAYER.API_KEY,
};

/** Codex on a local agent's own Mac, by Codex's own sign-in there, which needs no credential of the account's. */
const ON_MAC_CODEX: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CODEX,
  payer: CODING_AGENT_PAYER.MAC_SIGN_IN,
};

/** Claude Code on a local agent's own Mac, by Claude Code's login there, which needs no credential of the account's. */
const ON_MAC_CLAUDE_CODE: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  payer: CODING_AGENT_PAYER.MAC_SIGN_IN,
};

const ON_CODEX: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CODEX,
  payer: CODING_AGENT_PAYER.CHATGPT_SUBSCRIPTION,
};

/** The statuses of a ChatGPT sign-in an agent cannot launch on: OpenAI signed it out or said the account is not eligible, or the deployment cannot open it. */
const UNUSABLE_SIGN_IN: ReadonlySet<string> = new Set([
  PROVIDER_KEY_STATUS.INVALID,
  PROVIDER_KEY_STATUS.INELIGIBLE,
  PROVIDER_KEY_STATUS.UNREADABLE,
]);

/**
 * The account's stored credentials of every kind, read once: what each
 * decision below is made from, so a request that makes several, such as a
 * Start's menu and its payer, reads them in one statement.
 */
export type AccountKeyRows = readonly ProviderKeyRow[];

/** The account's credentials, as handed where a caller read them already, or read now. */
const keyRowsOf = (
  userId: string,
  rows: AccountKeyRows | undefined,
): Effect.Effect<AccountKeyRows, StoreFailure, DatabaseServices> =>
  rows === undefined ? listAccountProviderKeyRows(userId) : Effect.succeed(rows);

/**
 * The plan credential the provider's harness launches on, as the account
 * keeps it among `rows`, or none, as above. A ChatGPT sign-in must also open under the
 * deployment's ring as it stands, since a row sealed under a key since
 * rotated out still reads as its last stored status.
 */
function keptPlan(
  userId: string,
  provider: string,
  ring: Redacted.Redacted | undefined,
  rows: AccountKeyRows,
): ProviderKeyRow | undefined {
  if (provider === MODEL_PROVIDER.ANTHROPIC) {
    return rows.find(
      (row) =>
        row.kind === PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN &&
        row.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC,
    );
  }
  const parsed = ring === undefined ? undefined : parseKeyRing(ring);
  if (parsed === undefined || Result.isFailure(parsed)) return undefined;
  const owner = {
    userId,
    provider: PROVIDER_KEY_PROVIDER.OPENAI,
    kind: PROVIDER_KEY_KIND.CHATGPT_OAUTH,
  };
  return rows.find(
    (row) =>
      row.kind === PROVIDER_KEY_KIND.CHATGPT_OAUTH &&
      row.provider === PROVIDER_KEY_PROVIDER.OPENAI &&
      !UNUSABLE_SIGN_IN.has(row.status) &&
      Result.isSuccess(openProviderKey(parsed.success, owner, row)),
  );
}

/** The plan's runtime and payer for a model of the provider's: Claude Code for Anthropic's, Codex for OpenAI's. */
const onPlanOf = (provider: string): AgentRuntimeChoice =>
  provider === MODEL_PROVIDER.ANTHROPIC ? ON_CLAUDE_CODE : ON_CODEX;

/** Whether the account saved its own API key for the provider among `rows`, which pays for its agents on eve. */
function keepsApiKey(provider: ModelProvider, rows: AccountKeyRows): boolean {
  return rows.some((row) => row.kind === PROVIDER_KEY_KIND.API_KEY && row.provider === provider);
}

/** The provider of a model the catalog offers; every model a Start accepted has one, so none is a defect. */
const providerOfModel = (model: string): Effect.Effect<ModelProvider> => {
  const named = providerModelOf(model);
  return named === undefined
    ? Effect.die(new Error(`no provider for the model ${model}`))
    : Effect.succeed(named.provider);
};

/** The deployment's key ring a sealed sign-in opens under, where it has one. */
const deploymentRing = Effect.map(
  Effect.serviceOption(HostedEnvironment),
  (environment) => Option.getOrUndefined(environment)?.providerKeyEncryptionKeys,
);

/** The runtime and payer of a new agent of the account's on a model of the provider's, by Settings' choice among `rows`, or refused where no credential of the account's pays, as above. */
const providerRuntimeChoice = Effect.fnUntraced(function* (
  userId: string,
  provider: ModelProvider,
  rows: AccountKeyRows,
): Effect.fn.Return<AgentRuntimeChoice, AgentCredentialMissing> {
  const harness = Option.isSome(yield* Effect.serviceOption(NativeAgentSessions));
  const plan = harness ? keptPlan(userId, provider, yield* deploymentRing, rows) : undefined;
  if (plan?.forAgents === true) return onPlanOf(provider);
  // Luke's key pays for no coding agent, so an account with no API key of the provider's is refused by name.
  if (!keepsApiKey(provider, rows))
    return yield* Effect.fail(new AgentCredentialMissing({ provider }));
  if (!harness) return ON_API_KEY;
  return provider === MODEL_PROVIDER.ANTHROPIC ? ON_CLAUDE_CODE_API_KEY : ON_CODEX_API_KEY;
});

/**
 * The runtime and payer of a new agent of the account's on the model given,
 * as above, decided from `rows` where the caller read them already.
 */
export const agentRuntimeChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  model: string,
  rows?: AccountKeyRows,
): Effect.fn.Return<AgentRuntimeChoice, StoreFailure | AgentCredentialMissing, DatabaseServices> {
  const provider = yield* providerOfModel(model);
  return yield* providerRuntimeChoice(userId, provider, yield* keyRowsOf(userId, rows));
});

/** The model providers a Mac may run a Start of: Claude Code's, and Codex's on a Mac that checked a Codex (`runsCodex`). */
const MAC_PROVIDERS: readonly ModelProvider[] = [MODEL_PROVIDER.ANTHROPIC, MODEL_PROVIDER.OPENAI];

/** Whether the Mac runs Codex agents: it registered a Codex it checked against the pin. */
const runsCodex = (device: MacDevice): boolean => device.codexExecutable !== null;

/**
 * Whether the Mac runs a Start of the provider's models: Claude Code's
 * anywhere, Codex's where it checked a Codex; where the account pays for the
 * harness in Luke (`paid`), or the Mac is signed in to it itself.
 */
function macRunsProvider(
  device: MacDevice,
  provider: ModelProvider,
  paid: readonly ModelProvider[],
): boolean {
  if (provider === MODEL_PROVIDER.ANTHROPIC) {
    return paid.includes(provider) || device.signedIn.claudeCode === true;
  }
  return runsCodex(device) && (paid.includes(provider) || device.signedIn.codex === true);
}

/** The provider whose models a native runtime runs, which the Mac a Start names must list. */
const RUNTIME_PROVIDER = {
  [CONVERSATION_RUNTIME.CLAUDE_CODE]: MODEL_PROVIDER.ANTHROPIC,
  [CONVERSATION_RUNTIME.CODEX]: MODEL_PROVIDER.OPENAI,
} as const;

/** The native runtime that runs a provider's models: the harness a Mac launches for it. */
const RUNTIME_OF = {
  [MODEL_PROVIDER.ANTHROPIC]: CONVERSATION_RUNTIME.CLAUDE_CODE,
  [MODEL_PROVIDER.OPENAI]: CONVERSATION_RUNTIME.CODEX,
} as const satisfies Record<ModelProvider, ConversationRuntime>;

/**
 * The providers a Start on any of the account's Macs runs, as the account
 * can pay for them: each of `MAC_PROVIDERS` whose model a Start of the
 * account's would run on that provider's own harness, on a plan or a key
 * it keeps in Luke, and none it cannot pay for.
 */
const paidMacProviders = Effect.fnUntraced(function* (
  userId: string,
): Effect.fn.Return<readonly ModelProvider[], StoreFailure, DatabaseServices> {
  const rows = yield* keyRowsOf(userId, undefined);
  const paid: ModelProvider[] = [];
  for (const provider of MAC_PROVIDERS) {
    const choice = yield* Effect.result(providerRuntimeChoice(userId, provider, rows));
    if (Result.isSuccess(choice) && choice.success.runtime === RUNTIME_OF[provider]) {
      paid.push(provider);
    }
  }
  return paid;
});

/** The account's Macs that beat within `THIS_MAC.FRESH`, the latest first. */
const freshMacs = (userId: string) =>
  Effect.gen(function* () {
    const now = yield* Clock.currentTimeMillis;
    return yield* macDevicesSeenSince(userId, new Date(now - Duration.toMillis(THIS_MAC.FRESH)));
  });

/**
 * The runtime and payer of a new local agent of the account's on the model
 * given, on the Mac its Start named: the model's harness on that Mac's own
 * login, the Mac's first for a local agent, where the Mac, one of the
 * account's that beat within `THIS_MAC.FRESH`, said it is signed in to it,
 * Claude Code for a Claude model, Codex for a GPT model on a Mac that
 * checked a Codex; otherwise as any agent's (`agentRuntimeChoice`), on the
 * account's saved credential. So an account that saved no credential of the
 * provider's in Luke still starts one on a Mac signed in to its harness.
 * Note that the Mac read here is the one the Start pins (`agentMachineChoice`),
 * by its id, so the payer and the pin are of the same Mac.
 */
export const localAgentRuntimeChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  model: string,
  deviceId: string | undefined,
  rows?: AccountKeyRows,
): Effect.fn.Return<AgentRuntimeChoice, StoreFailure | AgentCredentialMissing, DatabaseServices> {
  const provider = yield* providerOfModel(model);
  const harness = Option.isSome(yield* Effect.serviceOption(NativeAgentSessions));
  if (harness && deviceId !== undefined) {
    const named = (yield* freshMacs(userId)).find((device) => device.id === deviceId);
    if (provider === MODEL_PROVIDER.ANTHROPIC && named?.signedIn.claudeCode === true) {
      return ON_MAC_CLAUDE_CODE;
    }
    if (
      provider === MODEL_PROVIDER.OPENAI &&
      named !== undefined &&
      runsCodex(named) &&
      named.signedIn.codex === true
    ) {
      return ON_MAC_CODEX;
    }
  }
  return yield* agentRuntimeChoice(userId, model, rows);
});

/**
 * The Macs the account may start a local agent on, as Start offers them:
 * each of its Macs that beat within `THIS_MAC.FRESH`, the latest first,
 * with the providers a Start on it runs that the account can pay for
 * (`paidMacProviders`), or that its own harness login pays for, where the account has the `local-agents`
 * experiment on; none otherwise.
 * Note that Start offers every one by name rather than one as This Mac,
 * because the service cannot tell which Mac the asking window runs on, and
 * a web tab runs on none.
 */
export const macOffers = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
): Effect.fn.Return<readonly MacOffer[], StoreFailure, DatabaseServices> {
  if (!(yield* accountExperimentOn(userId, EXPERIMENT.LOCAL_AGENTS))) return [];
  const seen = yield* freshMacs(userId);
  if (seen.length === 0) return [];
  const paid = yield* paidMacProviders(userId);
  // Note that a Mac signed in to a harness runs its models on that login, paid for or not.
  return seen.map((device) => ({
    deviceId: device.id,
    name: device.name,
    providers: MAC_PROVIDERS.filter((provider) => macRunsProvider(device, provider, paid)),
  }));
});

/**
 * Where a new agent of the account's runs on the runtime given, as its
 * Start asks: a sandbox where it asks for none, or the Mac it names, where
 * that Mac is one Start offers the account (`macOffers`) and lists the
 * provider the runtime runs; refused by name otherwise: a Mac that is
 * another account's or is not there as away, Codex on a Mac that runs none,
 * and a runtime with no harness.
 */
export const agentMachineChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  asked: {
    readonly machine?: CodingAgentMachine | undefined;
    readonly deviceId?: string | undefined;
  },
  runtime: ConversationRuntime,
): Effect.fn.Return<AgentMachineChoice, StoreFailure | LocalAgentRefused, DatabaseServices> {
  if (asked.machine !== CODING_AGENT_MACHINE.MAC) return IN_A_SANDBOX;
  if (!(yield* accountExperimentOn(userId, EXPERIMENT.LOCAL_AGENTS))) {
    return yield* new LocalAgentRefused({ reason: LOCAL_AGENT_REFUSAL.OFF });
  }
  if (runtime !== CONVERSATION_RUNTIME.CLAUDE_CODE && runtime !== CONVERSATION_RUNTIME.CODEX) {
    return yield* new LocalAgentRefused({ reason: LOCAL_AGENT_REFUSAL.NO_HARNESS });
  }
  const offer = (yield* macOffers(userId)).find((each) => each.deviceId === asked.deviceId);
  if (offer === undefined) {
    return yield* new LocalAgentRefused({ reason: LOCAL_AGENT_REFUSAL.MAC_AWAY });
  }
  // Note that a Mac runs only the providers it lists, so Codex on one that lists none of OpenAI's is refused by name.
  if (!offer.providers.includes(RUNTIME_PROVIDER[runtime])) {
    return yield* new LocalAgentRefused({ reason: LOCAL_AGENT_REFUSAL.CODEX });
  }
  return { machine: CODING_AGENT_MACHINE.MAC, deviceId: offer.deviceId };
});

/**
 * The provider whose credential an agent standing on eve lacks to take a
 * message, or none where it may: one recorded as paid for by Luke's key is
 * refused whatever its starter keeps now, since an agent never moves to
 * another payer, and any other agent on eve (its own API key, or from
 * before payers were recorded) needs its starter's API key for its model's
 * provider, which its steps run on (`account-keys.ts`). An agent on a native
 * harness on its starter's API key needs that key as one on eve does; one
 * on its plan is the plan's, which refuses by its own words.
 */
export const messageCredentialMissing = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: { readonly userId: string; readonly model: string },
  routing: { readonly runtime: ConversationRuntime; readonly payer: CodingAgentPayer | null },
): Effect.fn.Return<ModelProvider | undefined, StoreFailure, DatabaseServices> {
  const onKey = routing.payer === CODING_AGENT_PAYER.API_KEY;
  if (routing.runtime !== CONVERSATION_RUNTIME.EVE && !onKey) return undefined;
  const provider = yield* providerOfModel(agent.model);
  if (routing.payer === CODING_AGENT_PAYER.LUKE) return provider;
  const rows = yield* keyRowsOf(agent.userId, undefined);
  return keepsApiKey(provider, rows) ? undefined : provider;
});

/**
 * The providers none of whose models a Start of the account's would run,
 * since no credential of its pays for them, as `agentRuntimeChoice` decides
 * it; the menus mark those models rather than let a Start fail late.
 */
const unconnectedProviders = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  read?: AccountKeyRows,
): Effect.fn.Return<ReadonlySet<ModelProvider>, StoreFailure, DatabaseServices> {
  const rows = yield* keyRowsOf(userId, read);
  const missing = new Set<ModelProvider>();
  for (const provider of Object.values(MODEL_PROVIDER)) {
    const paid = yield* providerRuntimeChoice(userId, provider, rows).pipe(
      Effect.as(true),
      Effect.catchTag("AgentCredentialMissing", () => Effect.succeed(false)),
    );
    if (!paid) missing.add(provider);
  }
  return missing;
});

/** The models offered the account, each of a provider no credential of its pays for marked so (`unconnectedProviders`). */
export const markedUnconnected = /* @__PURE__ */ Effect.fnUntraced(function* <
  Model extends { readonly provider: ModelProvider },
>(
  userId: string,
  offered: readonly Model[],
  rows?: AccountKeyRows,
): Effect.fn.Return<readonly Model[], StoreFailure, DatabaseServices> {
  const missing = yield* unconnectedProviders(userId, rows);
  if (missing.size === 0) return offered;
  return offered.map((model) =>
    missing.has(model.provider) ? { ...model, credentialMissing: true } : model,
  );
});

/**
 * Which fast versions the account is offered (`offeredToAccount`): by the
 * Anthropic key its steps run on, and whether its ChatGPT plan pays for its
 * GPT agents, as Start would choose it here, since Codex runs no fast mode on the plan
 * and a Fast it cannot run is never offered.
 */
export const accountFastOffer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  read?: AccountKeyRows,
): Effect.fn.Return<AccountFastOffer, StoreFailure, DatabaseServices> {
  const rows = yield* keyRowsOf(userId, read);
  // Whether the account's own Anthropic key may run fast mode, as its row says, readable or not.
  const anthropic = rows.find(
    (row) =>
      row.kind === PROVIDER_KEY_KIND.API_KEY && row.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC,
  )?.fastAccess;
  const plan = keptPlan(userId, MODEL_PROVIDER.OPENAI, yield* deploymentRing, rows);
  return { anthropic: anthropic ?? undefined, chatGptPlan: plan?.forAgents === true };
});
