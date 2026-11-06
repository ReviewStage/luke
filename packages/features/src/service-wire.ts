import { EXCESS_KEYS } from "@repo/wire";
import { readEither, verbatimJsonSchema } from "@repo/wire/effect";
import { Schema as EffectSchema, SchemaTransformation } from "effect";

export const HOSTED_API_ERROR = {
  INVALID_TOKEN: "invalid-token",
  INVALID_REQUEST: "invalid-request",
  QUOTA_EXHAUSTED: "quota-exhausted",
  UNAVAILABLE: "unavailable",
  UPSTREAM_ERROR: "upstream-error",
  UPSTREAM_THROTTLED: "upstream-throttled",
  REQUEST_TOO_LARGE: "request-too-large",
  PROMPT_TOO_LARGE: "prompt-too-large",
  UNKNOWN_TOOL: "unknown-tool",
  METHOD_NOT_ALLOWED: "method-not-allowed",
  NOT_FOUND: "not-found",
  REPOSITORY_NOT_REACHABLE: "repository-not-reachable",
  GITHUB_UNANSWERED: "github-unanswered",
  NO_REPOSITORY: "no-repository",
  BRANCH_NOT_FOUND: "branch-not-found",
  MESSAGE_TOO_LONG: "message-too-long",
  AGENT_NOT_READY: "agent-not-ready",
  AGENT_RETIRED: "agent-retired",
  NATIVE_AGENT_NOT_HERE: "native-agent-not-here",
  OPENAI_KEY_MISSING: "openai-key-missing",
  OPENAI_KEY_REFUSED: "openai-key-refused",
  OPENAI_KEY_UNFUNDED: "openai-key-unfunded",
  AGENT_PLAN_SIGNED_OUT: "agent-plan-signed-out",
  AGENT_PLAN_UNREACHABLE: "agent-plan-unreachable",
  AGENT_PLAN_LIMIT_REACHED: "agent-plan-limit-reached",
  AGENT_PLAN_INELIGIBLE: "agent-plan-ineligible",
  AGENT_CREDENTIAL_MISSING: "agent-credential-missing",
  AGENT_API_KEY_UNREADABLE: "agent-api-key-unreadable",
  NOT_PERMITTED: "not-permitted",
  ALREADY_INVITED: "already-invited",
  SANDBOX_STOPPED: "sandbox-stopped",
  SANDBOX_SNAPSHOT_GONE: "sandbox-snapshot-gone",
  SKILL_NAME_TAKEN: "skill-name-taken",
  SKILL_FILES_REFUSED: "skill-files-refused",
  WORKSPACE_SLUG_MALFORMED: "workspace-slug-malformed",
  WORKSPACE_SLUG_RESERVED: "workspace-slug-reserved",
  WORKSPACE_SLUG_TAKEN: "workspace-slug-taken",
  LOCAL_AGENT_REFUSED: "local-agent-refused",
  EXTRA_REPOSITORY_REFUSED: "extra-repository-refused",
  HOST_UPGRADE_NEEDED: "host-upgrade-needed",
  DEVICE_REMOVED: "device-removed",
  CHILD_REPOSITORY_LOCKED: "child-repository-locked",
  TASK_BLOCK_CYCLE: "task-block-cycle",
  TASK_PARENT_CYCLE: "task-parent-cycle",
  TASK_PARENT_HELD: "task-parent-held",
  HOST_PAIRING_HELD: "host-pairing-held",
  ALREADY_WRITTEN: "already-written",
  MEMORY_OFF: "memory-off",
  MEMORY_CREDENTIAL: "memory-credential",
  MEMORY_FULL: "memory-full",
} as const;

export type HostedApiError = (typeof HOSTED_API_ERROR)[keyof typeof HOSTED_API_ERROR];

export const IDEMPOTENCY_KEY = {
  HEADER: "idempotency-key",
  MAX_LENGTH: 255,
} as const;

export interface HostedQuota {
  used: number;
  limit: number;
  resetsAt: number;
}

const HOSTED_API_ERROR_NAMES = Object.values(HOSTED_API_ERROR);

export const countedNumber = EffectSchema.Finite.check(EffectSchema.isGreaterThanOrEqualTo(0));

export const readServiceAnswer = <S extends EffectSchema.ConstraintDecoder<unknown>>(schema: S) =>
  readEither(schema, { excess: EXCESS_KEYS.DROP });

export const hostedQuotaSchema = EffectSchema.Struct({
  used: countedNumber,
  limit: countedNumber,
  resetsAt: countedNumber,
});

function trimmedEnum<const Member extends string>(members: readonly Member[]) {
  return verbatimJsonSchema(
    EffectSchema.Trim.pipe(
      EffectSchema.decodeTo(
        EffectSchema.Literals(members),
        SchemaTransformation.passthroughSupertype(),
      ),
    ),
    { type: "string", enum: members },
  );
}

const hostedErrorRecord = EffectSchema.Struct({ error: trimmedEnum(HOSTED_API_ERROR_NAMES) });

export const hostedErrorSchema = hostedErrorRecord.pipe(
  EffectSchema.decodeTo(
    EffectSchema.Literals(HOSTED_API_ERROR_NAMES),
    SchemaTransformation.transform({
      decode: (answer) => answer.error,
      encode: (error) => ({ error }),
    }),
  ),
);

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

export const WIRE_UUID_LENGTH = 36;

export function isWireUuid(value: string): boolean {
  return UUID_PATTERN.test(value);
}

const trimmedUuidText = EffectSchema.Trim.check(
  EffectSchema.isNonEmpty(),
  EffectSchema.isMaxLength(WIRE_UUID_LENGTH),
);

export const wireUuidSchema = trimmedUuidText
  .pipe(EffectSchema.decodeTo(EffectSchema.String, SchemaTransformation.toLowerCase()))
  .check(EffectSchema.makeFilter(isWireUuid));

export const chosenIdSchema = wireUuidSchema;

export const memberRefSchema = EffectSchema.Struct({
  userId: EffectSchema.String,
  name: EffectSchema.String,
});
