/**
 * agent-runtime-choice.ts -- the runtime a new coding agent runs on and who pays for it, decided once as it starts.
 *
 * An agent runs on a native harness when, and only when, that provider's
 * plan pays for it. The plan is offered to every account that connected it:
 *
 * - Claude Code, paid for by the account's Claude plan, on any Claude model,
 *   a fast version running with Claude Code's own fast mode on, where the
 *   account keeps a Claude setup-token.
 * - Codex, paid for by the account's ChatGPT plan, on the same terms for a
 *   GPT model, a fast version running on Codex's `fast` service tier and
 *   no Ultrafast one, which OpenAI limits to few plans (`accountFastOffer`), where the account
 *   keeps a ChatGPT sign-in (`chatgpt_oauth`)
 *   that OpenAI has not signed out and the deployment can still open.
 *
 * Settings' choice for that harness decides: the plan where its row's
 * `forAgents` is on (Subscription) and the plan is offered, the account's
 * own API key for the model's provider otherwise: on Claude Code, as its
 * documented `ANTHROPIC_API_KEY`, for a Claude model, and on Codex, as its
 * provider's `env_key`, for a GPT model. No new agent runs on eve, whose
 * agents are refused as ended (`runtime-sessions.ts`). Our own key
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
 * (`macOffers`) each that beat within `THIS_MAC.FRESH`, and the agent is
 * pinned to the one the Start named, once it is checked to be among them. A local agent runs
 * Claude Code, or Codex on a Mac that registered a Codex it checked; one on
 * Codex on a Mac with none, or on no harness at all, is refused by name.
 */

import type { DatabaseServices } from "@repo/database/core/query";
import { type Device, deviceLayout, devicesSeenSince } from "@repo/database/models/device-store";
import { openProviderKey, parseKeyRing } from "@repo/database/models/provider-key-seal";
import {
  listAccountProviderKeyRows,
  type ProviderKeyRow,
} from "@repo/database/models/provider-key-store";
import { readRunsOnPick } from "@repo/database/models/runs-on-pick";
import type { TaskRunsOnWrite } from "@repo/database/models/task-store";
import { CONVERSATION_RUNTIME } from "@repo/database/storage-vocabulary";
import {
  AGENT_MACHINE,
  AGENT_PAYER,
  type AgentMachineKind,
  type AgentPayer,
  LOCAL_AGENT_REFUSAL,
  type LocalAgentRefusal,
  MAC_PRESENCE,
} from "@repo/features/agent-wire";
import {
  DEVICE_CAPABILITY,
  DEVICE_KIND,
  DEVICE_SETUP,
  type DeviceSetup,
} from "@repo/features/device-agent-wire";
import { GITHUB_ACCESS, type GitHubAccess } from "@repo/features/github-repositories-wire";
import { type MacOffer, MODEL_PROVIDER, type ModelProvider } from "@repo/features/models-wire";
import {
  PROVIDER_KEY_KIND,
  PROVIDER_KEY_PROVIDER,
  PROVIDER_KEY_STATUS,
} from "@repo/features/provider-key-wire";
import type { TaskRunsOnRequest } from "@repo/features/task-wire";
import { Clock, Data, Duration, Effect, Option, type Redacted, Result } from "effect";
import { HostedEnvironment } from "../../environment.js";
import type { StoreFailure } from "../../http/store-failure.js";
import { type AccountFastOffer, providerModelOf } from "../../providers/model-catalog.js";
import type { NativeRuntime } from "./native-runtime.js";

/** No credential of the account's pays for a coding agent on the provider's models: neither its subscription, selected in Settings, nor its API key. */
export class AgentCredentialMissing extends Data.TaggedError("AgentCredentialMissing")<{
  readonly provider: ModelProvider;
}> {}

/** A Start on This Mac that cannot run there, and why. */
export class LocalAgentRefused extends Data.TaggedError("LocalAgentRefused")<{
  readonly reason: LocalAgentRefusal;
}> {}

/** A task an agent makes for the member, where the device the member last ran a task on has been removed since, so it has nowhere it was asked to run. */
export class RunsOnPickRemoved extends Data.TaggedError("RunsOnPickRemoved") {}

export const THIS_MAC = {
  /** How lately a Mac must have beaten for Start to offer it: one beat, and room for the next to arrive. */
  FRESH: Duration.millis(MAC_PRESENCE.FRESH_MS),
} as const;

