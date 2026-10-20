/**
 * issues.ts -- a workspace's issues (`issue-wire.ts`): list and file them, and read and change one.
 *
 * The list's query is read as the old route read it: one workspace, and
 * `archived` spelled `true` or `false` where it is given at all. One
 * issue's id stays a plain string here, because an id that is no UUID names
 * no issue and is answered not found rather than refused. A body is read
 * with `exactInput`, so a key it does not declare is refused as before.
 */

import { HTTP_METHOD } from "@luke/wire";
import { openapi } from "@orpc/openapi";
import { Schema as EffectSchema } from "effect";
import {
  ISSUE_LIST_QUERY,
  issueAnswerSchema,
  issueChangeRequestSchema,
  issueCreateRequestSchema,
  issueListAnswerSchema,
} from "../issue-wire.js";
import { HOSTED_SERVICE_PATH } from "../service-paths.js";
import { exactBodyInput, exactInput, hostedProcedure } from "./base.js";

/** One issue's public path, its id the one segment. */
const ISSUE_PATH = `${HOSTED_SERVICE_PATH.ISSUES}/{id}` as const;

/** How `archived` reads on a list's query: absent or false lists the issues standing, true the archived ones. */
export const ISSUE_ARCHIVED_QUERY = { TRUE: "true", FALSE: "false" } as const;

const issueListInputSchema = EffectSchema.Struct({
  [ISSUE_LIST_QUERY.WORKSPACE_ID]: EffectSchema.NonEmptyString,
  [ISSUE_LIST_QUERY.ARCHIVED]: EffectSchema.optionalKey(
    EffectSchema.Literals(Object.values(ISSUE_ARCHIVED_QUERY)),
  ),
});

const issueIdInputSchema = EffectSchema.Struct({ id: EffectSchema.String });

export const issuesContract = {
  list: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: HOSTED_SERVICE_PATH.ISSUES }))
    .input(issueListInputSchema)
    .output(EffectSchema.flip(issueListAnswerSchema)),
  create: hostedProcedure
    .meta(
      openapi({ method: HTTP_METHOD.POST, path: HOSTED_SERVICE_PATH.ISSUES, successStatus: 201 }),
    )
    .input(exactInput(issueCreateRequestSchema))
    .output(EffectSchema.flip(issueAnswerSchema)),
  read: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.GET, path: ISSUE_PATH }))
    .input(issueIdInputSchema)
    .output(EffectSchema.flip(issueAnswerSchema)),
  change: hostedProcedure
    .meta(openapi({ method: HTTP_METHOD.PATCH, path: ISSUE_PATH, inputStructure: "detailed" }))
    .input(exactBodyInput(issueIdInputSchema, issueChangeRequestSchema))
    .output(EffectSchema.flip(issueAnswerSchema)),
};
