/**
 * errors.ts -- the one map of refusals every hosted procedure declares, keyed by the slug the wire spells.
 *
 * An oRPC error's code is the refusal's own slug, so the encoder writes it
 * back as `{ error: code }` unchanged and a desktop that reads `error` reads
 * the refusal as it always did. A refusal that carries more than its slug
 * declares the rest as the error's `data`, which the encoder writes beside
 * `error` at the top level, exactly where the old body carried it.
 *
 * Note that a `data` schema is flipped, because oRPC decodes an error's data
 * against it before the encoder writes it: flipped, that decode is the wire
 * schema's encode, so what is written is the wire's own encoded value
 * (`packages/service/src/orpc/base.ts` says the same of outputs).
 */

import type { ErrorMapItem } from "@orpc/contract";
import { Schema as EffectSchema } from "effect";
import {
  extraRepositoryRefusalSchema,
  localAgentRefusalSchema,
  refusedDeviceSchema,
} from "../agent-wire.js";
import {
  hostPairingHeldDataSchema,
  hostRemovedDataSchema,
  hostUpgradeNeededDataSchema,
} from "../host-wire.js";
import { installedSkillRefusedDataSchema } from "../installed-skill-route-wire.js";
import { modelProviderSchema } from "../models-wire.js";
import { repositoryUnreachedSchema } from "../repository-reach-wire.js";
import { HOSTED_API_ERROR, type HostedApiError } from "../service-wire.js";

/**
 * What a repository out of reach carries beside its slug: why, which the
 * desktop reads for the failure's remedy.
 */
const repositoryNotReachableDataSchema = EffectSchema.Struct({
  unreached: EffectSchema.optionalKey(repositoryUnreachedSchema),
});

/**
 * What an upstream that refused carries beside its slug: the status it
 * answered, and none of its body, for the alerts that watch the route.
 */
const upstreamErrorDataSchema = EffectSchema.Struct({
  upstreamStatus: EffectSchema.optionalKey(EffectSchema.Int),
});

/**
 * What a plan's reached limit carries beside its slug: when it resets, in
 * epoch milliseconds, where the provider said, which the refusal's words
 * name.
 */
export const planLimitReachedDataSchema = EffectSchema.Struct({
  resetsAt: EffectSchema.optionalKey(EffectSchema.Number),
});

/**
 * What a missing credential carries beside its slug: the provider whose
 * subscription or API key would pay, which the refusal's words name.
 */
export const credentialMissingDataSchema = EffectSchema.Struct({
  provider: EffectSchema.optionalKey(modelProviderSchema),
});

/** What a refused local agent carries beside its slug: why, which the refusal's words name, and the device and its owner where it is another member's. */
export const localAgentRefusedDataSchema = EffectSchema.Struct({
  localAgentRefusal: EffectSchema.optionalKey(localAgentRefusalSchema),
  refusedDevice: EffectSchema.optionalKey(refusedDeviceSchema),
});

/** What a refused Start naming repositories beside its agent's own carries beside its slug: why, and the repository where one is why. */
export const extraRepositoryRefusedDataSchema = EffectSchema.Struct({
  extraRepositoryRefusal: EffectSchema.optionalKey(extraRepositoryRefusalSchema),
  refusedRepository: EffectSchema.optionalKey(EffectSchema.String),
});

/**
 * The fields each refusal that carries more than its slug carries beside
 * it, as the wire spells them: a refused bearer that was a device secret no
 * standing host holds (which the host reads as removed), an upstream's
 * status, a repository's reach, a plan's reset, a missing credential's
 * provider, a refused skill, a refused local agent or extra repository, the
 * daemon version the service takes, and when a held pairing's guesses are
 * taken again. The client reads a refusal's fields with these as they stand
 * (`hosted-link.ts`); the map below declares each flipped.
 */
export const HOSTED_REFUSAL_DATA = {
  [HOSTED_API_ERROR.INVALID_TOKEN]: hostRemovedDataSchema,
  [HOSTED_API_ERROR.UPSTREAM_ERROR]: upstreamErrorDataSchema,
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: repositoryNotReachableDataSchema,
  [HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED]: planLimitReachedDataSchema,
  [HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING]: credentialMissingDataSchema,
  [HOSTED_API_ERROR.SKILL_NAME_TAKEN]: installedSkillRefusedDataSchema,
  [HOSTED_API_ERROR.SKILL_FILES_REFUSED]: installedSkillRefusedDataSchema,
  [HOSTED_API_ERROR.LOCAL_AGENT_REFUSED]: localAgentRefusedDataSchema,
  [HOSTED_API_ERROR.EXTRA_REPOSITORY_REFUSED]: extraRepositoryRefusedDataSchema,
  [HOSTED_API_ERROR.HOST_UPGRADE_NEEDED]: hostUpgradeNeededDataSchema,
  [HOSTED_API_ERROR.HOST_PAIRING_HELD]: hostPairingHeldDataSchema,
} as const satisfies Partial<
  Record<HostedApiError, EffectSchema.Struct<EffectSchema.Struct.Fields>>
>;

/** Whether a refusal carries fields beside its slug. */
export function refusalCarriesData(
  refusal: HostedApiError,
): refusal is keyof typeof HOSTED_REFUSAL_DATA {
  return Object.hasOwn(HOSTED_REFUSAL_DATA, refusal);
}

/** A refusal's fields as its declared error's `data`: the wire schema flipped, so oRPC's decode of it is the wire's encode. */
function declaredData<Type, Encoded>(schema: EffectSchema.Codec<Type, Encoded>) {
  return { data: EffectSchema.toStandardSchemaV1(EffectSchema.flip(schema)) };
}

