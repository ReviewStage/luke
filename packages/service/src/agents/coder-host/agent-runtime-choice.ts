import type { DatabaseServices } from "@repo/database/core/query";
import { type Device, deviceLayout, devicesSeenSince } from "@repo/database/models/device-store";
import { openProviderKey, parseKeyRing } from "@repo/database/models/provider-key-seal";
import {
  listAccountProviderKeyRows,
  type ProviderKeyRow,
} from "@repo/database/models/provider-key-store";
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
import { Clock, Data, Duration, Effect, Option, type Redacted, Result } from "effect";
import { HostedEnvironment } from "../../environment.js";
import type { StoreFailure } from "../../http/store-failure.js";
import { type AccountFastOffer, providerModelOf } from "../../providers/model-catalog.js";
import type { NativeRuntime } from "./native-runtime.js";

export class AgentCredentialMissing extends Data.TaggedError("AgentCredentialMissing")<{
  readonly provider: ModelProvider;
}> {}

export class LocalAgentRefused extends Data.TaggedError("LocalAgentRefused")<{
  readonly reason: LocalAgentRefusal;
}> {}

export const THIS_MAC = {
  FRESH: Duration.millis(MAC_PRESENCE.FRESH_MS),
} as const;

export interface AgentMachineChoice {
  readonly machine: AgentMachineKind;
  readonly deviceId: string | undefined;
}

const IN_A_SANDBOX: AgentMachineChoice = {
  machine: AGENT_MACHINE.VERCEL,
  deviceId: undefined,
};

export interface AgentRuntimeChoice {
  readonly runtime: NativeRuntime;
  readonly payer: AgentPayer | undefined;
}

const ON_CLAUDE_CODE: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  payer: AGENT_PAYER.CLAUDE_SUBSCRIPTION,
};

const ON_CLAUDE_CODE_API_KEY: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CLAUDE_CODE,
  payer: AGENT_PAYER.API_KEY,
};

const ON_CODEX_API_KEY: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CODEX,
  payer: AGENT_PAYER.API_KEY,
};

const ON_CODEX: AgentRuntimeChoice = {
  runtime: CONVERSATION_RUNTIME.CODEX,
  payer: AGENT_PAYER.CHATGPT_SUBSCRIPTION,
};

const UNUSABLE_SIGN_IN: ReadonlySet<string> = new Set([
  PROVIDER_KEY_STATUS.INVALID,
  PROVIDER_KEY_STATUS.INELIGIBLE,
  PROVIDER_KEY_STATUS.UNREADABLE,
]);

export type AccountKeyRows = readonly ProviderKeyRow[];

const keyRowsOf = (
  userId: string,
  rows: AccountKeyRows | undefined,
): Effect.Effect<AccountKeyRows, StoreFailure, DatabaseServices> =>
  rows === undefined ? listAccountProviderKeyRows(userId) : Effect.succeed(rows);

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

const onPlanOf = (provider: string): AgentRuntimeChoice =>
  provider === MODEL_PROVIDER.ANTHROPIC ? ON_CLAUDE_CODE : ON_CODEX;

function keepsApiKey(provider: ModelProvider, rows: AccountKeyRows): boolean {
  return rows.some((row) => row.kind === PROVIDER_KEY_KIND.API_KEY && row.provider === provider);
}

const providerOfModel = (model: string): Effect.Effect<ModelProvider> => {
  const named = providerModelOf(model);
  return named === undefined
    ? Effect.die(new Error(`no provider for the model ${model}`))
    : Effect.succeed(named.provider);
};

const deploymentRing = Effect.map(
  Effect.serviceOption(HostedEnvironment),
  (environment) => Option.getOrUndefined(environment)?.providerKeyEncryptionKeys,
);

const providerRuntimeChoice = Effect.fnUntraced(function* (
  userId: string,
  provider: ModelProvider,
  rows: AccountKeyRows,
): Effect.fn.Return<AgentRuntimeChoice, AgentCredentialMissing> {
  const plan = keptPlan(userId, provider, yield* deploymentRing, rows);
  if (plan?.forAgents === true) return onPlanOf(provider);
  if (!keepsApiKey(provider, rows))
    return yield* Effect.fail(new AgentCredentialMissing({ provider }));
  return provider === MODEL_PROVIDER.ANTHROPIC ? ON_CLAUDE_CODE_API_KEY : ON_CODEX_API_KEY;
});