/** Where a new agent runs: its machine, and the Mac a local agent is pinned to. */
export interface AgentMachineChoice {
  readonly machine: AgentMachineKind;
  readonly deviceId: string | undefined;
}

const IN_A_SANDBOX: AgentMachineChoice = {
  machine: AGENT_MACHINE.VERCEL,
  deviceId: undefined,
};

/** What a new agent runs on, a native harness and never eve, and who pays for it. The type keeps no payer readable for a row from before payers were recorded; a new agent always names one. */
export interface AgentRuntimeChoice {
  readonly runtime: NativeRuntime;
  readonly payer: AgentPayer | undefined;
}

const ON_CLAUDE_CODE: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  payer: AGENT_PAYER.CLAUDE_SUBSCRIPTION,
};

/** Claude Code on the account's own Anthropic API key, the CLI's documented `ANTHROPIC_API_KEY`. */
const ON_CLAUDE_CODE_API_KEY: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  payer: AGENT_PAYER.API_KEY,
};

/** Codex on the account's own OpenAI API key, through its provider's documented `env_key`. */
const ON_CODEX_API_KEY: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CODEX,
  payer: AGENT_PAYER.API_KEY,
};

const ON_CODEX: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CODEX,
  payer: AGENT_PAYER.CHATGPT_SUBSCRIPTION,
};

/** The statuses of a ChatGPT sign-in an agent cannot launch on: OpenAI signed it out or said the account is not eligible, or the deployment cannot open it. */
const UNUSABLE_SIGN_IN: ReadonlySet<string> = new Set([
  PROVIDER_KEY_STATUS.INVALID,
  PROVIDER_KEY_STATUS.INELIGIBLE,
  PROVIDER_KEY_STATUS.UNREADABLE,
]);

/**
 * The account's stored credentials of every kind, read once: what each
 * decision below is made from, so a request that makes several, such as the
 * models a start is offered and its payer, reads them in one statement.
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

/** Whether the account saved its own API key for the provider among `rows`, which pays for its agents on the provider's harness. */
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
  const plan = keptPlan(userId, provider, yield* deploymentRing, rows);
  if (plan?.forAgents === true) return onPlanOf(provider);
  // Our key pays for no coding agent, so an account with no API key of the provider's is refused by name.
  if (!keepsApiKey(provider, rows))
    return yield* Effect.fail(new AgentCredentialMissing({ provider }));
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
const runsCodex = (device: Device): boolean => device.codexExecutable !== null;

/**
 * Whether the Mac runs a Start of the provider's models: Claude Code's
 * anywhere, Codex's where it checked a Codex; where the account pays for the
 * harness in the app (`paid`).
 */
function macRunsProvider(
  device: Device,
  provider: ModelProvider,
  paid: readonly ModelProvider[],
): boolean {
  if (!paid.includes(provider)) return false;
  return provider === MODEL_PROVIDER.ANTHROPIC || runsCodex(device);
}

/** The provider whose models a native runtime runs, which the Mac a Start names must list. */
const RUNTIME_PROVIDER = {
  [CONVERSATION_RUNTIME.CLAUDE_CODE]: MODEL_PROVIDER.ANTHROPIC,
  [CONVERSATION_RUNTIME.CODEX]: MODEL_PROVIDER.OPENAI,
} as const satisfies Record<NativeRuntime, ModelProvider>;

/**
 * The providers a Start on any of the account's Macs runs, as the account
 * can pay for them: each of `MAC_PROVIDERS` a Start of the account's would
 * run, on a plan or a key it keeps in the app, and none it cannot pay for.
 */
const paidMacProviders = Effect.fnUntraced(function* (
  userId: string,
): Effect.fn.Return<readonly ModelProvider[], StoreFailure, DatabaseServices> {
  const rows = yield* keyRowsOf(userId, undefined);
  const paid: ModelProvider[] = [];
  for (const provider of MAC_PROVIDERS) {
    const choice = yield* Effect.result(providerRuntimeChoice(userId, provider, rows));
    if (Result.isSuccess(choice)) paid.push(provider);
  }
  return paid;
});

/**
 * The devices a task of the account's may run its agents on, as the menus
 * offer them: each device it registered, the latest beat first, with its
 * kind and last beat, so a device away now is offered but drawn away, and
 * the providers an agent on it runs that the account can pay for
 * (`paidMacProviders`). Only one
 * that beat within `THIS_MAC.FRESH` takes a task's Runs on or an agent
 * (`freshOffer`).
 * Note that every one is offered by name rather than one as This Mac,
 * because the service cannot tell which device the asking window runs on,
 * and a web tab runs on none.
 */
