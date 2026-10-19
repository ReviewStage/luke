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
import { repositoryUnreachedSchema } from "../repository-reach-wire.js";
import { HOSTED_API_ERROR, type HostedApiError } from "../service-wire.js";

/** A repository out of reach carries why, which the desktop reads for the failure's remedy. */
const repositoryNotReachableData = EffectSchema.toStandardSchemaV1(
  EffectSchema.flip(
    EffectSchema.Struct({ unreached: EffectSchema.optionalKey(repositoryUnreachedSchema) }),
  ),
);

/** Every hosted refusal, the slug its code, and the extra fields of the one that carries some. */
export const HOSTED_ERRORS = {
  [HOSTED_API_ERROR.INVALID_TOKEN]: {},
  [HOSTED_API_ERROR.INVALID_REQUEST]: {},
  [HOSTED_API_ERROR.QUOTA_EXHAUSTED]: {},
  [HOSTED_API_ERROR.UNAVAILABLE]: {},
  [HOSTED_API_ERROR.UPSTREAM_ERROR]: {},
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
  [HOSTED_API_ERROR.TASK_ARCHIVED]: {},
  [HOSTED_API_ERROR.NOT_PERMITTED]: {},
  [HOSTED_API_ERROR.ALREADY_INVITED]: {},
  [HOSTED_API_ERROR.SANDBOX_STOPPED]: {},
  [HOSTED_API_ERROR.LINEAR_UNAVAILABLE]: {},
} as const satisfies Record<HostedApiError, ErrorMapItem>;
