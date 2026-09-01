import { Effect, Layer } from "effect";
import type { CloudFetch } from "../../../packages/providers/src/shared/cloud-session-adapter.js";
import type { HostedUsageAnswer } from "../server/core.js";
import {
  AccountDeleteUser,
  handleAccountDelete as handleAccountDeleteEffect,
} from "../server/hosted/account-delete.js";
import { handleAttentionReview as handleAttentionReviewEffect } from "../server/hosted/attention-review.js";
import { decryptProviderKey, encryptProviderKey } from "../server/hosted/encryption.js";
import { handleEvents as handleEventsEffect } from "../server/hosted/events.js";
import { upstreamError } from "../server/hosted/http-effect.js";
import { handleIntroductionMint as handleIntroductionMintEffect } from "../server/hosted/introduction-mint.js";
import {
  handleObserve as handleObserveEffect,
  ObserveCloudFetch,
  ObserveVaultKeys,
  type VaultKeyRow,
} from "../server/hosted/observe.js";
import type { FetchLike, OpenAiPostBody } from "../server/hosted/openai.js";
import { postOpenAi } from "../server/hosted/openai.js";
import type { PosthogBatch, PosthogPerson } from "../server/hosted/posthog.js";
import type { HostedMeter, HostedSpend, IntroductionSpend } from "../server/hosted/quota.js";
import { handleUsage as handleUsageEffect } from "../server/hosted/usage.js";
import {
  handleVaultKeyDelete as handleVaultKeyDeleteEffect,
  handleVaultKeyStore as handleVaultKeyStoreEffect,
  handleVaultKeysList as handleVaultKeysListEffect,
  VaultKeyDelete,
  type VaultKeyEntry,
  VaultKeyList,
  VaultKeyStore,
} from "../server/hosted/vault.js";
import {
  handleVoiceMint as handleVoiceMintEffect,
  mintRealtimeConnection,
  VoiceMintUpstream,
  VoiceMintUpstreamLive,
} from "../server/hosted/voice-mint.js";
import { makeHostedRuntime } from "../server/runtime.js";
import {
  HostedAuth,
  HostedClock,
  HostedEncryption,
  HostedMeterService,
  HostedOpenAi,
  HostedPosthog,
  type HostedServices,
} from "../server/services/tags.js";

export interface HostedTestOverrides {
  now?: () => number;
  resolveUserId?: (request: Request) => Promise<string | undefined>;
  projectApiKey?: string;
  posthogHost?: string;
  posthogPostBatch?: (body: PosthogBatch) => Promise<Response | undefined>;
  readPerson?: (userId: string) => Promise<PosthogPerson | undefined>;
  forgetAnalytics?: (userId: string) => Promise<void>;
  openAiApiKey?: string;
  realtimeModel?: string;
  attentionModel?: string;
  openAiFetch?: FetchLike;
  encryptionSecret?: string;
  spend?: (userId: string, meter: HostedMeter) => Promise<HostedSpend>;
  spendIntroduction?: (callerKey: string) => Promise<IntroductionSpend>;
  readUsage?: (userId: string) => Promise<HostedUsageAnswer>;
  voiceMint?: (
    options: import("../server/hosted/voice-mint.js").RealtimeConnectionMintOptions,
  ) => Effect.Effect<import("../server/hosted/voice-mint.js").RealtimeConnectionMint>;
  readVaultKeys?: (userId: string) => Promise<VaultKeyRow[]>;
  observeFetch?: CloudFetch;
  storeKey?: (userId: string, providerId: string, ciphertext: string) => Promise<void>;
  listKeys?: (userId: string) => Promise<VaultKeyEntry[]>;
  deleteKey?: (userId: string, providerId: string) => Promise<boolean>;
  deleteUser?: (userId: string) => Promise<void>;
}

function defaultSpend(now: () => number): HostedSpend {
  return {
    allowed: true,
    quota: { used: 0, limit: 50, remaining: 50, resetsAt: now() + 86_400_000 },
  };
}

