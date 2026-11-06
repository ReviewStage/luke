import { COMMON_ERROR_STATUS_MAP } from "@orpc/openapi";
import { ORPCError } from "@orpc/server";
import {
  extraRepositoryRefusalSchema,
  localAgentRefusalSchema,
  refusedDeviceSchema,
} from "@repo/features/agent-wire";
import { installedSkillRefusedDataSchema } from "@repo/features/installed-skill-route-wire";
import { MODEL_PROVIDER } from "@repo/features/models-wire";
import { repositoryUnreachedSchema } from "@repo/features/repository-reach-wire";
import { Effect, Schema } from "effect";
import { ADMIN_REFUSAL_STATUS } from "../admin/http-effect.js";
import { HOSTED_REFUSAL, HOSTED_REFUSAL_STATUS } from "../http/http-effect.js";
import type { HostedContext } from "./base.js";

const REFUSAL_STATUS = { ...ADMIN_REFUSAL_STATUS, ...HOSTED_REFUSAL_STATUS };

const REFUSAL_SLUGS = [
  ...Object.values(HOSTED_REFUSAL).map((refusal) => refusal.error),
  ...Object.keys(ADMIN_REFUSAL_STATUS),
];

const ORPC_BAD_REQUEST = "BAD_REQUEST";

const ORPC_PAYLOAD_TOO_LARGE = "PAYLOAD_TOO_LARGE";

export const HOSTED_ERROR_STATUS = { ...COMMON_ERROR_STATUS_MAP, ...REFUSAL_STATUS };

const isHostedRefusal = Schema.is(
  Schema.Struct({
    error: Schema.Literals(REFUSAL_SLUGS),
    unreached: Schema.optionalKey(repositoryUnreachedSchema),
    upstreamStatus: Schema.optionalKey(Schema.Int),
    resetsAt: Schema.optionalKey(Schema.Number),
    provider: Schema.optionalKey(Schema.Literals(Object.values(MODEL_PROVIDER))),
    ...installedSkillRefusedDataSchema.fields,
    localAgentRefusal: Schema.optionalKey(localAgentRefusalSchema),
    refusedDevice: Schema.optionalKey(refusedDeviceSchema),
    extraRepositoryRefusal: Schema.optionalKey(extraRepositoryRefusalSchema),
    refusedRepository: Schema.optionalKey(Schema.String),
    minimumVersion: Schema.optionalKey(Schema.String),
    hostRemoved: Schema.optionalKey(Schema.Literal(true)),
  }),
);

const isRefusalFields = Schema.is(Schema.Record(Schema.String, Schema.Unknown));

function refusalError(refusal: { readonly error: string }): ORPCError<string, object> {
  const { error, ...data } = refusal;
  return new ORPCError(error, { data });
}

export const hostedRefusalWrap: NonNullable<HostedContext["effect/wrap"]> = <A, E>(
  effect: Effect.Effect<A, E>,
) =>
  Effect.mapError(
    effect,
    (failure): E => (isHostedRefusal(failure) ? (refusalError(failure) as E) : failure),
  );

export function encodeHostedError(error: ORPCError<string, unknown>): object | null {
  if (Object.hasOwn(REFUSAL_STATUS, error.code)) {
    return isRefusalFields(error.data)
      ? { error: error.code, ...error.data }
      : { error: error.code };
  }
  if (error.code === ORPC_BAD_REQUEST) return HOSTED_REFUSAL.INVALID_REQUEST;
  if (error.code === ORPC_PAYLOAD_TOO_LARGE) return HOSTED_REFUSAL.REQUEST_TOO_LARGE;
  return null;
}
