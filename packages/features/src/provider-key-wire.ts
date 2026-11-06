import { Schema as EffectSchema, SchemaTransformation } from "effect";
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

/** The providers an account may hold a key of its own for: the two we run coding agents on. */
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
   * A ChatGPT plan's renewable sign-in, as Codex's device-code login issues
   * it to the service for our hosted runtime; OpenAI's alone. The service
   * keeps it as the login connects, never as a pasted key.
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
  /** A subscription credential no provider has answered yet: it is kept unchecked, since we never call a provider on a plan itself. */
  UNVERIFIED: "unverified",
  /** A plan whose usage limit refused an agent's turn; it pays again once the limit resets, which `limitResetsAt` says where the provider said. */
  LIMIT_REACHED: "limit_reached",
  /** A ChatGPT account OpenAI answered is not eligible to run Codex on its plan. */
  INELIGIBLE: "ineligible",
} as const;

export type ProviderKeyStatus = (typeof PROVIDER_KEY_STATUS)[keyof typeof PROVIDER_KEY_STATUS];

/** A plan's status as it was written, with the reset its reached limit named, as a row (a `Date`) or a summary (epoch milliseconds) holds it. */
export interface WrittenPlanStatus {
  readonly status: ProviderKeyStatus;
  readonly limitResetsAt?: Date | number | null | undefined;
}

/** A named reset in epoch milliseconds, or none. */
function resetMillis(resetsAt: Date | number | null | undefined): number | undefined {
  if (resetsAt === null || resetsAt === undefined) return undefined;
  return typeof resetsAt === "number" ? resetsAt : resetsAt.getTime();
}

/**
 * Where a plan stands at `now`, the one rule its harnesses, the service's
 * answer, and the label read alike: its written status, but for a reached
 * limit whose named reset has passed, which pays again, and reads as
 * verified, because the provider that answered the limit took the
 * credential. A limit with no reset named stands until a turn finds it
 * lifted.
 */
export function planStanding(plan: WrittenPlanStatus, now: number): ProviderKeyStatus {
  if (plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED) return plan.status;
  const resetsAt = resetMillis(plan.limitResetsAt);
  return resetsAt !== undefined && resetsAt <= now
    ? PROVIDER_KEY_STATUS.VERIFIED
    : PROVIDER_KEY_STATUS.LIMIT_REACHED;
}

/**
 * The named reset of a plan's limit that still stands at `now`, in epoch
 * milliseconds: what a launch on the plan is refused until. Note that a
 * limit with no reset named refuses nothing, because only a turn can find
 * it lifted, and a turn needs a launch.
 */
export function planLimitResetsAt(plan: WrittenPlanStatus, now: number): number | undefined {
  if (planStanding(plan, now) !== PROVIDER_KEY_STATUS.LIMIT_REACHED) return undefined;
  return resetMillis(plan.limitResetsAt);
}

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
   * renewable session revoked: we hold it no longer, and the account may
   * disconnect the app in ChatGPT's settings to end it there.
   */
  revocationUnconfirmed: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

export type ProviderKeysAnswer = typeof providerKeysAnswerSchema.Type;

/**
 * A pasted key with every whitespace character taken out, then bounded. Note
 * that we strip inside the key too, not only its ends, because no provider's
 * key holds whitespace and `claude setup-token` wraps its token at the
 * terminal's width, so a copy of it carries a line break and an indent.
 */
const pastedKeySchema = EffectSchema.String.pipe(
  EffectSchema.decodeTo(
    EffectSchema.String.check(
      EffectSchema.isMinLength(PROVIDER_KEY_BOUNDS.MIN_KEY_CHARS),
      EffectSchema.isMaxLength(PROVIDER_KEY_BOUNDS.MAX_KEY_CHARS),
    ),
    SchemaTransformation.transform({
      decode: (pasted) => pasted.replace(/\s/gu, ""),
      encode: (key) => key,
    }),
  ),
);

