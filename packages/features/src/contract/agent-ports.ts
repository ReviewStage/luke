/**
 * agent-ports.ts -- the TCP ports a server listens on in a coding agent's cloud sandbox (`listening-ports-wire.ts`), for the desktop's Forward to localhost control.
 *
 * The agent travels in the path. The read is cheap enough for the desktop
 * to ask every few seconds while the control is open or forwarding is on:
 * one look at whether the sandbox is running, and one short command in it
 * while it runs. It never wakes a stopped sandbox; only turning forwarding
 * on does, which also starts the repository's run command.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  forwardingStartAnswerSchema,
  listeningPortsAnswerSchema,
} from "../listening-ports-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { hostedProcedure } from "./base.js";

/** The agent a path names; the service reads an id that is no UUID as naming none. */
const agentParamsSchema = EffectSchema.Struct({ id: EffectSchema.String });

export const agentPortsContract = {
  /** The ports listened on in the agent's sandbox, and whether it is running. */
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.AGENTS}/{id}/ports` }))
    .input(agentParamsSchema)
    .output(EffectSchema.flip(listeningPortsAnswerSchema)),
  /**
   * Forwarding turned on: the sandbox woken where it was stopped, and the
   * repository's run command started where no port listens; answered at
   * once, before the command listens.
   */
  startForwarding: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.POST,
        path: `${HOSTED_SERVICE_PATH.AGENTS}/{id}/ports/forwarding`,
      }),
    )
    .input(agentParamsSchema)
    .output(EffectSchema.flip(forwardingStartAnswerSchema)),
};
