/**
 * workspace-sentry.ts -- a workspace's installations of our Sentry integration begun, read, and ended (`sentry-install-wire.ts`).
 *
 * Where Sentry returns the browser after an install (`triggers/sentry/installed`)
 * is a redirect, not a procedure, and stays a route of its own.
 *
 * Each declares a workspace or installation not found, and the writes a
 * role that does not allow them
 * (`packages/service/src/triggers/sentry/sentry-install-procedures.ts`).
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  WORKSPACE_SENTRY_QUERY,
  workspaceSentryAnswerSchema,
  workspaceSentryDisconnectRequestSchema,
  workspaceSentryInstallAnswerSchema,
  workspaceSentryRequestSchema,
} from "../sentry-install-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { workspaceIdSchema } from "../task-wire.js";
import { bodyCap, declaredProcedure, exactInput, refuses } from "./base.js";

/** The most a request body may hold: a workspace id and an installation id. */
const BODY_BYTES = 2_048;

/** The installations read's query: the one workspace it names. */
const workspaceSentryQuerySchema = EffectSchema.Struct({
  [WORKSPACE_SENTRY_QUERY.WORKSPACE_ID]: workspaceIdSchema,
});

export const workspaceSentryContract = {
  install: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_SENTRY_INSTALL }))
    .input(exactInput(workspaceSentryRequestSchema))
    .output(EffectSchema.flip(workspaceSentryInstallAnswerSchema)),
  installations: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND))
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: HOSTED_SERVICE_PATH.WORKSPACE_SENTRY_INSTALLATIONS,
      }),
    )
    .input(workspaceSentryQuerySchema)
    .output(EffectSchema.flip(workspaceSentryAnswerSchema)),
  disconnect: declaredProcedure
    .errors(refuses(HOSTED_API_ERROR.NOT_FOUND, HOSTED_API_ERROR.NOT_PERMITTED))
    .meta(bodyCap(BODY_BYTES))
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.WORKSPACE_SENTRY_DISCONNECT }),
    )
    .input(exactInput(workspaceSentryDisconnectRequestSchema))
    .output(EffectSchema.flip(workspaceSentryAnswerSchema)),
};