function defaultUsage(now: () => number): HostedUsageAnswer {
  return {
    voice: { used: 0, limit: 50, remaining: 50, resetsAt: now() + 86_400_000 },
    attention: { used: 0, limit: 500, remaining: 500, resetsAt: now() + 86_400_000 },
  };
}

export function hostedTestLayer(overrides: HostedTestOverrides = {}) {
  const now = overrides.now ?? (() => Date.now());
  return Layer.mergeAll(
    Layer.succeed(HostedClock, { now }),
    Layer.succeed(HostedAuth, {
      resolveUserId: (request) =>
        Effect.promise(() => (overrides.resolveUserId ?? (async () => "user-1"))(request)),
    }),
    Layer.succeed(HostedOpenAi, {
      apiKey: overrides.openAiApiKey,
      realtimeModel: overrides.realtimeModel,
      attentionModel: overrides.attentionModel,
      post: (path: string, body: OpenAiPostBody) =>
        Effect.promise(() => {
          if (!overrides.openAiApiKey) return Promise.resolve(undefined);
          return postOpenAi(path, body, {
            apiKey: overrides.openAiApiKey,
            fetch: overrides.openAiFetch,
          });
        }),
    }),
    Layer.succeed(HostedPosthog, {
      projectApiKey: overrides.projectApiKey,
      host: overrides.posthogHost,
      postBatch: (body) =>
        Effect.tryPromise({
          try: () =>
            overrides.posthogPostBatch
              ? overrides.posthogPostBatch(body)
              : Promise.resolve(undefined),
          catch: () => undefined,
        }),
      readPerson: overrides.readPerson
        ? (userId) =>
            Effect.tryPromise({
              try: () => overrides.readPerson!(userId),
              catch: () => undefined,
            })
        : undefined,
      forgetPerson: overrides.forgetAnalytics
        ? (userId) =>
            Effect.tryPromise({
              try: () => overrides.forgetAnalytics!(userId),
              catch: (error) => {
                process.stderr.write(
                  `Analytics erasure did not complete: ${error instanceof Error ? error.message : "unknown error"}\n`,
                );
              },
            })
        : undefined,
    }),
    Layer.succeed(HostedEncryption, {
      secret: overrides.encryptionSecret,
      encrypt: (plaintext) =>
        Effect.sync(() => {
          if (!overrides.encryptionSecret) throw new Error("no secret");
          return encryptProviderKey(plaintext, overrides.encryptionSecret);
        }),
      decrypt: (ciphertext) =>
        Effect.sync(() => {
          if (!overrides.encryptionSecret) throw new Error("no secret");
          return decryptProviderKey(ciphertext, overrides.encryptionSecret);
        }),
    }),
    Layer.succeed(HostedMeterService, {
      spend: (userId, meter) =>
        Effect.promise(() => (overrides.spend ?? (async () => defaultSpend(now)))(userId, meter)),
      spendIntroduction: (callerKey) =>
        Effect.promise(() =>
          (overrides.spendIntroduction ?? (async () => ({ allowed: true })))(callerKey),
        ),
      readUsage: (userId) =>
        Effect.promise(() => (overrides.readUsage ?? (async () => defaultUsage(now)))(userId)),
    }),
    overrides.voiceMint
      ? Layer.succeed(VoiceMintUpstream, { mint: overrides.voiceMint })
      : VoiceMintUpstreamLive,
    Layer.succeed(ObserveVaultKeys, {
      readVaultKeys: (userId) =>
        Effect.promise(() => (overrides.readVaultKeys ?? (async () => []))(userId)),
    }),
    Layer.succeed(ObserveCloudFetch, { fetch: overrides.observeFetch }),
    Layer.succeed(VaultKeyStore, {
      storeKey: (userId, providerId, ciphertext) =>
        Effect.promise(() =>
          (overrides.storeKey ?? (async () => {}))(userId, providerId, ciphertext),
        ),
    }),
    Layer.succeed(VaultKeyList, {
      listKeys: (userId) => Effect.promise(() => (overrides.listKeys ?? (async () => []))(userId)),
    }),
    Layer.succeed(VaultKeyDelete, {
      deleteKey: (userId, providerId) =>
        Effect.promise(() => (overrides.deleteKey ?? (async () => false))(userId, providerId)),
    }),
    Layer.succeed(AccountDeleteUser, {
      deleteUser: (userId) =>
        Effect.promise(() => (overrides.deleteUser ?? (async () => {}))(userId)),
    }),
  );
}