/** Saving a key for a provider (PUT), replacing the one of its kind it held; a request naming no kind saves an API key. */
export const providerKeySaveRequestSchema = EffectSchema.Struct({
  provider: providerSchema,
  kind: EffectSchema.optionalKey(providerKeyKindSchema),
  key: pastedKeySchema,
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

/**
 * How a ChatGPT plan's connection through Codex's device-code login
 * stands, as a poll answers it: still waiting for the code to be entered,
 * connected, or one of a fixed set of failures. A failure is answered as a
 * fixed sentence of ours (`CHATGPT_DEVICE_FAILURE_MESSAGE`) and never in
 * OpenAI's words.
 */
export const CHATGPT_DEVICE_LOGIN = {
  /** The code has not been entered yet; poll again after the interval. */
  PENDING: "pending",
  /** The plan is connected, replacing whichever ChatGPT sign-in the account held. */
  CONNECTED: "connected",
  /** The code was not entered before it lapsed. */
  EXPIRED: "expired",
  /** OpenAI refused the login, or answered nothing a sign-in could be kept from. */
  REFUSED: "refused",
  /** The login was canceled, replaced by a newer one, or is none of the account's. */
  CANCELED: "canceled",
} as const;

export type ChatGptDeviceLoginOutcome =
  (typeof CHATGPT_DEVICE_LOGIN)[keyof typeof CHATGPT_DEVICE_LOGIN];

/** How a login settled, which every poll after the one that settled it answers again. */
export type ChatGptDeviceSettled =
  | typeof CHATGPT_DEVICE_LOGIN.CONNECTED
  | typeof CHATGPT_DEVICE_LOGIN.EXPIRED
  | typeof CHATGPT_DEVICE_LOGIN.REFUSED;

/** The one sentence each failure is answered with. */
export const CHATGPT_DEVICE_FAILURE_MESSAGE = {
  [CHATGPT_DEVICE_LOGIN.EXPIRED]:
    "The code expired before it was entered. Start again for a new one.",
  [CHATGPT_DEVICE_LOGIN.REFUSED]:
    "ChatGPT did not connect this account. Start again to try once more.",
  [CHATGPT_DEVICE_LOGIN.CANCELED]: "This connection was canceled. Start again for a new code.",
} as const satisfies Record<
  Exclude<
    ChatGptDeviceLoginOutcome,
    typeof CHATGPT_DEVICE_LOGIN.PENDING | typeof CHATGPT_DEVICE_LOGIN.CONNECTED
  >,
  string
>;

/** No login id we mint is longer; one past it is none of ours. */
const CHATGPT_DEVICE_LOGIN_ID_MAX_CHARS = 64;

/**
 * A device-code connection begun (POST): the login the panel polls and
 * cancels by, the code the account enters at the verification page, how
 * often to poll, and when the code lapses, in epoch milliseconds. What
 * claims the sign-in at OpenAI stays on the service.
 */
export const chatGptDeviceStartAnswerSchema = EffectSchema.Struct({
  loginId: EffectSchema.String,
  userCode: EffectSchema.String,
  verificationUrl: EffectSchema.String,
  intervalSeconds: countedNumber,
  expiresAt: countedNumber,
});

export type ChatGptDeviceStartAnswer = typeof chatGptDeviceStartAnswerSchema.Type;

/** A poll or a cancel of a device-code connection (POST), by the login its start answered. */
export const chatGptDeviceLoginRequestSchema = EffectSchema.Struct({
  loginId: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(CHATGPT_DEVICE_LOGIN_ID_MAX_CHARS),
  ),
});

export type ChatGptDeviceLoginRequest = typeof chatGptDeviceLoginRequestSchema.Type;

/**
 * How a device-code connection stands (a poll's answer, and a cancel's):
 * its outcome, the fixed sentence of a failure, and the account's keys as
 * they then stand once it connected.
 */
export const chatGptDevicePollAnswerSchema = EffectSchema.Struct({
  outcome: EffectSchema.Literals(Object.values(CHATGPT_DEVICE_LOGIN)),
  message: EffectSchema.optionalKey(EffectSchema.String),
  keys: EffectSchema.optionalKey(providerKeysAnswerSchema),
});

export type ChatGptDevicePollAnswer = typeof chatGptDevicePollAnswerSchema.Type;
