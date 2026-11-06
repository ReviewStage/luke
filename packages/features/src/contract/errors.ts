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

export const repositoryNotReachableDataSchema = EffectSchema.Struct({
  unreached: EffectSchema.optionalKey(repositoryUnreachedSchema),
});

const repositoryNotReachableData = EffectSchema.toStandardSchemaV1(
  EffectSchema.flip(repositoryNotReachableDataSchema),
);

const upstreamErrorDataSchema = EffectSchema.Struct({
  upstreamStatus: EffectSchema.optionalKey(EffectSchema.Int),
});

const upstreamErrorData = EffectSchema.toStandardSchemaV1(
  EffectSchema.flip(upstreamErrorDataSchema),
);

export const planLimitReachedDataSchema = EffectSchema.Struct({
  resetsAt: EffectSchema.optionalKey(EffectSchema.Number),
});

const planLimitReachedData = EffectSchema.toStandardSchemaV1(
  EffectSchema.flip(planLimitReachedDataSchema),
);

export const credentialMissingDataSchema = EffectSchema.Struct({
  provider: EffectSchema.optionalKey(modelProviderSchema),
});

export const localAgentRefusedDataSchema = EffectSchema.Struct({
  localAgentRefusal: EffectSchema.optionalKey(localAgentRefusalSchema),
  refusedDevice: EffectSchema.optionalKey(refusedDeviceSchema),
});

const localAgentRefusedData = EffectSchema.toStandardSchemaV1(
  EffectSchema.flip(localAgentRefusedDataSchema),
);

export const extraRepositoryRefusedDataSchema = EffectSchema.Struct({
  extraRepositoryRefusal: EffectSchema.optionalKey(extraRepositoryRefusalSchema),
  refusedRepository: EffectSchema.optionalKey(EffectSchema.String),
});

const extraRepositoryRefusedData = EffectSchema.toStandardSchemaV1(
  EffectSchema.flip(extraRepositoryRefusedDataSchema),
);

const credentialMissingData = EffectSchema.toStandardSchemaV1(
  EffectSchema.flip(credentialMissingDataSchema),
);

const hostRemovedData = EffectSchema.toStandardSchemaV1(EffectSchema.flip(hostRemovedDataSchema));

const hostUpgradeNeededData = EffectSchema.toStandardSchemaV1(
  EffectSchema.flip(hostUpgradeNeededDataSchema),
);

const hostPairingHeldData = EffectSchema.toStandardSchemaV1(
  EffectSchema.flip(hostPairingHeldDataSchema),
);

const installedSkillRefusedData = EffectSchema.toStandardSchemaV1(
  EffectSchema.flip(installedSkillRefusedDataSchema),
);

export const HOSTED_ERRORS = {
  [HOSTED_API_ERROR.INVALID_TOKEN]: { data: hostRemovedData },
  [HOSTED_API_ERROR.INVALID_REQUEST]: {},
  [HOSTED_API_ERROR.QUOTA_EXHAUSTED]: {},
  [HOSTED_API_ERROR.UNAVAILABLE]: {},
  [HOSTED_API_ERROR.UPSTREAM_ERROR]: { data: upstreamErrorData },
  [HOSTED_API_ERROR.UPSTREAM_THROTTLED]: {},
  [HOSTED_API_ERROR.REQUEST_TOO_LARGE]: {},
  [HOSTED_API_ERROR.PROMPT_TOO_LARGE]: {},
  [HOSTED_API_ERROR.UNKNOWN_TOOL]: {},
  [HOSTED_API_ERROR.METHOD_NOT_ALLOWED]: {},
  [HOSTED_API_ERROR.NOT_FOUND]: {},
  [HOSTED_API_ERROR.REPOSITORY_NOT_REACHABLE]: { data: repositoryNotReachableData },
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
  [HOSTED_API_ERROR.AGENT_PLAN_LIMIT_REACHED]: { data: planLimitReachedData },
  [HOSTED_API_ERROR.AGENT_PLAN_INELIGIBLE]: {},
  [HOSTED_API_ERROR.AGENT_CREDENTIAL_MISSING]: { data: credentialMissingData },
  [HOSTED_API_ERROR.AGENT_API_KEY_UNREADABLE]: {},
  [HOSTED_API_ERROR.NOT_PERMITTED]: {},
  [HOSTED_API_ERROR.ALREADY_INVITED]: {},
  [HOSTED_API_ERROR.SANDBOX_STOPPED]: {},
  [HOSTED_API_ERROR.SANDBOX_SNAPSHOT_GONE]: {},
  [HOSTED_API_ERROR.SKILL_NAME_TAKEN]: { data: installedSkillRefusedData },
  [HOSTED_API_ERROR.SKILL_FILES_REFUSED]: { data: installedSkillRefusedData },
  [HOSTED_API_ERROR.WORKSPACE_SLUG_MALFORMED]: {},
  [HOSTED_API_ERROR.WORKSPACE_SLUG_RESERVED]: {},
  [HOSTED_API_ERROR.WORKSPACE_SLUG_TAKEN]: {},
  [HOSTED_API_ERROR.LOCAL_AGENT_REFUSED]: { data: localAgentRefusedData },
  [HOSTED_API_ERROR.EXTRA_REPOSITORY_REFUSED]: { data: extraRepositoryRefusedData },
  [HOSTED_API_ERROR.HOST_UPGRADE_NEEDED]: { data: hostUpgradeNeededData },
  [HOSTED_API_ERROR.DEVICE_REMOVED]: {},
  [HOSTED_API_ERROR.CHILD_REPOSITORY_LOCKED]: {},
  [HOSTED_API_ERROR.TASK_BLOCK_CYCLE]: {},
  [HOSTED_API_ERROR.TASK_PARENT_CYCLE]: {},
  [HOSTED_API_ERROR.TASK_PARENT_HELD]: {},
  [HOSTED_API_ERROR.HOST_PAIRING_HELD]: { data: hostPairingHeldData },
  [HOSTED_API_ERROR.ALREADY_WRITTEN]: {},
  [HOSTED_API_ERROR.MEMORY_OFF]: {},
  [HOSTED_API_ERROR.MEMORY_CREDENTIAL]: {},
  [HOSTED_API_ERROR.MEMORY_FULL]: {},
} as const satisfies Record<HostedApiError, ErrorMapItem>;
