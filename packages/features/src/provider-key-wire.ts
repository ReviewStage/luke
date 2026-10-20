import { Schema as EffectSchema } from "effect";
import { MODEL_PROVIDER } from "./models-wire.js";
import { countedNumber } from "./service-wire.js";

/**
 * provider-key-wire.ts -- the account's own Anthropic and OpenAI API keys, as the desktop saves, reads, and removes them.
 *
 * `/api/account/provider-keys` holds at most one key per provider for the
 * signed-in account. A key travels once, in the body of the `PUT` that saves
 * it, and never again: every answer names what the key is — its provider, a
 * hint of its first and last characters, when it was added, and how the
 * provider last answered it — and never the key itself. A save is checked
 * with the provider before it is kept, so a key the provider refuses is
 * answered as rejected and nothing is written. `DELETE` with the provider in
 * the query removes one. Every answer carries the account's keys as they
 * then stand, so the page draws the service's word rather than its own guess.
 */

/** The providers an account may hold a key of its own for: the two Luke runs coding agents on. */
export const PROVIDER_KEY_PROVIDER = MODEL_PROVIDER;

export type ProviderKeyProvider =
  (typeof PROVIDER_KEY_PROVIDER)[keyof typeof PROVIDER_KEY_PROVIDER];

/**
 * What a stored credential is: a provider's API key, which is billed by the
 * token, or a subscription credential, which runs on the plan the account
 * pays its provider for. Every kind is sealed, braked, and rewrapped alike.
 */
export const PROVIDER_KEY_KIND = {
  /** A provider API key, checked with the provider before it is kept. */
  API_KEY: "api_key",
  /** A Claude subscription's long-lived token, as `claude setup-token` prints it; Anthropic's alone. */
  CLAUDE_SETUP_TOKEN: "claude_setup_token",
} as const;

export type ProviderKeyKind = (typeof PROVIDER_KEY_KIND)[keyof typeof PROVIDER_KEY_KIND];

/** The provider each subscription kind belongs to; an API key belongs to whichever provider it is saved for. */
export const SUBSCRIPTION_KIND_PROVIDER = {
  [PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN]: PROVIDER_KEY_PROVIDER.ANTHROPIC,
} as const satisfies Record<
  Exclude<ProviderKeyKind, typeof PROVIDER_KEY_KIND.API_KEY>,
  ProviderKeyProvider
>;

/** How the provider last answered a stored key, or that the service can no longer read it. */
export const PROVIDER_KEY_STATUS = {
  /** The provider accepted the key at its last use or check. */
  VERIFIED: "verified",
  /** The provider refused the key: revoked, or never one of its keys. */
  INVALID: "invalid",
  /** The provider accepted the key but refused the work for its account's billing. */
  QUOTA_EXCEEDED: "quota_exceeded",
  /** The service cannot decrypt the key it holds, so it is used for nothing until it is replaced. */
  UNREADABLE: "unreadable",
  /** A subscription credential no provider has answered yet: it is kept unchecked, since Luke never calls a provider on a plan itself. */
  UNVERIFIED: "unverified",
} as const;

export type ProviderKeyStatus = (typeof PROVIDER_KEY_STATUS)[keyof typeof PROVIDER_KEY_STATUS];

/**
 * Whether the organization behind a stored Anthropic key may run Anthropic's
 * fast mode, a research preview it grants organization by organization, as
 * the provider last answered a fast request on the key. A key no fast
 * request has settled has none.
 */
export const FAST_ACCESS = {
  /** The provider ran a fast request on the key. */
  ENABLED: "enabled",
  /** The provider refused a fast request on the key against a fast limit of 0: its organization was never granted fast mode. */
  NOT_ENABLED: "not_enabled",
} as const;

export type FastAccess = (typeof FAST_ACCESS)[keyof typeof FAST_ACCESS];

/** Why a save kept nothing. */
export const PROVIDER_KEY_REJECTION = {
  /** The provider refused the key. */
  INVALID: "invalid",
  /** The key is the other provider's, by its prefix; nothing was sent to either. */
  WRONG_PROVIDER: "wrong_provider",
  /** The provider could not be asked, or did not answer; the same key may be tried again. */
  UNREACHABLE: "unreachable",
  /** The account saved too many keys in too short a time; nothing was sent to the provider. */
  TOO_MANY_TRIES: "too_many_tries",
} as const;

export type ProviderKeyRejection =
  (typeof PROVIDER_KEY_REJECTION)[keyof typeof PROVIDER_KEY_REJECTION];

const PROVIDER_KEY_BOUNDS = {
  /** No provider key is shorter; a paste this short is no key. */
  MIN_KEY_CHARS: 20,
  /** No provider key is longer; a paste past it is no key. */
  MAX_KEY_CHARS: 512,
} as const;

/** The query `DELETE` names its provider in, and the kind where it is not an API key. */
export const PROVIDER_KEY_QUERY = {
  PROVIDER: "provider",
  KIND: "kind",
} as const;

const providerSchema = EffectSchema.Literals(Object.values(PROVIDER_KEY_PROVIDER));

/** A stored credential's kind, as a request names it; a request that names none means an API key. */
export const providerKeyKindSchema = EffectSchema.Literals(Object.values(PROVIDER_KEY_KIND));

/** What the account sees of one stored key: never the key, only what tells it apart. */
export const providerKeySummarySchema = EffectSchema.Struct({
  provider: providerSchema,
  /** The key's own prefix and its last four characters, as `sk-ant-…abcd`. */
  hint: EffectSchema.String,
  /** When this key was saved, in epoch milliseconds; a replaced key is added anew. */
  addedAt: countedNumber,
  status: EffectSchema.Literals(Object.values(PROVIDER_KEY_STATUS)),
  /** When the status was last set, in epoch milliseconds. */
  statusAt: countedNumber,
});

export type ProviderKeySummary = typeof providerKeySummarySchema.Type;

/** What the account sees of one stored subscription credential: never the credential, only what tells it apart. */
export const subscriptionKeySummarySchema = EffectSchema.Struct({
  ...providerKeySummarySchema.fields,
  kind: providerKeyKindSchema,
});

export type SubscriptionKeySummary = typeof subscriptionKeySummarySchema.Type;

/**
 * The account's keys (GET, DELETE, and every PUT's answer), with why a save
 * kept nothing where it did. `keys` holds its API keys alone, as every
 * desktop reads them; its subscription credentials stand apart, so a desktop
 * that knows no kind never reads one as an API key.
 */
export const providerKeysAnswerSchema = EffectSchema.Struct({
  keys: EffectSchema.Array(providerKeySummarySchema),
  subscriptions: EffectSchema.optionalKey(EffectSchema.Array(subscriptionKeySummarySchema)),
  rejected: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(PROVIDER_KEY_REJECTION))),
});

export type ProviderKeysAnswer = typeof providerKeysAnswerSchema.Type;

/** Saving a key for a provider (PUT), replacing the one of its kind it held; a request naming no kind saves an API key. */
export const providerKeySaveRequestSchema = EffectSchema.Struct({
  provider: providerSchema,
  kind: EffectSchema.optionalKey(providerKeyKindSchema),
  key: EffectSchema.Trim.check(
    EffectSchema.isMinLength(PROVIDER_KEY_BOUNDS.MIN_KEY_CHARS),
    EffectSchema.isMaxLength(PROVIDER_KEY_BOUNDS.MAX_KEY_CHARS),
    EffectSchema.isPattern(/^\S+$/u),
  ),
});