export const agentRuntimeChoice = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  model: string,
  rows?: AccountKeyRows,
): Effect.fn.Return<AgentRuntimeChoice, StoreFailure | AgentCredentialMissing, DatabaseServices> {
  const provider = yield* providerOfModel(model);
  return yield* providerRuntimeChoice(userId, provider, yield* keyRowsOf(userId, rows));
});

const MAC_PROVIDERS: readonly ModelProvider[] = [MODEL_PROVIDER.ANTHROPIC, MODEL_PROVIDER.OPENAI];

const runsCodex = (device: Device): boolean => device.codexExecutable !== null;

function macRunsProvider(
  device: Device,
  provider: ModelProvider,
  paid: readonly ModelProvider[],
): boolean {
  if (!paid.includes(provider)) return false;
  return provider === MODEL_PROVIDER.ANTHROPIC || runsCodex(device);
}

const RUNTIME_PROVIDER = {
  [CONVERSATION_RUNTIME.CLAUDE_CODE]: MODEL_PROVIDER.ANTHROPIC,
  [CONVERSATION_RUNTIME.CODEX]: MODEL_PROVIDER.OPENAI,
} as const satisfies Record<NativeRuntime, ModelProvider>;

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
    kind: DEVICE_KIND.HOST,
    platform: device.platform,
    seenAt: device.lastSeenAt.getTime(),
    ...(device.setup === null ? undefined : { setup: device.setup }),
    ...(device.setupFailure === null ? undefined : { setupFailure: device.setupFailure }),
    ...(device.machineId === null ? undefined : { machineId: device.machineId }),
    ...(device.model === null ? undefined : { model: device.model }),
  }));
});

const SETUP_REFUSAL = {
  [DEVICE_SETUP.PREPARING]: LOCAL_AGENT_REFUSAL.PREPARING,
  [DEVICE_SETUP.FAILED]: LOCAL_AGENT_REFUSAL.SETUP_FAILED,
} as const satisfies Record<DeviceSetup, LocalAgentRefusal>;

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
  if (!offer.providers.includes(RUNTIME_PROVIDER[runtime])) {
    return yield* new LocalAgentRefused({ reason: LOCAL_AGENT_REFUSAL.CODEX });
  }
  if (githubAccess === GITHUB_ACCESS.TOKEN && !(yield* signsInOwnGithub(userId, offer.deviceId))) {
    return yield* new LocalAgentRefused({ reason: LOCAL_AGENT_REFUSAL.GITHUB_SIGN_IN });
  }
  return { machine: AGENT_MACHINE.DEVICE, deviceId: offer.deviceId };
});

const signsInOwnGithub = (userId: string, deviceId: string) =>
  Effect.map(deviceLayout(userId, deviceId), (standing) =>
    Option.exists(standing, (device) =>
      device.capabilities.includes(DEVICE_CAPABILITY.GITHUB_SIGN_IN),
    ),
  );

export const messageCredentialMissing = /* @__PURE__ */ Effect.fnUntraced(function* (
  agent: { readonly userId: string; readonly model: string },
  routing: { readonly payer: AgentPayer | null },
): Effect.fn.Return<ModelProvider | undefined, StoreFailure, DatabaseServices> {
  if (routing.payer !== AGENT_PAYER.API_KEY) return undefined;
  const provider = yield* providerOfModel(agent.model);
  const rows = yield* keyRowsOf(agent.userId, undefined);
  return keepsApiKey(provider, rows) ? undefined : provider;
});

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

export const accountFastOffer = /* @__PURE__ */ Effect.fnUntraced(function* (
  userId: string,
  read?: AccountKeyRows,
): Effect.fn.Return<AccountFastOffer, StoreFailure, DatabaseServices> {
  const rows = yield* keyRowsOf(userId, read);
  const anthropic = rows.find(
    (row) =>
      row.kind === PROVIDER_KEY_KIND.API_KEY && row.provider === PROVIDER_KEY_PROVIDER.ANTHROPIC,
  )?.fastAccess;
  const plan = keptPlan(userId, MODEL_PROVIDER.OPENAI, yield* deploymentRing, rows);
  return { anthropic: anthropic ?? undefined, chatGptPlan: plan?.forAgents === true };
});