export const macOffers = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
): Effect.fn.Return<readonly MacOffer[], StoreFailure, DatabaseServices> {
  const registered = yield* devicesSeenSince(userId, new Date(0));
  if (registered.length === 0) return [];
  const paid = yield* paidMacProviders(userId);
  return registered.map((device) => ({
    deviceId: device.id,
    name: device.name,
    providers: MAC_PROVIDERS.filter((provider) => macRunsProvider(device, provider, paid)),
    // Note that every device runs the host program, so each is offered as a host; the device row keeps no kind.
    kind: DEVICE_KIND.HOST,
    platform: device.platform,
    seenAt: device.lastSeenAt.getTime(),
    ...(device.setup === null ? undefined : { setup: device.setup }),
    ...(device.setupFailure === null ? undefined : { setupFailure: device.setupFailure }),
    ...(device.machineId === null ? undefined : { machineId: device.machineId }),
    ...(device.model === null ? undefined : { model: device.model }),
  }));
});

/** Why a device still setting itself up takes no agent, by where its setup stands. */
const SETUP_REFUSAL = {
  [DEVICE_SETUP.PREPARING]: LOCAL_AGENT_REFUSAL.PREPARING,
  [DEVICE_SETUP.FAILED]: LOCAL_AGENT_REFUSAL.SETUP_FAILED,
} as const satisfies Record<DeviceSetup, LocalAgentRefusal>;

/** The offer of the account's device `deviceId` names where it beat within `THIS_MAC.FRESH`; none for another account's, one never registered, or one away. */
export const freshOffer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  deviceId: string | null | undefined,
): Effect.fn.Return<MacOffer | undefined, StoreFailure, DatabaseServices> {
  if (deviceId === null || deviceId === undefined) return undefined;
  const now = yield* Clock.currentTimeMillis;
  const since = now - Duration.toMillis(THIS_MAC.FRESH);
  return (yield* macOffers(userId)).find(
    (each) => each.deviceId === deviceId && (each.seenAt ?? 0) >= since,
  );
});

/**
 * Where a new agent of the account's runs on the runtime given, as its
 * Start asks: a sandbox where it asks for none, or the Mac it names, where
 * that Mac is one the account is offered and there now (`freshOffer`) and lists the
 * provider the runtime runs; refused by name otherwise: a Mac that is
 * another account's or is not there as away, Codex on a Mac that runs none,
 * and a repository reached on the starter's own token (`githubAccess`) on a
 * host from before it works in one on its own GitHub sign-in
 * (`DEVICE_CAPABILITY.GITHUB_SIGN_IN`), whose launch would ask for a token
 * the service never hands a device.
 */
export const agentMachineChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  asked: {
    readonly machine?: AgentMachineKind | undefined;
    readonly deviceId?: string | undefined;
  },
  runtime: NativeRuntime,
  githubAccess?: GitHubAccess | undefined,
): Effect.fn.Return<AgentMachineChoice, StoreFailure | LocalAgentRefused, DatabaseServices> {
  if (asked.machine !== AGENT_MACHINE.DEVICE) return IN_A_SANDBOX;
  const offer = yield* freshOffer(userId, asked.deviceId);
  if (offer === undefined) {
    return yield* new LocalAgentRefused({ reason: LOCAL_AGENT_REFUSAL.MAC_AWAY });
  }
  if (offer.setup !== undefined) {
    return yield* new LocalAgentRefused({ reason: SETUP_REFUSAL[offer.setup] });
  }
  // Note that a Mac runs only the providers it lists, so Codex on one that lists none of OpenAI's is refused by name.
  if (!offer.providers.includes(RUNTIME_PROVIDER[runtime])) {
    return yield* new LocalAgentRefused({ reason: LOCAL_AGENT_REFUSAL.CODEX });
  }
  if (githubAccess === GITHUB_ACCESS.TOKEN && !(yield* signsInOwnGithub(userId, offer.deviceId))) {
    return yield* new LocalAgentRefused({ reason: LOCAL_AGENT_REFUSAL.GITHUB_SIGN_IN });
  }
  return { machine: AGENT_MACHINE.DEVICE, deviceId: offer.deviceId };
});

