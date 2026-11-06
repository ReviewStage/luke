import { Schema as EffectSchema, SchemaTransformation } from "effect";
import { MODEL_PROVIDER } from "./models-wire.js";
import { countedNumber } from "./service-wire.js";

export const PROVIDER_KEY_PROVIDER = MODEL_PROVIDER;

export type ProviderKeyProvider =
  (typeof PROVIDER_KEY_PROVIDER)[keyof typeof PROVIDER_KEY_PROVIDER];

export const PROVIDER_KEY_KIND = {
  API_KEY: "api_key",
  CLAUDE_SETUP_TOKEN: "claude_setup_token",
  CHATGPT_OAUTH: "chatgpt_oauth",
} as const;

export type ProviderKeyKind = (typeof PROVIDER_KEY_KIND)[keyof typeof PROVIDER_KEY_KIND];

export const SUBSCRIPTION_KIND_PROVIDER = {
  [PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN]: PROVIDER_KEY_PROVIDER.ANTHROPIC,
  [PROVIDER_KEY_KIND.CHATGPT_OAUTH]: PROVIDER_KEY_PROVIDER.OPENAI,
} as const satisfies Record<
  Exclude<ProviderKeyKind, typeof PROVIDER_KEY_KIND.API_KEY>,
  ProviderKeyProvider
>;

export const PROVIDER_KEY_STATUS = {
  VERIFIED: "verified",
  INVALID: "invalid",
  QUOTA_EXCEEDED: "quota_exceeded",
  UNREADABLE: "unreadable",
  UNVERIFIED: "unverified",
  LIMIT_REACHED: "limit_reached",
  INELIGIBLE: "ineligible",
} as const;

export type ProviderKeyStatus = (typeof PROVIDER_KEY_STATUS)[keyof typeof PROVIDER_KEY_STATUS];

export interface WrittenPlanStatus {
  readonly status: ProviderKeyStatus;
  readonly limitResetsAt?: Date | number | null | undefined;
}

function resetMillis(resetsAt: Date | number | null | undefined): number | undefined {
  if (resetsAt === null || resetsAt === undefined) return undefined;
  return typeof resetsAt === "number" ? resetsAt : resetsAt.getTime();
}

export function planStanding(plan: WrittenPlanStatus, now: number): ProviderKeyStatus {
  if (plan.status !== PROVIDER_KEY_STATUS.LIMIT_REACHED) return plan.status;
  const resetsAt = resetMillis(plan.limitResetsAt);
  return resetsAt !== undefined && resetsAt <= now
    ? PROVIDER_KEY_STATUS.VERIFIED
    : PROVIDER_KEY_STATUS.LIMIT_REACHED;
}

export function planLimitResetsAt(plan: WrittenPlanStatus, now: number): number | undefined {
  if (planStanding(plan, now) !== PROVIDER_KEY_STATUS.LIMIT_REACHED) return undefined;
  return resetMillis(plan.limitResetsAt);
}

export const FAST_ACCESS = {
  ENABLED: "enabled",
  NOT_ENABLED: "not_enabled",
} as const;

export type FastAccess = (typeof FAST_ACCESS)[keyof typeof FAST_ACCESS];

export const PROVIDER_KEY_REJECTION = {
  INVALID: "invalid",
  WRONG_PROVIDER: "wrong_provider",
  UNREACHABLE: "unreachable",
  TOO_MANY_TRIES: "too_many_tries",
} as const;

export type ProviderKeyRejection =
  (typeof PROVIDER_KEY_REJECTION)[keyof typeof PROVIDER_KEY_REJECTION];

const PROVIDER_KEY_BOUNDS = {
  MIN_KEY_CHARS: 20,
  MAX_KEY_CHARS: 512,
} as const;

export const PROVIDER_KEY_QUERY = {
  PROVIDER: "provider",
  KIND: "kind",
} as const;

const providerSchema = EffectSchema.Literals(Object.values(PROVIDER_KEY_PROVIDER));

export const providerKeyKindSchema = EffectSchema.Literals(Object.values(PROVIDER_KEY_KIND));

