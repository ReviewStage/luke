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
} as const;

export type ProviderKeyStatus = (typeof PROVIDER_KEY_STATUS)[keyof typeof PROVIDER_KEY_STATUS];

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

/** The query `DELETE` names its provider in. */
export const PROVIDER_KEY_QUERY = {
  PROVIDER: "provider",
} as const;

const providerSchema = EffectSchema.Literals(Object.values(PROVIDER_KEY_PROVIDER));

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

/** The account's keys (GET, DELETE, and every PUT's answer), with why a save kept nothing where it did. */
export const providerKeysAnswerSchema = EffectSchema.Struct({
  keys: EffectSchema.Array(providerKeySummarySchema),
  rejected: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(PROVIDER_KEY_REJECTION))),
});

export type ProviderKeysAnswer = typeof providerKeysAnswerSchema.Type;

/** Saving a key for a provider (PUT), replacing the one it held. */
export const providerKeySaveRequestSchema = EffectSchema.Struct({
  provider: providerSchema,
  key: EffectSchema.Trim.check(
    EffectSchema.isMinLength(PROVIDER_KEY_BOUNDS.MIN_KEY_CHARS),
    EffectSchema.isMaxLength(PROVIDER_KEY_BOUNDS.MAX_KEY_CHARS),
    EffectSchema.isPattern(/^\S+$/u),
  ),
});