/** Every hosted refusal, the slug its code, and the extra fields of each that carries some. */
export const HOSTED_ERRORS = {
  [HOSTED_API_ERROR.INVALID_TOKEN]: declaredData(
    HOSTED_REFUSAL_DATA[HOSTED_API_ERROR.INVALID_TOKEN],
  ),
  [HOSTED_API_ERROR.INVALID_REQUEST]: {},
  [HOSTED_API_ERROR.QUOTA_EXHAUSTED]: {},
  [HOSTED_API_ERROR.UNAVAILABLE]: {},
  [HOSTED_API_ERROR.UPSTREAM_ERROR]: declaredData(
    HOSTED_REFUSAL_DATA[HOSTED_API_ERROR.UPSTREAM_ERROR],
  ),
  [HOSTED_API_ERROR.UPSTREAM_THROTTLED]: {},
  [HOSTED_API_ERROR.REQUEST_TOO_LARGE]: {},
  [HOSTED_API_ERROR.PROMPT_TOO_LARGE]: {},
  [HOSTED_API_ERROR.UNKNOWN_TOOL]: {},
  [HOSTED_API_ERROR.METHOD_NOT_ALLOWED]: {},
  [HOSTED_API_ERROR.NOT_FOUND]: {},
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: declaredData(
    HOSTED_REFUSAL_DATA[HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE],
  ),
  [HOSTED_API_ERROR.GITHUB_UNANSWERED]: {},
  [HOSTED_API_ERROR.NO_REPOSITORY]: {},
  [HOSTED_API_ERROR.BRANCH_NOT_FOUND]: {},
  [HOSTED_API_ERROR.MESSAGE_TOO_LONG]: {},
  [HOSTED_API_ERROR.AGENT_NOT_READY]: {},
  [HOSTED_API_ERROR.AGENT_RETIRED]: {},
  [HOSTED_API_ERROR.NATIVE_AGENT_NOT_HERE]: {},
  [HOSTED_API_ERROR.OPENAI_KEY_MISSING]: {},
  [HOSTED_API_ERROR.OPENAI_KEY_REFUSED]: {},
  [HOSTED_API_ERROR.OPENAI_KEY_UNFUNDED]: {},
  [HOSTED_API_ERROR.AGENT_PLAN_SIGNED_OUT]: {},
  [HOSTED_API_ERROR.AGENT_PLAN_UNREACHABLE]: {},
  [HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED]: declaredData(
    HOSTED_REFUSAL_DATA[HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED],
  ),
  [HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE]: {},
  [HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING]: declaredData(
    HOSTED_REFUSAL_DATA[HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING],
  ),
  [HOSTED_API_ERROR.AGENT_API_KEY_UNREADABLE]: {},
  [HOSTED_API_ERROR.NOT_PERMITTED]: {},
  [HOSTED_API_ERROR.ALREADY_INVITED]: {},
  [HOSTED_API_ERROR.SANDBOX_STOPPED]: {},
  [HOSTED_API_ERROR.SANDBOX_SNAPSHOT_GONE]: {},
  [HOSTED_API_ERROR.SKILL_NAME_TAKEN]: declaredData(
    HOSTED_REFUSAL_DATA[HOSTED_API_ERROR.SKILL_NAME_TAKEN],
  ),
  [HOSTED_API_ERROR.SKILL_FILES_REFUSED]: declaredData(
    HOSTED_REFUSAL_DATA[HOSTED_API_ERROR.SKILL_FILES_REFUSED],
  ),
  [HOSTED_API_ERROR.WORKSPACE_SLUG_MALFORMED]: {},
  [HOSTED_API_ERROR.WORKSPACE_SLUG_RESERVED]: {},
  [HOSTED_API_ERROR.WORKSPACE_SLUG_TAKEN]: {},
  [HOSTED_API_ERROR.LOCAL_AGENT_REFUSED]: declaredData(
    HOSTED_REFUSAL_DATA[HOSTED_API_ERROR.LOCAL_AGENT_REFUSED],
  ),
  [HOSTED_API_ERROR.EXTRA_REPOSITORY_REFUSED]: declaredData(
    HOSTED_REFUSAL_DATA[HOSTED_API_ERROR.EXTRA_REPOSITORY_REFUSED],
  ),
  [HOSTED_API_ERROR.HOST_UPGRADE_NEEDED]: declaredData(
    HOSTED_REFUSAL_DATA[HOSTED_API_ERROR.HOST_UPGRADE_NEEDED],
  ),
  [HOSTED_API_ERROR.DEVICE_REMOVED]: {},
  [HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED]: {},
  [HOSTED_API_ERROR.TASK_BLOCK_CYCLE]: {},
  [HOSTED_API_ERROR.TASK_PARENT_CYCLE]: {},
  [HOSTED_API_ERROR.TASK_PARENT_HELD]: {},
  [HOSTED_API_ERROR.HOST_PAIRING_HELD]: declaredData(
    HOSTED_REFUSAL_DATA[HOSTED_API_ERROR.HOST_PAIRING_HELD],
  ),
  [HOSTED_API_ERROR.ALREADY_WRITTEN]: {},
  [HOSTED_API_ERROR.MEMORY_OFF]: {},
  [HOSTED_API_ERROR.MEMORY_CREDENTIAL]: {},
  [HOSTED_API_ERROR.MEMORY_FULL]: {},
} as const satisfies Record<HostedApiError, ErrorMapItem>;
