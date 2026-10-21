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
 * the query removes one, and `PATCH` turns a plan's default for the
 * account's coding agents on or off. Every answer carries the account's keys as they
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
  /**
   * A ChatGPT plan's renewable sign-in, as OpenAI's open-source Sign in with
   * ChatGPT issues it to the desktop for Luke's hosted runtime; OpenAI's
   * alone. It is saved through its own route (`chatGptCredentialsSaveRequestSchema`),
   * never as a pasted key.
   */
  CHATGPT_OAUTH: "chatgpt_oauth",
} as const;

export type ProviderKeyKind = (typeof PROVIDER_KEY_KIND)[keyof typeof PROVIDER_KEY_KIND];

/** The provider each subscription kind belongs to; an API key belongs to whichever provider it is saved for. */
export const SUBSCRIPTION_KIND_PROVIDER = {
  [PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN]: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  [PROVIDER_KEY_KIND.CHATGPT_OAUTH]: PROVIDER_KEY_PROVIDER.OPENAI,
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
  /** A plan whose usage limit refused an agent's turn; it pays again once the limit resets, which `limitResetsAt` says where the provider said. */
  LIMIT_REACHED: "limit_reached",
  /** A ChatGPT account OpenAI answered is not eligible to run Codex on its plan. */
  INELIGIBLE: "ineligible",
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
  /**
   * A ChatGPT sign-in whose ID token is not one OpenAI signed for its issued
   * client, has expired, or names another account than the one handed over,
   * or whose access token names another client, audience or issuer; nothing
   * was kept.
   */
  UNVERIFIED_SIGN_IN: "unverified_sign_in",
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
const providerKeySummarySchema = EffectSchema.Struct({
  provider: providerSchema,
  /** The key's own prefix and its last four characters, as `sk-ant-…abcd`. */
  hint: EffectSchema.String,
  /** When this key was saved, in epoch milliseconds; a replaced key is added anew. */
  addedAt: countedNumber,
  status: EffectSchema.Literals(Object.values(PROVIDER_KEY_STATUS)),
  /** When the status was last set, in epoch milliseconds. */
  statusAt: countedNumber,
  /** When a plan's reached limit resets, in epoch milliseconds, where the provider said; absent otherwise. */
  limitResetsAt: EffectSchema.optionalKey(countedNumber),
});

export type ProviderKeySummary = typeof providerKeySummarySchema.Type;

/** What the account sees of one stored subscription credential: never the credential, only what tells it apart. */
const subscriptionKeySummarySchema = EffectSchema.Struct({
  ...providerKeySummarySchema.fields,
  kind: providerKeyKindSchema,
  /**
   * Whether the plan pays for the account's coding agents by default, as
   * "Use my Claude plan for coding agents" says; on once it is connected.
   * A service that predates the default answers none, which reads as on.
   */
  forAgents: EffectSchema.optionalKey(EffectSchema.Boolean),
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
  /**
   * Set where a ChatGPT sign-in was removed without OpenAI confirming its
   * renewable session revoked: Luke holds it no longer, and the account may
   * disconnect Luke in ChatGPT's settings to end it there.
   */
  revocationUnconfirmed: EffectSchema.optionalKey(EffectSchema.Literal(true)),
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

/** The subscription kinds, which alone carry a default for the account's coding agents. */
const subscriptionKindSchema = EffectSchema.Literals([
  PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  PROVIDER_KEY_KIND.CHATGPT_OAUTH,
]);

/**
 * Turning a connected plan's default for the account's coding agents on or
 * off (PATCH): the provider and the subscription's kind, and whether it
 * pays for them unless Start picks another payer. A plan the account does
 * not hold changes nothing, and the answer shows it absent.
 */
export const providerKeyForAgentsRequestSchema = EffectSchema.Struct({
  provider: providerSchema,
  kind: subscriptionKindSchema,
  forAgents: EffectSchema.Boolean,
});

/** No OAuth token, client id, or subject Luke is handed is longer; a field past it is no credential. */
const CHATGPT_CREDENTIAL_BOUNDS = {
  MAX_TOKEN_CHARS: 16_384,
  MAX_ID_CHARS: 512,
  MAX_SCOPES: 32,
  /** OpenAI's access tokens last an hour; an expiry past a day is no token of this flow. */
  MAX_EXPIRES_IN_SECONDS: 86_400,
} as const;

const credentialToken = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(CHATGPT_CREDENTIAL_BOUNDS.MAX_TOKEN_CHARS),
  EffectSchema.isPattern(/^\S+$/u),
);

const credentialId = EffectSchema.String.check(
  EffectSchema.isMinLength(1),
  EffectSchema.isMaxLength(CHATGPT_CREDENTIAL_BOUNDS.MAX_ID_CHARS),
  EffectSchema.isPattern(/^\S+$/u),
);

/**
 * A ChatGPT sign-in the desktop completed for Luke's hosted runtime (PUT),
 * as OpenAI's token endpoint answered it and its ID token validated on the
 * desktop: the issued client it renews under, the account's validated
 * subject, the tokens, the access token's lifetime from the moment the
 * desktop received it, and the scopes granted. It travels once, in this
 * body, and no answer ever carries any of it back. A save replaces the
 * account's ChatGPT sign-in whole.
 */
export const chatGptCredentialsSaveRequestSchema = EffectSchema.Struct({
  /** The `client_id` OpenAI issued at registration, never `dynamic_agent_client`. */
  clientId: credentialId,
  /** The validated ID token's subject: which ChatGPT account the sign-in is. */
  accountId: credentialId,
  accessToken: credentialToken,
  refreshToken: credentialToken,
  /** The ID token retained for a later sign-in's `id_token_hint`. */
  idToken: credentialToken,
  expiresInSeconds: EffectSchema.Int.check(
    EffectSchema.isGreaterThan(0),
    EffectSchema.isLessThanOrEqualTo(CHATGPT_CREDENTIAL_BOUNDS.MAX_EXPIRES_IN_SECONDS),
  ),
  scopes: EffectSchema.Array(credentialId).check(
    EffectSchema.isMaxLength(CHATGPT_CREDENTIAL_BOUNDS.MAX_SCOPES),
  ),
});

export type ChatGptCredentialsSaveRequest = typeof chatGptCredentialsSaveRequestSchema.Type;

/**
 * The account's `ext_agent_host_id` for Luke's hosted runtime (GET), minted
 * on the first read and the same on every read after it, a sign-out's
 * included, which the desktop names as the host when it signs in for Luke.
 * An opaque identifier, not a credential.
 */
export const chatGptHostAnswerSchema = EffectSchema.Struct({
  extAgentHostId: EffectSchema.String,
});

export type ChatGptHostAnswer = typeof chatGptHostAnswerSchema.Type;