export async function runHosted<R>(
  program: Effect.Effect<Response, never, R>,
  overrides: HostedTestOverrides = {},
): Promise<Response> {
  const layer = hostedTestLayer(overrides) as Layer.Layer<R, never, never>;
  const runtime = makeHostedRuntime(layer as Layer.Layer<HostedServices, never, never>);
  try {
    return await runtime.runPromise(Effect.provide(program, layer));
  } finally {
    runtime.dispose();
  }
}

export const runEvents = (request: Request, overrides?: HostedTestOverrides) =>
  runHosted(handleEventsEffect(request), overrides);

export const runVoiceMint = (request: Request, overrides?: HostedTestOverrides) =>
  runHosted(handleVoiceMintEffect(request), overrides);

export const runIntroductionMint = (request: Request, overrides?: HostedTestOverrides) =>
  runHosted(handleIntroductionMintEffect(request), overrides);

export const runAttentionReview = (request: Request, overrides?: HostedTestOverrides) =>
  runHosted(handleAttentionReviewEffect(request), overrides);

export const runUsage = (request: Request, overrides?: HostedTestOverrides) =>
  runHosted(handleUsageEffect(request), overrides);

export const runObserve = (request: Request, overrides?: HostedTestOverrides) =>
  runHosted(handleObserveEffect(request), overrides);

export const runVaultKeyStore = (request: Request, overrides?: HostedTestOverrides) =>
  runHosted(handleVaultKeyStoreEffect(request), overrides);

export const runVaultKeysList = (request: Request, overrides?: HostedTestOverrides) =>
  runHosted(handleVaultKeysListEffect(request), overrides);

export const runVaultKeyDelete = (request: Request, overrides?: HostedTestOverrides) =>
  runHosted(handleVaultKeyDeleteEffect(request), overrides);

export const runAccountDelete = (request: Request, overrides?: HostedTestOverrides) =>
  runHosted(handleAccountDeleteEffect(request), overrides);

export type { VaultKeyEntry, VaultKeyRow };