/** Whether the account's device registered that it launches an agent on its own GitHub sign-in (`DEVICE_CAPABILITY.GITHUB_SIGN_IN`). */
const signsInOwnGithub = (userId: string, deviceId: string) =>
  Effect.map(deviceLayout(userId, deviceId), (standing) =>
    Option.exists(standing, (device) =>
      device.capabilities.includes(DEVICE_CAPABILITY.GITHUB_SIGN_IN),
    ),
  );

/**
 * Where a task of the account's runs its agents, as a request to set it
 * asks: the cloud, or one of the account's own devices that beat within
 * `THIS_MAC.FRESH` and runs some model's harness; refused by name
 * otherwise: a device that is another account's, was never registered, or
 * is away, as away. The device the task keeps is
 * checked again as each agent starts (`agentMachineChoice`), since it may
 * be away by then or not run that agent's model.
 */
export const taskRunsOnChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  asked: TaskRunsOnRequest,
): Effect.fn.Return<AgentMachineChoice, StoreFailure | LocalAgentRefused, DatabaseServices> {
  if (asked.machine === AGENT_MACHINE.VERCEL) return IN_A_SANDBOX;
  const offer = yield* freshOffer(userId, asked.deviceId);
  if (offer === undefined) {
    return yield* new LocalAgentRefused({ reason: LOCAL_AGENT_REFUSAL.MAC_AWAY });
  }
  if (offer.setup !== undefined) {
    return yield* new LocalAgentRefused({ reason: SETUP_REFUSAL[offer.setup] });
  }
  if (offer.providers.length === 0) {
    return yield* new LocalAgentRefused({ reason: LOCAL_AGENT_REFUSAL.NO_HARNESS });
  }
  return { machine: AGENT_MACHINE.DEVICE, deviceId: offer.deviceId };
});

/**
 * Where a task an agent makes for the member runs (`create_task`): where
 * the member last ran a task, as New task kept it (`runs-on-pick.ts`), the
 * cloud where they never chose or last chose the cloud. A device kept is
 * taken only while it is still the member's and listed, and refused
 * (`RunsOnPickRemoved`) where it was removed since, rather than run in the
 * cloud. Note that, unlike a Start's choice, a device that is away is taken,
 * because making the task starts nothing, and a Start on it while it is
 * still away is refused by name (`agentMachineChoice`); and that with no
 * device left at all, none is offered, so the cloud is the only place there
 * is, New task draws no Runs on to pick it with, and a
 * pick kept from before stands unread.
 */
export const agentMadeRunsOn = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
): Effect.fn.Return<
  TaskRunsOnWrite | undefined,
  StoreFailure | RunsOnPickRemoved,
  DatabaseServices
> {
  const pick = yield* readRunsOnPick(userId);
  if (Option.isNone(pick) || pick.value.machine === AGENT_MACHINE.VERCEL) return undefined;
  const kept = pick.value.deviceId;
  const offers = yield* macOffers(userId);
  if (offers.length === 0) return undefined;
  const offered = offers.find((each) => each.deviceId === kept);
  if (offered === undefined) return yield* new RunsOnPickRemoved();
  return { machine: AGENT_MACHINE.DEVICE, deviceId: offered.deviceId };
});

/**
 * The provider whose credential an agent lacks to take a message, or none
 * where it may: an agent on its starter's API key needs that key for its
 * model's provider; one on its plan is the plan's, which refuses by its own
 * words.
 */
export const messageCredentialMissing = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: { readonly userId: string; readonly model: string },
  routing: { readonly payer: AgentPayer | null },
): Effect.fn.Return<ModelProvider | undefined, StoreFailure, DatabaseServices> {
  if (routing.payer !== AGENT_PAYER.API_KEY) return undefined;
  const provider = yield* providerOfModel(agent.model);
  const rows = yield* keyRowsOf(agent.userId, undefined);
  return keepsApiKey(provider, rows) ? undefined : provider;
});

/**
 * The providers none of whose models a Start of the account's would run,
 * since no credential of its pays for them, as `agentRuntimeChoice` decides
 * it; the menus mark those models rather than let a Start fail late, and the
 * account's default never moves to one of them.
 */
export const unconnectedProviders = /* @__PURE__ */ Effect.fnUntraced(function* (
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
 * Which fast and Ultrafast versions the account is offered
 * (`offeredToAccount`): by the Anthropic key its steps run on, and whether
 * its ChatGPT plan pays for its GPT agents, as Start would choose it here,
 * since Codex runs an Ultrafast version on an OpenAI API key alone and one
 * it cannot run is never offered.
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
