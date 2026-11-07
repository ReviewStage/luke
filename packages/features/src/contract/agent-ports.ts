/**
 * agent-ports.ts -- the TCP ports a server listens on in a coding agent's cloud sandbox (`listening-ports-wire.ts`), for the desktop's Forward to localhost control.
 *
 * The agent travels in the path. The read is cheap enough for the desktop
 * to ask every few seconds while the control is open or forwarding is on:
 * one look at whether the sandbox is running, and one short command in it
 * while it runs. It never wakes a stopped sandbox.
 *
 * One port may be shared by a public link (`listening-ports-wire.ts`):
 * shared, which never wakes a stopped sandbox and refuses one as stopped,
 * the share ended, and the port shared now read back.
 *
 * Every call refuses as every sandbox route does (`sandbox-reach.ts`): an
 * agent not found, not the caller's to reach, or archived, and a sandbox
 * Vercel did not answer for or whose snapshot is gone.
 */

import { openapi } from "@orpc/openapi";
import { HTTP_METHOD } from "@repo/wire";
import { Schema as EffectSchema } from "effect";
import {
  listeningPortsAnswerSchema,
  portShareAnswerSchema,
  portShareRequestSchema,
  sharedPortAnswerSchema,
} from "../listening-ports-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { HOSTED_API_ERROR } from "../service-wire.js";
import { bodyCap, declaredProcedure, exactBodyInput, refuses } from "./base.js";

/** The agent a path names; the service reads an id that is no UUID as naming none. */
const agentParamsSchema = EffectSchema.Struct({ id: EffectSchema.String });

/** Where the agent's shared port stands. */
const SHARE_PATH = `${HOSTED_SERVICE_PATH.AGENTS}/{id}/ports/share` as const;

/** A port and a few keys, so a body past this names no port. */
const SHARE_BODY_BYTES = 256;

/** A route in the agent's sandbox, refusing as every one does. */
const portsProcedure = declaredProcedure.errors(
  refuses(
    HOSTED_API_ERROR.NOT_FOUND,
    HOSTED_API_ERROR.NOT_PERMITTED,
    HOSTED_API_ERROR.AGENT_RETIRED,
    HOSTED_API_ERROR.SANDBOX_SNAPSHOT_GONE,
    HOSTED_API_ERROR.UPSTREAM_ERROR,
  ),
);

export const agentPortsContract = {
  /** The ports listened on in the agent's sandbox, and whether it is running. */
  list: portsProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${HOSTED_SERVICE_PATH.AGENTS}/{id}/ports` }))
    .input(agentParamsSchema)
    .output(EffectSchema.flip(listeningPortsAnswerSchema)),
  /** The port shared by a public link, replacing any shared before; a sandbox not running is refused as stopped. */
  share: portsProcedure
    .errors(refuses(HOSTED_API_ERROR.SANDBOX_STOPPED))
    .meta(bodyCap(SHARE_BODY_BYTES))
    .meta(openapi({ method: HTTP_METHOD.PUT, path: SHARE_PATH, inputStructure: "detailed" }))
    .input(exactBodyInput(agentParamsSchema, portShareRequestSchema))
    .output(EffectSchema.flip(portShareAnswerSchema)),
  /** The shared port's link closed, answering that nothing is shared; nothing shared is left as it is. */
  unshare: portsProcedure
    .meta(openapi({ method: HTTP_METHOD.DELETE, path: SHARE_PATH }))
    .input(agentParamsSchema)
    .output(EffectSchema.flip(sharedPortAnswerSchema)),
  /** The port shared now and its link, read back from the sandbox. */
  shared: portsProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: SHARE_PATH }))
    .input(agentParamsSchema)
    .output(EffectSchema.flip(sharedPortAnswerSchema)),
};