export interface EventsOptions {
  request: Request;
  projectApiKey: string | undefined;
  host?: string;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  readPerson?: (userId: string) => Promise<PosthogPerson | undefined>;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

export async function handleEvents(options: EventsOptions): Promise<Response> {
  return runEvents(options.request, {
    projectApiKey: options.projectApiKey,
    posthogHost: options.host,
    now: options.now,
    resolveUserId: options.resolveUserId,
    readPerson: options.readPerson,
    posthogPostBatch: options.fetch
      ? async (body) =>
          options.fetch!(
            `${(options.host ?? "https://us.i.posthog.com").replace(/\/$/, "")}/batch/`,
            {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(body),
            },
          )
      : undefined,
  });
}

export interface VoiceMintOptions {
  request: Request;
  apiKey: string | undefined;
  model?: string;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  spend: (userId: string) => Promise<HostedSpend>;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

export async function handleVoiceMint(options: VoiceMintOptions): Promise<Response> {
  return runVoiceMint(options.request, {
    openAiApiKey: options.apiKey,
    realtimeModel: options.model,
    resolveUserId: options.resolveUserId,
    now: options.now,
    spend: options.spend,
    voiceMint: (mintOptions) =>
      Effect.promise(() =>
        mintRealtimeConnection({
          ...mintOptions,
          fetch: options.fetch,
          timeoutMs: options.timeoutMs,
          now: options.now,
        }),
      ).pipe(Effect.catchAll(() => Effect.succeed({ failure: upstreamError() }))),
  });
}

export interface IntroductionMintOptions {
  request: Request;
  apiKey: string | undefined;
  model?: string;
  spend: (callerKey: string) => Promise<IntroductionSpend>;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

export async function handleIntroductionMint(options: IntroductionMintOptions): Promise<Response> {
  return runIntroductionMint(options.request, {
    openAiApiKey: options.apiKey,
    realtimeModel: options.model,
    now: options.now,
    spendIntroduction: options.spend,
    voiceMint: (mintOptions) =>
      Effect.promise(() =>
        mintRealtimeConnection({
          ...mintOptions,
          fetch: options.fetch,
          timeoutMs: options.timeoutMs,
          now: options.now,
        }),
      ).pipe(Effect.catchAll(() => Effect.succeed({ failure: upstreamError() }))),
  });
}

export interface AttentionReviewOptions {
  request: Request;
  apiKey: string | undefined;
  model?: string;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  spend: (userId: string) => Promise<HostedSpend>;
  fetch?: FetchLike;
  now?: () => number;
  timeoutMs?: number;
}

export async function handleAttentionReview(options: AttentionReviewOptions): Promise<Response> {
  return runAttentionReview(options.request, {
    openAiApiKey: options.apiKey,
    attentionModel: options.model,
    resolveUserId: options.resolveUserId,
    now: options.now,
    spend: options.spend,
    openAiFetch: options.fetch,
  });
}

export interface UsageOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  readUsage: (userId: string) => Promise<HostedUsageAnswer>;
}

export async function handleUsage(options: UsageOptions): Promise<Response> {
  return runUsage(options.request, {
    resolveUserId: options.resolveUserId,
    readUsage: options.readUsage,
  });
}

export interface ObserveOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  encryptionSecret: string | undefined;
  readVaultKeys: (userId: string) => Promise<VaultKeyRow[]>;
  fetch?: CloudFetch;
  now?: () => number;
}

export async function handleObserve(options: ObserveOptions): Promise<Response> {
  return runObserve(options.request, {
    resolveUserId: options.resolveUserId,
    encryptionSecret: options.encryptionSecret,
    readVaultKeys: options.readVaultKeys,
    observeFetch: options.fetch,
    now: options.now,
  });
}

export interface VaultKeyStoreOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  encryptionSecret: string | undefined;
  storeKey: (userId: string, providerId: string, ciphertext: string) => Promise<void>;
}

export async function handleVaultKeyStore(options: VaultKeyStoreOptions): Promise<Response> {
  return runVaultKeyStore(options.request, {
    resolveUserId: options.resolveUserId,
    encryptionSecret: options.encryptionSecret,
    storeKey: options.storeKey,
  });
}

export interface VaultKeysListOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  encryptionSecret: string | undefined;
  listKeys: (userId: string) => Promise<VaultKeyEntry[]>;
}

export async function handleVaultKeysList(options: VaultKeysListOptions): Promise<Response> {
  return runVaultKeysList(options.request, {
    resolveUserId: options.resolveUserId,
    encryptionSecret: options.encryptionSecret,
    listKeys: options.listKeys,
  });
}

export interface VaultKeyDeleteOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  encryptionSecret: string | undefined;
  deleteKey: (userId: string, providerId: string) => Promise<boolean>;
}

export async function handleVaultKeyDelete(options: VaultKeyDeleteOptions): Promise<Response> {
  return runVaultKeyDelete(options.request, {
    resolveUserId: options.resolveUserId,
    encryptionSecret: options.encryptionSecret,
    deleteKey: options.deleteKey,
  });
}

export interface AccountDeleteOptions {
  request: Request;
  resolveUserId: (request: Request) => Promise<string | undefined>;
  deleteUser: (userId: string) => Promise<void>;
  forgetAnalytics?: (userId: string) => Promise<void>;
}

export async function handleAccountDelete(options: AccountDeleteOptions): Promise<Response> {
  return runAccountDelete(options.request, {
    resolveUserId: options.resolveUserId,
    deleteUser: options.deleteUser,
    forgetAnalytics: options.forgetAnalytics,
  });
}