const providerKeySummarySchema = EffectSchema.Struct({
  provider: providerSchema,
  hint: EffectSchema.String,
  addedAt: countedNumber,
  status: EffectSchema.Literals(Object.values(PROVIDER_KEY_STATUS)),
  statusAt: countedNumber,
  limitResetsAt: EffectSchema.optionalKey(countedNumber),
});

export type ProviderKeySummary = typeof providerKeySummarySchema.Type;

const subscriptionKeySummarySchema = EffectSchema.Struct({
  ...providerKeySummarySchema.fields,
  kind: providerKeyKindSchema,
  forAgents: EffectSchema.optionalKey(EffectSchema.Boolean),
});

export type SubscriptionKeySummary = typeof subscriptionKeySummarySchema.Type;

export const providerKeysAnswerSchema = EffectSchema.Struct({
  keys: EffectSchema.Array(providerKeySummarySchema),
  subscriptions: EffectSchema.optionalKey(EffectSchema.Array(subscriptionKeySummarySchema)),
  rejected: EffectSchema.optionalKey(EffectSchema.Literals(Object.values(PROVIDER_KEY_REJECTION))),
  revocationUnconfirmed: EffectSchema.optionalKey(EffectSchema.Literal(true)),
});

export type ProviderKeysAnswer = typeof providerKeysAnswerSchema.Type;

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

export const providerKeySaveRequestSchema = EffectSchema.Struct({
  provider: providerSchema,
  kind: EffectSchema.optionalKey(providerKeyKindSchema),
  key: pastedKeySchema,
});

const subscriptionKindSchema = EffectSchema.Literals([
  PROVIDER_KEY_KIND.CLAUDE_SETUP_TOKEN,
  PROVIDER_KEY_KIND.CHATGPT_OAUTH,
]);

export const providerKeyForAgentsRequestSchema = EffectSchema.Struct({
  provider: providerSchema,
  kind: subscriptionKindSchema,
  forAgents: EffectSchema.Boolean,
});

export const CHATGPT_DEVICE_LOGIN = {
  PENDING: "pending",
  CONNECTED: "connected",
  EXPIRED: "expired",
  REFUSED: "refused",
  CANCELED: "canceled",
} as const;

export type ChatGptDeviceLoginOutcome =
  (typeof CHATGPT_DEVICE_LOGIN)[keyof typeof CHATGPT_DEVICE_LOGIN];

export type ChatGptDeviceSettled =
  | typeof CHATGPT_DEVICE_LOGIN.CONNECTED
  | typeof CHATGPT_DEVICE_LOGIN.EXPIRED
  | typeof CHATGPT_DEVICE_LOGIN.REFUSED;

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

const CHATGPT_DEVICE_LOGIN_ID_MAX_CHARS = 64;

export const chatGptDeviceStartAnswerSchema = EffectSchema.Struct({
  loginId: EffectSchema.String,
  userCode: EffectSchema.String,
  verificationUrl: EffectSchema.String,
  intervalSeconds: countedNumber,
  expiresAt: countedNumber,
});

export type ChatGptDeviceStartAnswer = typeof chatGptDeviceStartAnswerSchema.Type;

export const chatGptDeviceLoginRequestSchema = EffectSchema.Struct({
  loginId: EffectSchema.String.check(
    EffectSchema.isMinLength(1),
    EffectSchema.isMaxLength(CHATGPT_DEVICE_LOGIN_ID_MAX_CHARS),
  ),
});

export type ChatGptDeviceLoginRequest = typeof chatGptDeviceLoginRequestSchema.Type;

export const chatGptDevicePollAnswerSchema = EffectSchema.Struct({
  outcome: EffectSchema.Literals(Object.values(CHATGPT_DEVICE_LOGIN)),
  message: EffectSchema.optionalKey(EffectSchema.String),
  keys: EffectSchema.optionalKey(providerKeysAnswerSchema),
});

export type ChatGptDevicePollAnswer = typeof chatGptDevicePollAnswerSchema.Type;
