/**
 * agent-ports.ts -- the TCP ports a server listens on in a coding agent's cloud sandbox (`listening-ports-wire.ts`), for the desktop's Forward to localhost control.
 *
 * The agent travels in the path. The read is cheap enough for the desktop
 * to ask every few seconds while the control is open or forwarding is on:
 * one look at whether the sandbox is running, and one short command in it
 * while it runs. It never wakes a stopped sandbox.
 *
 * The read refuses as every sandbox route does (`sandbox-reach.ts`): an
 * agent not found, not the caller's to reach, or archived, and a sandbox
 * Vercel did not answer for or whose snapshot is gone.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import { listeningPortsAnswerSchema } from "../listening-ports-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { declaredProcedure, refuses } from "./base.js";

/** The agent a path names; the service reads an id that is no UUID as naming none. */
const agentParamsSchema = EffectSchema.Struct({ id: EffectSchema.String });

export const agentPortsContract = {
  /** The ports listened on in the agent's sandbox, and whether it is running. */
  list: declaredProcedure
    .errors(
      refuses(
        HOSTED_API_ERROR.NOT_FOUND,
        HOSTED_API_ERROR.NOT_PERMITTED,
        HOSTED_API_ERROR.AGENT_RETIRED,
        HOSTED_API_ERROR.SANDBOX_SNAPSHOT_GONE,
        HOSTED_API_ERROR.UPSTREAM_ERROR,
      ),
    )
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.AGENTS}/{id}/ports` }))
    .input(agentParamsSchema)
    .output(EffectSchema.flip(listeningPortsAnswerSchema)),
};
