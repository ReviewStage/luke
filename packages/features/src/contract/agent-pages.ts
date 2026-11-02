/**
 * agent-pages.ts -- the pages a coding agent on no task showed on itself (`page-wire.ts`): list them, read one version, and frame one in a browser.
 *
 * The agent and the page travel in the path, as a task's pages do under the
 * task (`task-files.ts`), and a version's HTML is answered inside JSON, so no
 * page is ever a document of the service's origin; a browser's frame is sent
 * on to the sandbox's own site for it (`page-frame.ts`).
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import { pageFrameAnswerSchema } from "../page-frame.js";
import { planPageVersionAnswerSchema, taskPagesAnswerSchema } from "../page-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { hostedProcedure } from "./base.js";

const PAGES_PATH = `${HOSTED_SERVICE_PATH.AGENTS}/{id}/pages` as const;

/** The agent a path names; the service reads an id that is no UUID as naming no agent. */
const agentParamsSchema = EffectSchema.Struct({ id: EffectSchema.String });

/** One version of one of the agent's pages, as the path names it. */
const agentPageVersionSchema = EffectSchema.Struct({
  ...agentParamsSchema.fields,
  page: EffectSchema.String,
  version: EffectSchema.String,
});

export const agentPagesContract = {
  /** The agent's own pages, each by its newest version, the most recently written first. */
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: PAGES_PATH }))
    .input(agentParamsSchema)
    .output(EffectSchema.flip(taskPagesAnswerSchema)),
  /** One version of one of the agent's own pages, with its HTML. */
  version: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: `${PAGES_PATH}/{page}/versions/{version}` }))
    .input(agentPageVersionSchema)
    .output(EffectSchema.flip(planPageVersionAnswerSchema)),
  /** One version of one of the agent's own pages as a browser's frame loads it, answered as a plan's page frame is (`task-files.ts`). */
  frame: hostedProcedure
    .meta(
      openapi({
        method: HTTP_METHOD.GET,
        path: `${PAGES_PATH}/{page}/versions/{version}/frame`,
        outputStructure: "detailed",
      }),
    )
    .input(agentPageVersionSchema)
    .output(EffectSchema.flip(pageFrameAnswerSchema)),
};
