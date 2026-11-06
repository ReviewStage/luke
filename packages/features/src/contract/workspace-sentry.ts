import { HTTP_METHOD } from "@repo/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  WORKSPACE_SENTRY_QUERY,
  workspaceSentryAnswerSchema,
  workspaceSentryDisconnectRequestSchema,
  workspaceSentryInstallAnswerSchema,
  workspaceSentryRequestSchema,
} from "../sentry-install-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { workspaceIdSchema } from "../task-wire.js";
import { bodyCap, exactInput, hostedProcedure } from "./base.js";

const BODY_BYTES = 2_048;

const workspaceSentryQuerySchema = EffectSchema.Struct({
  [WORKSPACE_SENTRY_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

export const workspaceSentryContract = {
  install: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_SENTRY_INSTALL }))
    .input(exactInput(workspaceSentryRequestSchema))
    .output(EffectSchema.flip(workspaceSentryInstallAnswerSchema)),
  installations: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: HOSTED_SERVICE_PATH.WORKSPACE_SENTRY_INSTALLATIONS,
      }),
    )
    .input(workspaceSentryQuerySchema)
    .output(EffectSchema.flip(workspaceSentryAnswerSchema)),
  disconnect: hostedProcedure
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_SENTRY_DISCONNECT }),
    )
    .input(exactInput(workspaceSentryDisconnectRequestSchema))
    .output(EffectSchema.flip(workspaceSentryAnswerSchema)),
};
